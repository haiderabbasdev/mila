// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

let currentUser = null;

// Auth state observer
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        // Get user token and authenticate socket
        user.getIdToken().then(token => {
            socket.emit('authenticate', token);
        });

        // Update UI
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'block';
        document.getElementById('userName').textContent = user.displayName || 'Guest';
        document.getElementById('userAvatar').src = user.photoURL || 'default-avatar.png';

        // Update user status in database
        const userStatusRef = database.ref(`users/${user.uid}`);
        userStatusRef.update({
            status: 'online',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });

        // Set offline status on disconnect
        userStatusRef.onDisconnect().update({
            status: 'offline',
            lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
    } else {
        currentUser = null;
        document.getElementById('authScreen').style.display = 'block';
        document.getElementById('welcomeScreen').style.display = 'none';
    }
});

// Google Sign In
document.getElementById('googleSignIn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(error => {
        console.error('Google sign in error:', error);
        alert('Failed to sign in with Google. Please try again.');
    });
});

// Guest Sign In
document.getElementById('guestSignIn').addEventListener('click', () => {
    auth.signInAnonymously().catch(error => {
        console.error('Anonymous sign in error:', error);
        alert('Failed to sign in as guest. Please try again.');
    });
});

// Sign Out
function signOut() {
    auth.signOut().catch(error => {
        console.error('Sign out error:', error);
        alert('Failed to sign out. Please try again.');
    });
}
