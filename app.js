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

let currentUser = null, activeChatId = null, msgUnsub = null, typingUnsub = null;
const sidebarL = document.getElementById('sidebar-left'), sidebarR = document.getElementById('sidebar-right'), overlay = document.getElementById('menu-overlay'), msgInput = document.getElementById('msg-input');

// --- THEME ---
const themeBtn = document.getElementById('theme-btn');
themeBtn.onclick = () => {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('salmon-theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
};
if (localStorage.getItem('salmon-theme') === 'light') document.body.classList.add('light-theme');

// --- SIDEBARS ---
document.getElementById('btn-toggle-menu').onclick = () => { sidebarL.classList.toggle('open'); overlay.classList.toggle('active'); };
document.getElementById('btn-toggle-members').onclick = () => { sidebarR.classList.toggle('open'); };
overlay.onclick = () => { sidebarL.classList.remove('open'); overlay.classList.remove('active'); };

// --- AUTH ---
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

document.getElementById('btn-login').onclick = () => {
    const u = document.getElementById('username').value.trim().toLowerCase(), p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(() => alert("Login Error"));
};

document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase(), p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, verified: false });
    } catch (e) { alert("Signup Error"); }
};

// --- CORE CHAT ---
async function openChat(id, name) {
    if (window.innerWidth <= 900) { sidebarL.classList.remove('open'); overlay.classList.remove('active'); }
    if (msgUnsub) msgUnsub(); if (typingUnsub) typingUnsub();
    activeChatId = id;
    
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('btn-leave').style.display = 'block';
    document.getElementById('chat-title').innerText = `# ${name}`;

    // Watch Members
    onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const members = docSnap.data().members, list = document.getElementById('member-list');
        list.innerHTML = "";
        for (const uid of members) {
            const uData = (await getDoc(doc(db, "users", uid))).data();
            const badge = uData?.verified ? `<span class="verified-badge"><img src="https://i.ibb.co/bc6596/image.png"></span>` : '';
            list.innerHTML += `<div class="member-item">${uData?.username || 'User'}${badge}</div>`;
        }
    });

    // Watch Typing
    typingUnsub = onSnapshot(collection(db, "conversations", id, "typing"), (snap) => {
        const typers = [];
        snap.forEach(d => { if(d.data().isTyping && d.id !== currentUser.uid) typers.push(d.data().name); });
        document.getElementById('typing-box').innerText = typers.length > 0 ? `${typers.join(', ')} is typing...` : '';
    });

    // Watch Messages
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), async (snap) => {
        const box = document.getElementById('messages'); box.innerHTML = "";
        for (const d of snap.docs) {
            const m = d.data(); if (!m.timestamp) continue;
            const uData = (await getDoc(doc(db, "users", m.senderId))).data();
            const badge = uData?.verified ? `<span class="verified-badge"><img src="https://i.ibb.co/bc6596/image.png"></span>` : '';
            const div = document.createElement('div');
            div.className = m.type === 'system' ? 'msg-system' : 'msg-container';
            div.innerHTML = m.type === 'system' ? m.content : `
                <div class="msg-sender">${m.senderName}${badge}</div>
                <div class="msg-content">${m.content}</div>
                <button class="action-btn" onclick="window.reactTo('${d.id}', '🐟')">🐟 ${m.reactions?.['🐟'] || 0}</button>
                ${m.senderId === currentUser.uid ? `<button class="action-btn" style="color:var(--danger)" onclick="window.deleteMsg('${d.id}')">Delete</button>` : ''}
            `;
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;
    });
}

// --- INPUT & ACTIONS ---
let tTimer;
msgInput.oninput = () => {
    msgInput.style.height = 'auto'; msgInput.style.height = msgInput.scrollHeight + 'px';
    if (activeChatId) {
        setDoc(doc(db, "conversations", activeChatId, "typing", currentUser.uid), { name: currentUser.email.split('@')[0], isTyping: true });
        clearTimeout(tTimer);
        tTimer = setTimeout(() => setDoc(doc(db, "conversations", activeChatId, "typing", currentUser.uid), { isTyping: false }), 2000);
    }
};

document.getElementById('btn-send').onclick = async () => {
    const c = msgInput.value.trim(); if (!c || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: c, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp(), reactions: {}, type: 'user' });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
    msgInput.value = ""; msgInput.style.height = 'auto';
    setDoc(doc(db, "conversations", activeChatId, "typing", currentUser.uid), { isTyping: false });
};

window.deleteMsg = (mid) => confirm("Delete?") && deleteDoc(doc(db, "conversations", activeChatId, "messages", mid));
window.reactTo = async (mid, e) => {
    const ref = doc(db, "conversations", activeChatId, "messages", mid), s = await getDoc(ref);
    await updateDoc(ref, { [`reactions.${e}`]: (s.data().reactions?.[e] || 0) + 1 });
};

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim(); if (!n) return;
    const d = await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid], lastUpdated: serverTimestamp() });
    await addDoc(collection(db, "conversations", d.id, "messages"), { content: `Channel #${n} created`, type: 'system', timestamp: serverTimestamp() });
    document.getElementById('group-name').value = "";
};

function autoLoadChannels() {
    onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid), orderBy("lastUpdated", "desc")), (snap) => {
        const list = document.getElementById('chat-list'); list.innerHTML = "";
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
