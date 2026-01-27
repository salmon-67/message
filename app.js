import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, getDocs, deleteDoc, arrayUnion, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- PASTE YOUR CONFIG HERE ---
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
let activeChatId = null;
let msgUnsub = null;

// --- DOM ELEMENTS ---
const loginOverlay = document.getElementById('login-overlay');
const appLayout = document.getElementById('app-layout');
const errBox = document.getElementById('login-error');

// --- 1. AUTH STATE CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) {
                await signOut(auth);
                return;
            }

            currentUser = { id: user.uid, ...userSnap.data() };
            document.getElementById('my-name').innerText = currentUser.username;
            
            if (currentUser.admin) {
                document.getElementById('btn-open-admin').style.display = 'block';
            }

            loginOverlay.style.display = 'none';
            appLayout.style.display = 'flex';
            
            await setupAnnouncements();
            loadChannels();
        } catch (err) {
            console.error("Auth sync error:", err);
            errBox.innerText = "Error loading profile.";
        }
    } else {
        loginOverlay.style.display = 'flex';
        appLayout.style.display = 'none';
    }
});

// --- 2. LOGIN FUNCTION ---
const handleSignIn = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;

    if (!u || !p) {
        errBox.innerText = "Enter both username and password.";
        return;
    }

    try {
        errBox.innerText = "Connecting...";
        // We append @salmon.com so they only have to type their name
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        console.error("Login Error:", e.code);
        if (e.code === "auth/invalid-credential") errBox.innerText = "Wrong username or password.";
        else if (e.code === "auth/user-not-found") errBox.innerText = "User does not exist.";
        else errBox.innerText = "Error: " + e.code;
    }
};

// --- 3. REGISTER FUNCTION ---
const handleRegister = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;

    if (u.length < 3) { errBox.innerText = "Username too short."; return; }

    try {
        errBox.innerText = "Creating account...";
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, 
            verified: false, 
            admin: false,
            createdAt: serverTimestamp() 
        });
        errBox.innerText = "Account created! Logging in...";
    } catch (e) {
        errBox.innerText = "Register Error: " + e.code;
    }
};

// --- ATTACH EVENTS ---
document.getElementById('btn-signin').addEventListener('click', handleSignIn);
document.getElementById('btn-register').addEventListener('click', handleRegister);
document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- CHANNEL & CHAT LOGIC ---
async function setupAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
        await addDoc(collection(db, "conversations"), {
            name: "announcements",
            lastUpdated: serverTimestamp(),
            members: [currentUser.id]
        });
    } else {
        await updateDoc(doc(db, "conversations", snap.docs[0].id), {
            members: arrayUnion(currentUser.id)
        });
    }
}

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerText = `# ${data.name}`;
            btn.onclick = () => openChat(d.id, data.name);
            list.appendChild(btn);
        });
    });
}

function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === currentUser.id;
            const div = document.createElement('div');
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `
                <div style="font-size:10px; color:gray;">${m.senderName}</div>
                <div class="bubble">${m.content}</div>
            `;
            if (currentUser.admin) {
                const del = document.createElement('button');
                del.style = "color:red; background:none; border:none; font-size:9px; cursor:pointer;";
                del.innerText = "Delete";
                del.onclick = () => deleteDoc(doc(db, "conversations", id, "messages", d.id));
                div.appendChild(del);
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if(n) {
        await addDoc(collection(db, "conversations"), { name: n, lastUpdated: serverTimestamp(), members: [currentUser.id] });
        document.getElementById('new-channel-name').value = "";
    }
};
