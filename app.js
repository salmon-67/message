import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, where, limit, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let activeChatName = "";
let msgUnsub = null, sidebarUnsub = null, memberListUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- RANK SYSTEM ---
const getBadges = (u) => {
    let b = "";
    if (u.dev) b += '<span class="badge" title="Developer">💻</span>';
    if (u.admin) b += '<span class="badge" title="Admin">🛠️</span>';
    if (u.salmon) b += '<span class="badge" title="Staff">🐟</span>';
    if (u.verified) b += '<span class="badge" title="Verified">✅</span>';
    return b;
};

// --- AUTH & DEVICE BAN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (localStorage.getItem('salmon_status') === 'device_banned') { location.reload(); return; }
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };

        if (currentUser.banned) {
            localStorage.setItem('salmon_status', 'device_banned');
            signOut(auth); return;
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username}${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 15000);
        
        syncSidebar();
        loadAllMembers();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- LOAD MEMBERS (FIXED DUPLICATION) ---
function loadAllMembers() {
    if (memberListUnsub) memberListUnsub(); // Clear old listener to prevent duplicates
    memberListUnsub = onSnapshot(collection(db, "users"), (snap) => {
        const mList = document.getElementById('member-list');
        mList.innerHTML = ""; // Hard clear
        snap.forEach(uDoc => {
            const u = uDoc.data();
            const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 45000);
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `
                <span><span class="status-dot ${isOnline ? 'online' : ''}"></span>${u.username}${getBadges(u)}</span>
                ${currentUser.admin && uDoc.id !== currentUser.id ? `<button onclick="banUser('${uDoc.id}', '${u.username}')" style="color:var(--danger); background:none; border:none; cursor:pointer; font-size:10px;">BAN</button>` : ''}
            `;
            mList.appendChild(div);
        });
    });
}

// --- OPEN CHAT & NOTIFICATIONS ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    activeChatId = id; activeChatName = name.toLowerCase();
    
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    syncSidebar();

    document.getElementById('chat-title').innerHTML = `<span>${isDM ? '@' : '#'} ${name}</span> ${currentUser.admin ? `<button onclick="clearChat('${id}')" style="color:var(--danger); background:none; border:1px solid var(--danger); font-size:10px; padding:2px 5px; border-radius:4px; cursor:pointer; margin-left:10px;">Clear</button>` : ''}`;
    document.getElementById('input-area').style.display = (activeChatName === "announcements" && !currentUser.admin) ? 'none' : 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const edit = currentUser.admin ? `<span onclick="editMsg('${d.id}')" style="cursor:pointer; opacity:0.5; font-size:10px;"> [Edit]</span>` : "";
                div.innerHTML = `<div class="msg-meta">${m.senderName}${getBadges(m.senderFlags || {})}${edit}</div><div class="bubble">${m.content}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- SIDEBAR (FIXED ONLINE INDICATOR) ---
function syncSidebar() {
    if (sidebarUnsub) sidebarUnsub();
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    sidebarUnsub = onSnapshot(q, async (snap) => {
        const cDiv = document.getElementById('channel-list'), dDiv = document.getElementById('dm-list');
        cDiv.innerHTML = ""; dDiv.innerHTML = "";
        
        for (const docSnap of snap.docs) {
            const data = docSnap.data(), id = docSnap.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            
            if (data.type === 'dm') {
                const otherId = data.members.find(uid => uid !== currentUser.id);
                const u = (await getDoc(doc(db, "users", otherId))).data();
                const isOnline = u?.lastSeen && (Date.now() - u.lastSeen.toMillis() < 45000);
                btn.innerHTML = `<span class="dm-status ${isOnline ? 'online' : ''}"></span>${u?.username || 'User'}`;
                btn.onclick = () => openChat(id, u?.username, true);
                dDiv.appendChild(btn);
            } else {
                btn.innerHTML = `# ${data.name}`;
                btn.onclick = () => openChat(id, data.name, false);
                cDiv.appendChild(btn);
            }
        }
    });
}

// --- USER SEARCH & ADD TO CHAT (FIXED) ---
document.getElementById('search-user-input').oninput = async (e) => {
    const v = e.target.value.toLowerCase(), res = document.getElementById('search-results');
    if (v.length < 2) { res.innerHTML = ""; return; }
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", v), where("username_lower", "<=", v + '\uf8ff'), limit(5)));
    res.innerHTML = "";
    snap.forEach(d => {
        const u = d.data(); if (d.id === currentUser.id) return;
        const div = document.createElement('div'); div.className = "member-item"; div.style.cursor = "pointer";
        div.innerHTML = `<span><b>${u.username}</b>${getBadges(u)}</span>`;
        div.onclick = async () => {
            // Logic to create DM or add to current chat
            const newDm = await addDoc(collection(db, "conversations"), {
                type: 'dm',
                members: [currentUser.id, d.id],
                lastUpdated: serverTimestamp()
            });
            openChat(newDm.id, u.username, true);
            document.getElementById('search-modal').style.display = 'none';
        };
        res.appendChild(div);
    });
};

// --- ADMIN ACTIONS ---
window.editMsg = async (mid) => {
    const t = prompt("Edit message:");
    if (t) await updateDoc(doc(db, "conversations", activeChatId, "messages", mid), { content: t + " (edited)" });
};

window.banUser = async (uid, name) => {
    if (confirm(`Ban ${name}?`)) await updateDoc(doc(db, "users", uid), { banned: true });
};

window.clearChat = async (cid) => {
    if (!confirm("Clear all?")) return;
    const snap = await getDocs(collection(db, "conversations", cid, "messages"));
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
};

// --- CORE EVENTS ---
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input'), txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, salmon:!!currentUser.salmon, dev:!!currentUser.dev, verified:!!currentUser.verified },
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-signin').onclick = () => signInWithEmailAndPassword(auth, `${document.getElementById('login-user').value.toLowerCase()}@salmon.com`, document.getElementById('login-pass').value);
document.getElementById('btn-register').onclick = () => {
    const u = document.getElementById('login-user').value.toLowerCase(), p = document.getElementById('login-pass').value;
    createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p).then(r => setDoc(doc(db, "users", r.user.uid), { username: u, username_lower: u, admin:false }));
};
document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
document.getElementById('open-dm-search').onclick = () => document.getElementById('search-modal').style.display = 'flex';
