import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
const msgInput = document.getElementById('msg-input');

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const uDoc = await getDoc(doc(db, "users", user.uid));
        if (uDoc.data()?.admin) document.getElementById('btn-open-admin').style.display = 'block';
        
        document.getElementById('user-display-name').innerText = user.email.split('@')[0];
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        autoLoadChannels();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// --- CORE CHAT & ANNOUNCEMENTS ---
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('chat-title').innerText = `# ${name}`;

    const uData = (await getDoc(doc(db, "users", currentUser.uid))).data();
    const isRestricted = name.toLowerCase() === "announcements" && !uData.admin;
    document.getElementById('input-area').style.display = isRestricted ? 'none' : 'block';
    if (isRestricted) document.getElementById('typing-box').innerText = "Announcements are read-only.";

    // Load Messages
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), async (snap) => {
        const box = document.getElementById('messages'); box.innerHTML = "";
        for (const d of snap.docs) {
            const m = d.data(); if (!m.timestamp) continue;
            const sData = (await getDoc(doc(db, "users", m.senderId))).data();
            const badge = sData?.verified ? `<span class="verified-badge"><img src="https://i.ibb.co/bc6596/image.png"></span>` : '';
            
            const div = document.createElement('div');
            div.className = m.type === 'system' ? 'msg-system' : 'msg-container';
            div.innerHTML = m.type === 'system' ? m.content : `
                <div class="msg-sender">${m.senderName}${badge}</div>
                <div class="msg-content">${m.content}</div>
                <div><button class="action-btn" onclick="window.reactTo('${d.id}', '🐟')">🐟 ${m.reactions?.['🐟'] || 0}</button></div>
            `;
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;
    });

    // Populate Member Sidebar
    const cSnap = await getDoc(doc(db, "conversations", id));
    const mList = document.getElementById('member-list'); mList.innerHTML = "";
    for (const uid of cSnap.data().members) {
        const mData = (await getDoc(doc(db, "users", uid))).data();
        mList.innerHTML += `<div class="member-card" style="font-size:13px; font-weight:600;">${mData.username} ${mData.verified ? '⭐' : ''}</div>`;
    }
}

// --- ADMIN DASHBOARD LOGIC ---
document.getElementById('btn-open-admin').onclick = async () => {
    const dash = document.getElementById('admin-dashboard');
    const uList = document.getElementById('admin-user-list');
    dash.style.display = 'flex';
    uList.innerHTML = "Loading Users...";
    
    const usersSnap = await getDocs(collection(db, "users"));
    uList.innerHTML = "";
    usersSnap.forEach(uDoc => {
        const u = uDoc.data();
        const div = document.createElement('div');
        div.style = "padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;";
        div.innerHTML = `
            <span>${u.username} ${u.verified ? '✅' : ''}</span>
            <button onclick="window.toggleVerify('${uDoc.id}', ${u.verified})" style="background:var(--accent); color:white; border:none; padding:5px 10px; border-radius:5px; font-size:10px; cursor:pointer;">
                ${u.verified ? 'Unverify' : 'Verify'}
            </button>
        `;
        uList.appendChild(div);
    });
};

window.toggleVerify = async (uid, currentStatus) => {
    await updateDoc(doc(db, "users", uid), { verified: !currentStatus });
    document.getElementById('btn-open-admin').click(); // Refresh list
};

// --- REST OF UI LOGIC ---
document.getElementById('btn-send').onclick = async () => {
    const c = msgInput.value.trim(); if (!c) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: c, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp(), reactions: {}, type: 'user' });
    msgInput.value = "";
};

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim(); if (!n) return;
    await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid], lastUpdated: serverTimestamp() });
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

window.reactTo = async (mid, e) => {
    const ref = doc(db, "conversations", activeChatId, "messages", mid), s = await getDoc(ref);
    await updateDoc(ref, { [`reactions.${e}`]: (s.data().reactions?.[e] || 0) + 1 });
};

document.getElementById('btn-toggle-members').onclick = () => {
    const sr = document.getElementById('sidebar-right');
    sr.style.display = sr.style.display === 'none' ? 'flex' : 'none';
};

document.getElementById('btn-login').onclick = () => signInWithEmailAndPassword(auth, `${document.getElementById('username').value}@salmon.com`, document.getElementById('password').value);
document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value;
    const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, document.getElementById('password').value);
    await setDoc(doc(db, "users", res.user.uid), { username: u, verified: false, admin: false });
};
document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());
