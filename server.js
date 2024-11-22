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

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Queue for waiting users
const waitingUsers = {
    text: [],
    video: []
};

// Active rooms
const activeRooms = new Map();

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

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Emit connection status
    socket.emit('connection-status', { status: 'connected' });

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
    socket.on('send-message', ({ roomId, message, type, content }) => {
        const messageData = {
            type: type || 'text',
            content: content || message,
            timestamp: Date.now()
        };
        socket.to(roomId).emit('message-received', messageData);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
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
