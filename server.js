require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');

// Initialize Firebase Admin (if configured)
let db, auth;
try {
    if (process.env.FIREBASE_PROJECT_ID) {
        const admin = require('firebase-admin');
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
            }),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        db = admin.database();
        auth = admin.auth();
        console.log('Firebase initialized successfully');
    }
} catch (error) {
    console.log('Firebase initialization skipped:', error.message);
}

// Environment variables
const TENOR_API_KEY = process.env.TENOR_API_KEY;
if (!TENOR_API_KEY) {
    console.error('Warning: TENOR_API_KEY not found in environment variables');
}

app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
    if (!auth) {
        // Skip authentication if Firebase is not configured
        return next();
    }
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decodedToken = await auth.verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// User routes
app.post('/api/users/profile', authenticateToken, async (req, res) => {
    try {
        const { displayName, photoURL } = req.body;
        const uid = req.user.uid;
        
        if (db) {
            await db.ref(`users/${uid}`).update({
                displayName,
                photoURL,
                lastSeen: db.ServerValue.TIMESTAMP
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Chat history routes
app.get('/api/chats/:roomId', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.params;
        if (db) {
            const snapshot = await db.ref(`chats/${roomId}`).limitToLast(50).once('value');
            const messages = snapshot.val() || {};
            res.json(Object.values(messages));
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// GIF proxy endpoint
app.get('/api/gifs', async (req, res) => {
    try {
        const { q } = req.query;
        const searchType = q ? 'search' : 'trending';
        const url = `https://tenor.googleapis.com/v2/${searchType}?key=${TENOR_API_KEY}&client_key=mila_chat&limit=20${q ? '&q=' + encodeURIComponent(q) : ''}`;
        
        const response = await fetch(url);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching GIFs:', error);
        res.status(500).json({ error: 'Failed to fetch GIFs' });
    }
});

// Queue for waiting users
const waitingUsers = {
    text: [],
    video: []
};

// Active rooms
const activeRooms = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Emit connection status
    socket.emit('connection-status', { status: 'connected' });

    socket.on('authenticate', async (token) => {
        try {
            if (auth) {
                const decodedToken = await auth.verifyIdToken(token);
                socket.userId = decodedToken.uid;
                socket.emit('authenticated');
                
                // Update user status
                if (db) {
                    await db.ref(`users/${decodedToken.uid}/status`).set('online');
                }
            } else {
                socket.emit('authenticated');
            }
        } catch (error) {
            socket.emit('authentication_error', { error: 'Invalid token' });
        }
    });

    socket.on('find-partner', ({ isVideoChat }) => {
        const queueType = isVideoChat ? 'video' : 'text';
        const queue = waitingUsers[queueType];

        // Remove user from any existing room
        leaveCurrentRoom(socket);

        if (queue.length > 0) {
            // Match with waiting user
            const partner = queue.shift();
            const roomId = `room_${partner.id}_${socket.id}`;
            
            // Create new room
            activeRooms.set(roomId, { users: [partner.id, socket.id] });
            
            // Join both users to the room
            socket.join(roomId);
            partner.join(roomId);
            
            // Notify users
            partner.emit('room-created', { roomId });
            socket.emit('room-joined', { roomId });

            // Notify both users about successful connection
            partner.emit('connection-status', { status: 'connected', message: 'Partner found!' });
            socket.emit('connection-status', { status: 'connected', message: 'Partner found!' });
        } else {
            // Add to waiting queue
            waitingUsers[queueType].push(socket);
            socket.emit('connection-status', { status: 'waiting', message: 'Looking for a partner...' });
        }
    });

    socket.on('leave-room', (roomId) => {
        leaveCurrentRoom(socket);
        socket.emit('connection-status', { status: 'disconnected', message: 'Disconnected from partner' });
    });

    // WebRTC signaling
    socket.on('offer', ({ roomId, offer }) => {
        socket.to(roomId).emit('offer-received', { offer });
    });

    socket.on('answer', ({ roomId, answer }) => {
        socket.to(roomId).emit('answer-received', { answer });
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('ice-candidate-received', { candidate });
    });

    // Chat messages
    socket.on('send-message', async ({ roomId, message, type, content }) => {
        if (!socket.userId) {
            socket.emit('error', { message: 'Not authenticated' });
            return;
        }

        const messageData = {
            type: type || 'text',
            content: content || message,
            timestamp: db ? db.ServerValue.TIMESTAMP : Date.now(),
            senderId: socket.userId
        };

        // Save message to Firebase
        if (db) {
            await db.ref(`chats/${roomId}`).push(messageData);
        }

        socket.to(roomId).emit('message-received', messageData);
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        if (socket.userId && db) {
            await db.ref(`users/${socket.userId}/status`).set('offline');
            await db.ref(`users/${socket.userId}/lastSeen`).set(db.ServerValue.TIMESTAMP);
        }
        leaveCurrentRoom(socket);
        
        // Remove from waiting queues
        waitingUsers.text = waitingUsers.text.filter(user => user.id !== socket.id);
        waitingUsers.video = waitingUsers.video.filter(user => user.id !== socket.id);
    });
});

function leaveCurrentRoom(socket) {
    // Find and leave current room
    for (const [roomId, room] of activeRooms.entries()) {
        if (room.users.includes(socket.id)) {
            socket.to(roomId).emit('partner-left');
            socket.to(roomId).emit('connection-status', { 
                status: 'disconnected', 
                message: 'Partner disconnected' 
            });
            socket.leave(roomId);
            activeRooms.delete(roomId);
            break;
        }
    }
}

// Get local network IP
const networkInterfaces = os.networkInterfaces();
let localIP = 'localhost';
for (const interfaceName in networkInterfaces) {
    const interface = networkInterfaces[interfaceName];
    for (const entry of interface) {
        if (entry.family === 'IPv4' && !entry.internal) {
            localIP = entry.address;
            break;
        }
    }
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at:`);
    console.log(`- Local:   http://localhost:${PORT}`);
    console.log(`- Network: http://${localIP}:${PORT}`);
    console.log(`- Environment: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err) => {
    console.error('Server error:', err);
});
