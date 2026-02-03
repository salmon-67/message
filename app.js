import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let msgUnsub = null, memberUnsub = null, channelUnsub = null, dmUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- 1. FORMATTING HELPERS ---
function getBadges(user) {
    let b = "";
    if (user.dev) b += " 💻";
    if (user.admin) b += " 🛠️";
    if (user.mod) b += " 🛡️";
    if (user.salmon) b += " 🐟";
    if (user.vip) b += " 💎";
    if (user.verified) b += " ✅"; // Verified is now a tick
    return b;
}

function formatMsg(text) {
    let f = text.replace(/(https?:\/\/[^\s]+)/g, url => `<a href="${url}" target="_blank" class="chat-link">${url}</a>`);
    f = f.replace(/@([a-z0-9]+)/gi, match => `<span class="mention">${match}</span>`);
    return f;
}

// --- 2. AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) { signOut(auth); return; }
        
        currentUser = { id: user.uid, ...snap.data() };
        
        // Auto-fix for old users: ensure they have a searchable lowercase name
        if (!currentUser.username_lower) {
            await updateDoc(doc(db, "users", user.uid), { username_lower: currentUser.username.toLowerCase() });
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username}${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // Online Status Heartbeat
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 20000);
        
        await autoJoinAnnouncements();
        syncSidebar();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- 3. SIDEBAR (CHANNELS & DMs) ---
function syncSidebar() {
    if (channelUnsub) channelUnsub();
    if (dmUnsub) dmUnsub();

    // Query everything that ISN'T a DM for the channel list
    const qChan = currentUser.admin 
        ? query(collection(db, "conversations"), where("type", "!=", "dm"))
        : query(collection(db, "conversations"), where("type", "!=", "dm"), where("members", "array-contains", currentUser.id));

    channelUnsub = onSnapshot(qChan, (snap) => renderList(document.getElementById('channel-list'), snap, false));

    // Query DMs
    const qDM = query(collection(db, "conversations"), where("type", "==", "dm"), where("members", "array-contains", currentUser.id));
    dmUnsub = onSnapshot(qDM, (snap) => renderList(document.getElementById('dm-list'), snap, true));
}

function renderList(container, snap, isDM) {
    if (!container) return;
    const docs = [];
    snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0));

    container.innerHTML = "";
    docs.forEach(data => {
        const active = activeChatId === data.id;
        const unread = !active && (data.lastUpdated?.toMillis() || 0) > (lastReadMap[data.id] || 0);
        
        let name = data.name || "General";
        if (isDM && data.memberNames) {
            name = data.memberNames.find(n => n !== currentUser.username) || "Private Chat";
        }

        const div = document.createElement('div');
        div.className = `channel-btn ${active ? 'active' : ''} ${unread ? 'unread' : ''}`;
        div.innerHTML = `${unread ? '<span class="unread-dot"></span>' : ''}${isDM ? '@' : '#'} ${name}`;
        div.onclick = () => openChat(data.id, name, isDM);
        container.appendChild(div);
    });
}

// --- 4. CHAT WINDOW ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    
    activeChatId = id;
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    document.getElementById('chat-title').innerHTML = `
        <div style="display:flex; flex-direction:column;">
            <span>${isDM ? '@' : '#'} ${name}</span>
            <small id="typing-text" style="color:#3b82f6; font-size:10px; height:12px; font-weight:normal;"></small>
        </div>
    `;

    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';
    setupMembers(id, isDM);

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg";
                div.innerHTML = m.content;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const badges = m.senderFlags ? getBadges(m.senderFlags) : "";
                const tools = (currentUser.admin || m.senderId === currentUser.id) ? `<span class="msg-tools" onclick="handleTool('${id}','${d.id}','${m.senderId}')">⚙️</span>` : "";
                
                div.innerHTML = `
                    <div class="msg-meta">${m.senderName}${badges} ${tools}</div>
                    <div class="bubble">${formatMsg(m.content)}${m.edited ? ' <small style="opacity:0.5">(edited)</small>' : ''}</div>
                `;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- 5. SEARCH & DMs ---
const searchInput = document.getElementById('search-user-input');
const searchResults = document.getElementById('search-results');

searchInput.oninput = async () => {
    const val = searchInput.value.trim().toLowerCase();
    if (val.length < 2) { searchResults.innerHTML = ""; return; }

    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);
    searchResults.innerHTML = "";

    snap.forEach(uDoc => {
        if (uDoc.id === currentUser.id) return;
        const uData = uDoc.data();
        const div = document.createElement('div');
        div.className = "member-item";
        div.style.cursor = "pointer";
        div.innerHTML = `<span><b>${uData.username}</b>${getBadges(uData)}</span>`;
        div.onclick = () => startDM(uDoc.id, uData.username);
        searchResults.appendChild(div);
    });
};

