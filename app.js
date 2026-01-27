import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, getDocs, deleteDoc, arrayUnion, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let memberUnsub = null;

// --- 1. AUTH & PRESENCE ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) { signOut(auth); return; }

        currentUser = { id: user.uid, ...userSnap.data() };
        document.getElementById('my-name').innerText = currentUser.username;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        updatePresence();
        setInterval(updatePresence, 30000); // Pulse online status every 30s
        
        await autoJoinAnnouncements();
        loadChannels();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

async function updatePresence() {
    if (currentUser) {
        await updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() });
    }
}

// --- 2. CHANNELS ---
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

// --- 3. CHAT LOGIC (Messages & Members) ---
function formatTime(ts) {
    if (!ts) return "";
    const d = ts.toDate();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';

    // Real-time Members List
    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const list = document.getElementById('member-list');
        list.innerHTML = "";
        const mIds = docSnap.data()?.members || [];
        
        for (let uid of mIds) {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
                const u = uSnap.data();
                const now = Date.now();
                const isOnline = u.lastSeen && (now - u.lastSeen.toMillis() < 120000);
                
                const item = document.createElement('div');
                item.className = "member-item";
                item.innerHTML = `
                    <div class="status-dot ${isOnline ? 'online' : ''}"></div>
                    <div style="flex:1">
                        <b>${u.username}</b> ${u.verified ? "✅" : ""}
                        <div style="font-size:9px; opacity:0.3; cursor:pointer;" onclick="navigator.clipboard.writeText('${uid}'); alert('ID Copied')">ID: ${uid.substring(0,6)}...</div>
                    </div>
                `;
                list.appendChild(item);
            }
        }

        // Add Member Button (Only for Admins, Not in Announcements)
        if (name !== 'announcements' && currentUser.admin) {
            const inviteBox = document.createElement('div');
            inviteBox.style = "padding:10px; margin-top:10px; border-top:1px solid #333;";
            inviteBox.innerHTML = `
                <input type="text" id="target-id" class="input-box" placeholder="User ID" style="font-size:11px;">
                <button id="btn-do-invite" class="btn btn-primary" style="font-size:11px; padding:6px;">Add User</button>
            `;
            list.appendChild(inviteBox);
            document.getElementById('btn-do-invite').onclick = async () => {
                const target = document.getElementById('target-id').value.trim();
                if (target) await updateDoc(doc(db, "conversations", id), { members: arrayUnion(target) });
            };
        }
    });

    // Real-time Messages
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
            div.innerHTML = `
                <div class="msg-meta">${m.senderName} • ${formatTime(m.timestamp)}</div>
                <div class="bubble">${m.content}</div>
            `;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- 4. ACTIONS ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) {
        await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() });
        document.getElementById('new-channel-name').value = "";
    }
};

document.getElementById('btn-signin').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) { document.getElementById('login-error').innerText = "Failed to sign in."; }
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, admin: false, verified: false, createdAt: serverTimestamp() });
    } catch (e) { document.getElementById('login-error').innerText = e.code; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
        await updateDoc(doc(db, "conversations", snap.docs[0].id), { members: arrayUnion(currentUser.id) });
    } else {
        await addDoc(collection(db, "conversations"), { name: "announcements", members: [currentUser.id], lastUpdated: serverTimestamp() });
    }
}
