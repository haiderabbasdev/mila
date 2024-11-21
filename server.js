const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const os = require('os');

app.use(express.static('public'));

// Queue for waiting users
const waitingUsers = {
    text: [],
    video: []
};

// Active rooms
const activeRooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

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
        } else {
            // Add to waiting queue
            waitingUsers[queueType].push(socket);
        }
    });

    socket.on('leave-room', (roomId) => {
        leaveCurrentRoom(socket);
    });

    socket.on('offer', ({ roomId, offer }) => {
        socket.to(roomId).emit('offer-received', { offer });
    });

    socket.on('answer', ({ roomId, answer }) => {
        socket.to(roomId).emit('answer-received', { answer });
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('ice-candidate-received', { candidate });
    });

    socket.on('send-message', ({ roomId, message }) => {
        socket.to(roomId).emit('message-received', { message });
    });

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
http.listen(PORT, () => {
    console.log(`Server running at:`);
    console.log(`- Local:   http://localhost:${PORT}`);
    console.log(`- Network: http://${localIP}:${PORT}`);
});
