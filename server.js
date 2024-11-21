const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active users and their preferences
const activeUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle user preferences
    socket.on('setPreferences', (preferences) => {
        activeUsers.set(socket.id, {
            preferences,
            available: true
        });
        findMatch(socket);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        activeUsers.delete(socket.id);
    });

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        io.to(data.target).emit('offer', {
            offer: data.offer,
            source: socket.id
        });
    });

    socket.on('answer', (data) => {
        io.to(data.target).emit('answer', {
            answer: data.answer,
            source: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            source: socket.id
        });
    });

    // Handle chat messages
    socket.on('chat-message', (data) => {
        io.to(data.target).emit('chat-message', {
            message: data.message,
            source: socket.id
        });
    });
});

// Function to find a matching user
function findMatch(socket) {
    const currentUser = activeUsers.get(socket.id);
    if (!currentUser || !currentUser.available) return;

    for (const [userId, user] of activeUsers) {
        if (userId !== socket.id && user.available) {
            // Check if preferences match
            if (preferencesMatch(currentUser.preferences, user.preferences)) {
                // Mark both users as unavailable
                currentUser.available = false;
                user.available = false;

                // Notify both users of the match
                socket.emit('matched', userId);
                io.to(userId).emit('matched', socket.id);
                break;
            }
        }
    }
}

// Function to check if preferences match
function preferencesMatch(pref1, pref2) {
    // Implement your matching logic here
    return true; // For now, match everyone
}

const PORT = process.env.PORT || 3000;
const os = require('os');

// Get local IP address
const networkInterfaces = os.networkInterfaces();
let localIP = 'localhost';
Object.keys(networkInterfaces).forEach((interfaceName) => {
    networkInterfaces[interfaceName].forEach((interface) => {
        if (interface.family === 'IPv4' && !interface.internal) {
            localIP = interface.address;
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on:`);
    console.log(`- Local: http://localhost:${PORT}`);
    console.log(`- Network: http://${localIP}:${PORT}`);
});
