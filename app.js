import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, deleteDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let currentUser = null, activeChatId = null, msgUnsub = null;
const sidebar = document.getElementById('sidebar-left'), overlay = document.getElementById('menu-overlay'), msgInput = document.getElementById('msg-input');

// Sidebar Minimize/Toggle Function
const handleToggle = () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
};
document.getElementById('btn-toggle-menu').onclick = handleToggle;
overlay.onclick = handleToggle;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const name = user.email.split('@')[0];
        document.getElementById('user-display-name').innerText = name;
        document.getElementById('user-badge').innerText = name[0].toUpperCase();
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        autoLoadChannels();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

document.getElementById('btn-login').onclick = () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(() => alert("Login failed"));
};

document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch (e) { alert("Signup error"); }
};

async function openChat(id, name) {
    // Auto-close sidebar on mobile after selecting a channel
    if (window.innerWidth <= 900 && sidebar.classList.contains('open')) handleToggle();
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('btn-leave').style.display = 'block';
    document.getElementById('chat-title').innerText = `# ${name}`;

    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(qMsg, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        let lastDate = null;
        snap.forEach(d => {
            const m = d.data(); if (!m.timestamp) return;
            const date = m.timestamp.toDate();
            const dStr = date.toLocaleDateString();

            if (dStr !== lastDate) {
                const divD = document.createElement('div'); divD.className = 'date-divider';
                divD.innerText = dStr === new Date().toLocaleDateString() ? "Today" : dStr;
                box.appendChild(divD); lastDate = dStr;
            }

            const div = document.createElement('div');
            if (m.type === 'system') {
                div.className = 'msg-system';
                div.innerText = m.content;
            } else {
                div.className = 'msg-container';
                const isOwner = m.senderId === currentUser.uid;
                div.innerHTML = `
                    <div class="msg-header">
                        <span class="msg-sender">${m.senderName}</span>
                        <span class="msg-time">${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <div class="msg-content">${m.content}</div>
                    <button class="action-btn" onclick="window.reactTo('${d.id}', '🐟')">🐟 ${m.reactions?.['🐟'] || ''}</button>
                    ${isOwner ? `<button class="action-btn delete-btn" onclick="window.deleteMsg('${d.id}')">Delete</button>` : ''}
                `;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

function autoLoadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const item = document.createElement('div');
            item.className = `channel-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerText = `# ${data.name}`;
            item.onclick = () => openChat(d.id, data.name);
            list.appendChild(item);
        });
    });
}

window.deleteMsg = async (msgId) => {
    if (confirm("Delete this message?")) await deleteDoc(doc(db, "conversations", activeChatId, "messages", msgId));
};

window.reactTo = async (msgId, emoji) => {
    const msgRef = doc(db, "conversations", activeChatId, "messages", msgId);
    const snap = await getDoc(msgRef);
    const currentCount = snap.data().reactions?.[emoji] || 0;
    await updateDoc(msgRef, { [`reactions.${emoji}`]: currentCount + 1 });
};

document.getElementById('btn-send').onclick = async () => {
    const content = msgInput.value.trim();
    if (!content || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { 
        content, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp(), reactions: {}, type: 'user' 
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
    msgInput.value = "";
    msgInput.style.height = 'auto';
};

msgInput.oninput = function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; };

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim();
    if (n) {
        const dRef = await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid], lastUpdated: serverTimestamp() });
        await addDoc(collection(db, "conversations", dRef.id, "messages"), { content: `${currentUser.email.split('@')[0]} created #${n}`, type: 'system', timestamp: serverTimestamp() });
        document.getElementById('group-name').value = "";
    }
};

document.getElementById('btn-leave').onclick = async () => {
    if (!confirm("Leave this channel?")) return;
    const name = currentUser.email.split('@')[0];
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: `${name} left the group`, type: 'system', timestamp: serverTimestamp() });
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
    location.reload();
};

document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());
