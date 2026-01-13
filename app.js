import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBt0V_lY3Y6rjRmw1kVu-xCj1UZTxiEYbU",
    authDomain: "message-salmon.firebaseapp.com",
    projectId: "message-salmon",
    storageBucket: "message-salmon.firebasestorage.app",
    messagingSenderId: "538903396338",
    appId: "1:538903396338:web:325543bb4a2a08863ff56b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;

// --- AUTH LOGIC ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadMessages();
    }
});

// --- LOAD MESSAGES ---
function loadMessages() {
    const q = query(collection(db, "public_chat"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snapshot) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            if (!data.content || !data.timestamp) return; // Bouncer: prevents errors

            const div = document.createElement('div');
            const isMine = data.senderId === currentUser.uid;
            div.className = `msg ${isMine ? 'mine' : ''}`;
            div.innerHTML = `
                <div style="font-size:10px; opacity:0.6;">${data.senderName}</div>
                <div>${data.content}</div>
            `;
            msgDiv.appendChild(div);
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });
}

// --- BUTTONS (The Fixed Way) ---
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    await addDoc(collection(db, "public_chat"), {
        content: text,
        senderId: currentUser.uid,
        senderName: currentUser.email.split('@')[0],
        timestamp: serverTimestamp()
    });
});

document.getElementById('btn-login').addEventListener('click', async () => {
    const u = document.getElementById('username').value.trim() + "@salmon.com";
    const p = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, u, p);
    } catch (e) {
        alert("Login failed: " + e.message);
    }
});

document.getElementById('btn-signup').addEventListener('click', async () => {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value;
    if (u.length < 3) return alert("Username too short");

    try {
        const res = await createUserWithEmailAndPassword(auth, u + "@salmon.com", p);
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch (e) {
        alert("Signup failed: " + e.message);
    }
});
