const socket = io();

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const chatContainer = document.getElementById('chatContainer');
const textChatBtn = document.getElementById('textChatBtn');
const videoChatBtn = document.getElementById('videoChatBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleVideoBtn = document.getElementById('toggleVideo');
const toggleAudioBtn = document.getElementById('toggleAudio');
const nextBtn = document.getElementById('nextBtn');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessage');
const messagesDiv = document.getElementById('messages');
const videoContainer = document.getElementById('videoContainer');

// State variables
let isVideoChat = false;
let localStream = null;
let peerConnection = null;
let currentRoomId = null;
let isVideoEnabled = true;
let isAudioEnabled = true;

// WebRTC configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Initialize the app
function init() {
    videoContainer.style.display = 'none';
    setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
    textChatBtn.addEventListener('click', () => startChat(false));
    videoChatBtn.addEventListener('click', () => startChat(true));
    toggleVideoBtn.addEventListener('click', toggleVideo);
    toggleAudioBtn.addEventListener('click', toggleAudio);
    nextBtn.addEventListener('click', findNewPartner);
    sendMessageBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
}

// Start chat (either text or video)
async function startChat(videoEnabled) {
    isVideoChat = videoEnabled;
    welcomeScreen.style.display = 'none';
    chatContainer.style.display = 'block';
    videoContainer.style.display = videoEnabled ? 'grid' : 'none';
    
    if (videoEnabled) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
        } catch (err) {
            console.error('Error accessing media devices:', err);
            alert('Failed to access camera and microphone. Please check permissions.');
            return;
        }
    }
    
    findNewPartner();
}

// Find a new chat partner
function findNewPartner() {
    if (currentRoomId) {
        socket.emit('leave-room', currentRoomId);
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    
    messagesDiv.innerHTML = '';
    socket.emit('find-partner', { isVideoChat });
}

// Toggle video
function toggleVideo() {
    if (!localStream) return;
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = isVideoEnabled);
    toggleVideoBtn.querySelector('i').className = isVideoEnabled ? 'fas fa-video' : 'fas fa-video-slash';
}

// Toggle audio
function toggleAudio() {
    if (!localStream) return;
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = isAudioEnabled);
    toggleAudioBtn.querySelector('i').className = isAudioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
}

// Send a message
function sendMessage() {
    const message = messageInput.value.trim();
    if (message && currentRoomId) {
        socket.emit('send-message', { roomId: currentRoomId, message });
        addMessage(message, true);
        messageInput.value = '';
    }
}

// Add a message to the chat
function addMessage(message, isSent) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.textContent = message;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// WebRTC: Create and handle peer connection
async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
    
    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };
    
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId: currentRoomId,
                candidate: event.candidate
            });
        }
    };
}

// Socket event handlers
socket.on('room-created', async ({ roomId }) => {
    currentRoomId = roomId;
    if (isVideoChat) {
        await createPeerConnection();
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomId, offer });
    }
});

socket.on('room-joined', async ({ roomId }) => {
    currentRoomId = roomId;
    if (isVideoChat) {
        await createPeerConnection();
    }
});

socket.on('offer-received', async ({ offer }) => {
    if (!peerConnection) await createPeerConnection();
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { roomId: currentRoomId, answer });
});

socket.on('answer-received', async ({ answer }) => {
    await peerConnection.setRemoteDescription(answer);
});

socket.on('ice-candidate-received', async ({ candidate }) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(candidate);
    }
});

socket.on('message-received', ({ message }) => {
    addMessage(message, false);
});

socket.on('partner-left', () => {
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    addMessage('Your partner has disconnected. Click "Next" to find a new partner.', false);
});

// Initialize the app
init();
