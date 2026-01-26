import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, deleteDoc, arrayRemove, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let currentUser = null, activeChatId = null, msgUnsub = null, typingUnsub = null;
const sidebar = document.getElementById('sidebar-left'), overlay = document.getElementById('menu-overlay'), msgInput = document.getElementById('msg-input');

// --- THEME & MENU TOGGLES ---
const themeBtn = document.getElementById('theme-btn');
themeBtn.onclick = () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    themeBtn.innerText = isLight ? '☀️' : '🌙';
    localStorage.setItem('salmon-theme', isLight ? 'light' : 'dark');
};
if (localStorage.getItem('salmon-theme') === 'light') {
    document.body.classList.add('light-theme');
    themeBtn.innerText = '☀️';
}

const handleToggle = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('active'); };
document.getElementById('btn-toggle-menu').onclick = handleToggle;
overlay.onclick = handleToggle;

// --- AUTH MONITOR ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('user-display-name').innerText = user.email.split('@')[0];
        document.getElementById('user-badge').innerText = user.email[0].toUpperCase();
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        autoLoadChannels();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// --- LOGIN / SIGNUP ---
document.getElementById('btn-login').onclick = () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(() => alert("Error logging in"));
};

document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, verified: false });
    } catch (e) { alert("Error creating account"); }
};

// --- CHAT LOGIC ---
async function openChat(id, name) {
    if (window.innerWidth <= 900) handleToggle();
    if (msgUnsub) msgUnsub();
    if (typingUnsub) typingUnsub();
    activeChatId = id;
    
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('btn-leave').style.display = 'block';
    document.getElementById('chat-title').innerText = `# ${name}`;

    // Typing Watcher
    typingUnsub = onSnapshot(collection(db, "conversations", id, "typing"), (snap) => {
        const typers = [];
        snap.forEach(d => { if(d.data().isTyping && d.id !== currentUser.uid) typers.push(d.data().name); });
        document.getElementById('typing-box').innerText = typers.length > 0 ? `${typers.join(', ')} is typing...` : '';
    });

    // Messages Watcher
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(qMsg, async (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        for (const docSnap of snap.docs) {
            const m = docSnap.data(); if (!m.timestamp) continue;
            
            // Check for Verified Badge in Users collection
            const uRef = doc(db, "users", m.senderId);
            const uSnap = await getDoc(uRef);
            const isVerified = uSnap.exists() && uSnap.data().verified === true;
            const badge = isVerified ? `<span class="verified-badge"><img src="https://i.ibb.co/bc6596/image.png" alt="v"></span>` : '';

            const div = document.createElement('div');
            if (m.type === 'system') {
                div.className = 'msg-system';
                div.innerText = m.content;
            } else {
                div.className = 'msg-container';
                const isOwner = m.senderId === currentUser.uid;
                div.innerHTML = `
                    <div class="msg-sender">${m.senderName}${badge}</div>
                    <div class="msg-content">${m.content}</div>
                    <button class="action-btn" onclick="window.reactTo('${docSnap.id}', '🐟')">🐟 ${m.reactions?.['🐟'] || 0}</button>
                    ${isOwner ? `<button class="action-btn" style="color:var(--danger)" onclick="window.deleteMsg('${docSnap.id}')">Delete</button>` : ''}
                `;
            }
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;
    });
}

// --- TYPING DETECTION ---
let typingTimer;
msgInput.oninput = () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = (msgInput.scrollHeight) + 'px';
    
    if (activeChatId && currentUser) {
        setDoc(doc(db, "conversations", activeChatId, "typing", currentUser.uid), {
            name: currentUser.email.split('@')[0], isTyping: true
        });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            setDoc(doc(db, "conversations", activeChatId, "typing", currentUser.uid), { isTyping: false });
        }, 2000);
    }
};

// --- GLOBAL WINDOW FUNCTIONS ---
window.deleteMsg = async (msgId) => {
    if (confirm("Delete this?")) await deleteDoc(doc(db, "conversations", activeChatId, "messages", msgId));
};

window.reactTo = async (msgId, emoji) => {
    const msgRef = doc(db, "conversations", activeChatId, "messages", msgId);
    const snap = await getDoc(msgRef);
    const count = snap.data().reactions?.[emoji] || 0;
    await updateDoc(msgRef, { [`reactions.${emoji}`]: count + 1 });
};

// --- CONTROLS ---
document.getElementById('btn-send').onclick = async () => {
    const content = msgInput.value.trim();
    if (!content || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { 
        content, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], 
        timestamp: serverTimestamp(), reactions: {}, type: 'user' 
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
    msgInput.value = "";
    msgInput.style.height = 'auto';
    setDoc(doc(db, "conversations", activeChatId, "typing", currentUser.uid), { isTyping: false });
};

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim();
    if (!n) return;
    const dRef = await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid], lastUpdated: serverTimestamp() });
    await addDoc(collection(db, "conversations", dRef.id, "messages"), { content: `Channel #${n} created`, type: 'system', timestamp: serverTimestamp() });
    document.getElementById('group-name').value = "";
};

function autoLoadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.className = `channel-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerText = `# ${d.data().name}`;
            item.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(item);
        });
    });
}

document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());
