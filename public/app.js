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
const connectionStatus = document.getElementById('connectionStatus');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');
const gifBtn = document.getElementById('gifBtn');
const gifPicker = document.getElementById('gifPicker');
const gifSearchInput = document.getElementById('gifSearchInput');
const gifResults = document.getElementById('gifResults');
const imageUpload = document.getElementById('imageUpload');

// State variables
let isVideoChat = false;
let localStream = null;
let peerConnection = null;
let currentRoomId = null;
let isVideoEnabled = true;
let isAudioEnabled = true;
let picker = null;

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
    sendMessageBtn.addEventListener('click', () => sendMessage());
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Emoji picker
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!picker) {
            picker = new EmojiMart.Picker({
                data: emojiMartData,
                onEmojiSelect: (emoji) => {
                    messageInput.value += emoji.native;
                    emojiPicker.style.display = 'none';
                },
                theme: 'dark'
            });
            emojiPicker.innerHTML = '';
            emojiPicker.appendChild(picker);
        }
        emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
    });

    // GIF picker
    gifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        gifPicker.style.display = gifPicker.style.display === 'none' ? 'block' : 'none';
        if (gifPicker.style.display === 'block') {
            searchGifs('');
        }
    });

    gifSearchInput.addEventListener('input', debounce((e) => {
        searchGifs(e.target.value);
    }, 500));

    // Image upload
    imageUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                alert('Image size must be less than 5MB');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                sendMessage('image', e.target.result);
            };
            reader.readAsDataURL(file);
        }
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
function sendMessage(type = 'text', content = null) {
    if (!currentRoomId) return;

    const messageText = type === 'text' ? messageInput.value.trim() : null;
    if (type === 'text' && !messageText) return;

    socket.emit('send-message', {
        roomId: currentRoomId,
        type,
        content: content || messageText
    });

    displayMessage({
        type,
        content: content || messageText,
        timestamp: Date.now(),
        isLocal: true
    });

    if (type === 'text') {
        messageInput.value = '';
    }
}

// Display a message
function displayMessage({ type, content, timestamp, isLocal }) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message ${isLocal ? 'local' : 'remote'}`;

    switch (type) {
        case 'text':
            messageDiv.textContent = content;
            break;
        case 'image':
            const img = document.createElement('img');
            img.src = content;
            img.addEventListener('click', () => {
                window.open(content, '_blank');
            });
            messageDiv.appendChild(img);
            break;
        case 'gif':
            const gifImg = document.createElement('img');
            gifImg.src = content;
            messageDiv.appendChild(gifImg);
            break;
    }

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

socket.on('message-received', ({ type, content }) => {
    displayMessage({
        type,
        content,
        timestamp: Date.now(),
        isLocal: false
    });
});

socket.on('partner-left', () => {
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    displayMessage({
        type: 'text',
        content: 'Your partner has disconnected. Click "Next" to find a new partner.',
        timestamp: Date.now(),
        isLocal: false
    });
});

socket.on('connection-status', updateConnectionStatus);

// Connection Status
function updateConnectionStatus(status) {
    connectionStatus.className = 'connection-status ' + status.status;
    connectionStatus.querySelector('span').textContent = status.message || status.status;
}

// GIF Picker
async function searchGifs(query) {
    try {
        const response = await fetch(`/api/gifs${query ? '?q=' + encodeURIComponent(query) : ''}`);
        if (!response.ok) {
            throw new Error('Failed to fetch GIFs');
        }
        
        const data = await response.json();
        if (!data.results) {
            throw new Error('Invalid GIF data format');
        }

        gifResults.innerHTML = '';
        data.results.forEach(gif => {
            const img = document.createElement('img');
            img.src = gif.media_formats.tinygif.url;
            img.className = 'gif-item';
            img.loading = 'lazy';
            img.addEventListener('click', () => {
                sendMessage('gif', gif.media_formats.gif.url);
                gifPicker.style.display = 'none';
            });
            gifResults.appendChild(img);
        });
    } catch (error) {
        console.error('Error fetching GIFs:', error);
        gifResults.innerHTML = '<p class="error-message">Failed to load GIFs. Please try again.</p>';
    }
}

// Utility function for debouncing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Click outside to close pickers
document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
        emojiPicker.style.display = 'none';
    }
    if (!gifPicker.contains(e.target) && !gifBtn.contains(e.target)) {
        gifPicker.style.display = 'none';
    }
});

// Initialize the app
init();
