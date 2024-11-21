const socket = io();

let localStream;
let peerConnection;
let currentPeer = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// DOM elements
const preferencesModal = document.getElementById('preferencesModal');
const preferencesForm = document.getElementById('preferencesForm');
const chatContainer = document.getElementById('chatContainer');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const messageInput = document.getElementById('messageInput');
const sendMessage = document.getElementById('sendMessage');
const messages = document.getElementById('messages');
const nextButton = document.getElementById('nextButton');
const toggleVideoBtn = document.getElementById('toggleVideo');
const toggleAudioBtn = document.getElementById('toggleAudio');
const reportUserBtn = document.getElementById('reportUser');

// Get user media and start the process
async function initializeMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Unable to access camera and microphone. Please ensure they are connected and permissions are granted.');
    }
}

// Handle preferences form submission
preferencesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const preferences = {
        gender: document.getElementById('gender').value,
        interestedIn: document.getElementById('interestedIn').value
    };
    
    await initializeMedia();
    socket.emit('setPreferences', preferences);
    preferencesModal.style.display = 'none';
    chatContainer.style.display = 'block';
});

// Create and handle peer connection
async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    // Add local stream
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate && currentPeer) {
            socket.emit('ice-candidate', {
                target: currentPeer,
                candidate: event.candidate
            });
        }
    };

    // Handle remote stream
    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };
}

// Socket event handlers
socket.on('matched', async (peerId) => {
    currentPeer = peerId;
    await createPeerConnection();

    // Create and send offer if we're the initiator
    if (socket.id < peerId) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            target: peerId,
            offer: offer
        });
    }
});

socket.on('offer', async (data) => {
    if (!peerConnection) {
        await createPeerConnection();
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', {
        target: data.source,
        answer: answer
    });
});

socket.on('answer', async (data) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

// Chat functionality
sendMessage.addEventListener('click', () => {
    const message = messageInput.value.trim();
    if (message && currentPeer) {
        socket.emit('chat-message', {
            target: currentPeer,
            message: message
        });
        addMessage(message, true);
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage.click();
    }
});

socket.on('chat-message', (data) => {
    addMessage(data.message, false);
});

function addMessage(message, sent) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(sent ? 'sent' : 'received');
    messageElement.textContent = message;
    messages.appendChild(messageElement);
    messages.scrollTop = messages.scrollHeight;
}

// Control buttons functionality
nextButton.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
    }
    currentPeer = null;
    remoteVideo.srcObject = null;
    messages.innerHTML = '';
    socket.emit('setPreferences', {
        gender: document.getElementById('gender').value,
        interestedIn: document.getElementById('interestedIn').value
    });
});

toggleVideoBtn.addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    toggleVideoBtn.textContent = videoTrack.enabled ? 'Toggle Video' : 'Enable Video';
});

toggleAudioBtn.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    toggleAudioBtn.textContent = audioTrack.enabled ? 'Toggle Audio' : 'Enable Audio';
});

reportUserBtn.addEventListener('click', () => {
    if (currentPeer) {
        // Implement report functionality
        alert('User reported. Our moderators will review this case.');
    }
});
