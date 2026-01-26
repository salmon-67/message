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
let typingUnsub = null;

// --- AUTHENTICATION & AUTO-JOIN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        let userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            signOut(auth);
            return;
        }

        currentUser = { id: user.uid, ...userSnap.data() };
        document.getElementById('my-name').innerText = currentUser.username;
        document.getElementById('my-avatar').innerText = currentUser.username[0].toUpperCase();
        
        // UI Permissions
        if (currentUser.admin) {
            document.getElementById('btn-open-admin').style.display = 'block';
            document.getElementById('btn-group-settings').style.display = 'block';
        }

        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // 1. Ensure Announcements exists & user is in it
        await setupAnnouncements();
        // 2. Load the list
        loadChannels();
    } else {
        document.getElementById('app-layout').style.display = 'none';
        document.getElementById('login-overlay').style.display = 'flex';
    }
});

async function setupAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    
    let announceId;
    if (snap.empty) {
        // Create it if it doesn't exist
        const docRef = await addDoc(collection(db, "conversations"), {
            name: "announcements",
            lastUpdated: serverTimestamp(),
            members: [currentUser.id],
            typing: {}
        });
        announceId = docRef.id;
    } else {
        announceId = snap.docs[0].id;
        // Auto-add current user to members
        await updateDoc(doc(db, "conversations", announceId), {
            members: arrayUnion(currentUser.id)
        });
    }
}

// LOGIN & REGISTER
document.getElementById('btn-signin').onclick = () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(e => {
        document.getElementById('login-error').innerText = "Failed: Check credentials.";
    });
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, verified: false, admin: false, createdAt: serverTimestamp() 
        });
    } catch (e) { document.getElementById('login-error').innerText = e.message; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());

// --- CHANNELS ---
function loadChannels() {
    onSnapshot(query(collection(db, "conversations"), orderBy("lastUpdated", "desc")), (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerHTML = `<span># ${data.name}</span>`;
            btn.onclick = () => openChat(d.id, data.name);
            list.appendChild(btn);
        });
    });
}

async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    if (typingUnsub) typingUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    
    // --- LOCKDOWN ANNOUNCEMENTS ---
    const isAnnounce = name.toLowerCase() === 'announcements';
    if (isAnnounce && !currentUser.admin) {
        document.getElementById('input-area').style.display = 'none';
    } else {
        document.getElementById('input-area').style.display = 'block';
    }
    
    updateMembers(id);
    listenTyping(id);

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === currentUser.id;
            const div = document.createElement('div');
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `
                <div class="msg-meta">${m.senderName}</div>
                <div class="bubble">${m.content}</div>
            `;
            // Admin can delete any message
            if (currentUser.admin) {
                const del = document.createElement('button');
                del.className = "delete-btn"; del.innerText = "Delete";
                del.onclick = () => deleteDoc(doc(db, "conversations", id, "messages", d.id));
                div.appendChild(del);
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- TYPING ---
const msgInput = document.getElementById('msg-input');
msgInput.oninput = () => {
    if (!activeChatId) return;
    updateDoc(doc(db, "conversations", activeChatId), { [`typing.${currentUser.id}`]: true });
    setTimeout(() => {
        updateDoc(doc(db, "conversations", activeChatId), { [`typing.${currentUser.id}`]: false });
    }, 3000);
};

function listenTyping(id) {
    typingUnsub = onSnapshot(doc(db, "conversations", id), (d) => {
        const data = d.data();
        let typers = 0;
        if (data && data.typing) {
            for (let uid in data.typing) {
                if (data.typing[uid] && uid !== currentUser.id) typers++;
            }
        }
        document.getElementById('typing-indicator').innerText = typers > 0 ? "Someone is typing..." : "";
    });
}

// --- MESSAGING ---
document.getElementById('btn-send').onclick = sendMessage;
msgInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !activeChatId) return;
    msgInput.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
}