async function startDM(targetId, targetName) {
    const q = query(collection(db, "conversations"), where("type", "==", "dm"), where("members", "array-contains", currentUser.id));
    const snap = await getDocs(q);
    let existingId = null;
    snap.forEach(d => { if (d.data().members.includes(targetId)) existingId = d.id; });

    if (existingId) {
        openChat(existingId, targetName, true);
    } else {
        const newDoc = await addDoc(collection(db, "conversations"), {
            type: "dm", members: [currentUser.id, targetId], memberNames: [currentUser.username, targetName], lastUpdated: serverTimestamp()
        });
        openChat(newDoc.id, targetName, true);
    }
    document.getElementById('search-modal').style.display = 'none';
}

// --- 6. MEMBERS & TYPING ---
function setupMembers(id, isDM) {
    const side = document.getElementById('sidebar-right');
    if (isDM) { side.innerHTML = "<div class='header'>PRIVATE DM</div>"; return; }

    side.innerHTML = `<div class="header">MEMBERS</div><div id="m-list" class="scroll-area"></div><div class="add-box"><input type="text" id="add-inp" class="input-box" style="font-size:12px;" placeholder="Add user..."><button id="add-btn" class="btn btn-primary" style="padding:5px; margin-top:5px; font-size:12px;">Add</button></div>`;

    document.getElementById('add-btn').onclick = async () => {
        const val = document.getElementById('add-inp').value.trim();
        const q = query(collection(db, "users"), where("username_lower", "==", val.toLowerCase()), limit(1));
        const s = await getDocs(q);
        if (!s.empty) {
            await updateDoc(doc(db, "conversations", id), { members: arrayUnion(s.docs[0].id) });
            await sys(id, `👋 Added ${s.docs[0].data().username}`);
            document.getElementById('add-inp').value = "";
        }
    };

    memberUnsub = onSnapshot(doc(db, "conversations", id), async (snap) => {
        const data = snap.data(); if (!data) return;
        const list = document.getElementById('m-list'); list.innerHTML = "";
        
        const typingDiv = document.getElementById('typing-text');
        const typers = data.typing || {};
        const activeTypers = Object.keys(typers).filter(uid => uid !== currentUser.id && (Date.now() - typers[uid].toMillis() < 3000));
        typingDiv.innerText = activeTypers.length > 0 ? "Someone is typing..." : "";

        for (let uid of data.members) {
            const u = await getDoc(doc(db, "users", uid));
            if (u.exists()) {
                const ud = u.data();
                const online = ud.lastSeen && (Date.now() - ud.lastSeen.toMillis() < 60000);
                const item = document.createElement('div');
                item.className = "member-item";
                item.innerHTML = `<span><div class="status-dot ${online ? 'online' : ''}"></div>${ud.username}${getBadges(ud)}</span>`;
                list.appendChild(item);
            }
        }
    });
}

// --- 7. MESSAGE SEND & COMMANDS ---
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";

    // Command Logic
    if (txt.startsWith('/') && currentUser.admin) {
        const p = txt.split(' '); // [/promote, username, role]
        const q = query(collection(db, "users"), where("username_lower", "==", p[1].toLowerCase()), limit(1));
        const s = await getDocs(q);
        if (!s.empty) {
            await updateDoc(doc(db, "users", s.docs[0].id), { [p[2]]: p[0] === '/promote' });
            await sys(activeChatId, `🛠️ Admin ${p[0] === '/promote' ? 'granted' : 'revoked'} ${p[2]} for ${p[1]}`);
        }
        return;
    }

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, salmon:!!currentUser.salmon, verified:!!currentUser.verified, mod:!!currentUser.mod, vip:!!currentUser.vip, dev:!!currentUser.dev },
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp(), [`typing.${currentUser.id}`]: null });
};

// Tool Actions (Edit/Delete)
window.handleTool = async (chatId, msgId, ownerId) => {
    const choice = prompt("Choose: (1) Delete, (2) Edit");
    if (choice === "1" && currentUser.admin) {
        await deleteDoc(doc(db, "conversations", chatId, "messages", msgId));
    } else if (choice === "2" && ownerId === currentUser.id) {
        const nt = prompt("New message:");
        if (nt) await updateDoc(doc(db, "conversations", chatId, "messages", msgId), { content: nt, edited: true });
    }
};

document.getElementById('msg-input').oninput = () => {
    if (activeChatId) updateDoc(doc(db, "conversations", activeChatId), { [`typing.${currentUser.id}`]: serverTimestamp() });
};

// Auth & Setup Helpers
document.getElementById('btn-signin').onclick = () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(() => alert("Fail"));
};

document.getElementById('btn-register').onclick = () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p).then(r => {
        setDoc(doc(db, "users", r.user.uid), { username: u, username_lower: u, admin:false, lastSeen: serverTimestamp() });
    });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

async function sys(cid, t) {
    await addDoc(collection(db, "conversations", cid, "messages"), { content: t, senderId: "system", timestamp: serverTimestamp() });
    await updateDoc(doc(db, "conversations", cid), { lastUpdated: serverTimestamp() });
}

async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const s = await getDocs(q);
    if (!s.empty) await updateDoc(doc(db, "conversations", s.docs[0].id), { members: arrayUnion(currentUser.id) });
}