// --- POWER ADMIN PANEL ---
document.getElementById('btn-open-admin').onclick = async () => {
    document.getElementById('admin-overlay').style.display = 'flex';
    const list = document.getElementById('admin-user-list');
    list.innerHTML = "Loading...";
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    
    snap.forEach(d => {
        const u = d.data();
        if (d.id === currentUser.id) return;
        
        const row = document.createElement('div');
        row.style = "padding:15px; border-bottom:1px solid #333; display:flex; flex-direction:column; gap:10px;";
        row.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${u.username} ${u.verified ? '✅' : ''}</strong>
                <div style="display:flex; gap:5px;">
                    <button class="btn verify-toggle" data-id="${d.id}" data-v="${u.verified}" style="background:var(--accent); font-size:10px; padding:5px;">Verify</button>
                    <button class="btn kick-btn" data-id="${d.id}" style="background:var(--danger); font-size:10px; padding:5px; color:white;">KICK</button>
                </div>
            </div>
            <div style="display:flex; gap:5px;">
                <input type="text" class="input-box" placeholder="Rename user..." style="margin:0; padding:5px; height:30px;">
                <button class="btn change-name-btn" data-id="${d.id}" style="background:var(--bg-input); color:white; width:auto; font-size:10px;">Rename</button>
            </div>
        `;
        list.appendChild(row);
    });

    document.querySelectorAll('.verify-toggle').forEach(b => b.onclick = async (e) => {
        const isV = e.target.dataset.v === 'true';
        await updateDoc(doc(db, "users", e.target.dataset.id), { verified: !isV });
        document.getElementById('btn-open-admin').onclick();
    });

    document.querySelectorAll('.change-name-btn').forEach(b => b.onclick = async (e) => {
        const newName = e.target.previousElementSibling.value;
        if (newName) {
            await updateDoc(doc(db, "users", e.target.dataset.id), { username: newName });
            document.getElementById('btn-open-admin').onclick();
        }
    });

    document.querySelectorAll('.kick-btn').forEach(b => b.onclick = async (e) => {
        if (confirm("Kick user?")) {
            await deleteDoc(doc(db, "users", e.target.dataset.id));
            document.getElementById('btn-open-admin').onclick();
        }
    });
};

// --- GROUP SETTINGS ---
document.getElementById('btn-group-settings').onclick = () => {
    document.getElementById('channel-settings-overlay').style.display = 'flex';
    document.getElementById('edit-channel-name').value = document.getElementById('chat-title').innerText.replace('# ', '');
};

document.getElementById('btn-save-channel').onclick = async () => {
    const newName = document.getElementById('edit-channel-name').value;
    if (newName && activeChatId) {
        await updateDoc(doc(db, "conversations", activeChatId), { name: newName });
        document.getElementById('channel-settings-overlay').style.display = 'none';
    }
};

// --- MEMBERS ---
async function updateMembers(id) {
    const snap = await getDoc(doc(db, "conversations", id));
    const mems = snap.data().members || [];
    const list = document.getElementById('member-list');
    list.innerHTML = "";
    for (let uid of mems) {
        const u = await getDoc(doc(db, "users", uid));
        if (u.exists()) {
            const div = document.createElement('div');
            div.style = "padding:10px; font-size:13px; border-bottom:1px solid rgba(255,255,255,0.05)";
            div.innerHTML = `${u.data().username} ${u.data().verified ? '✅' : ''} ${u.data().admin ? '🛡️' : ''}`;
            list.appendChild(div);
        }
    }
}

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) {
        await addDoc(collection(db, "conversations"), { 
            name: n, lastUpdated: serverTimestamp(), members: [currentUser.id], typing: {}
        });
        document.getElementById('new-channel-name').value = "";
    }
};

document.getElementById('btn-toggle-members').onclick = () => {
    const s = document.getElementById('sidebar-right');
    s.style.display = (s.style.display === 'none') ? 'flex' : 'none';
};
