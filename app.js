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
let msgUnsub = null, sidebarUnsub = null, memberUnsub = null;
const ping = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');

// --- FORMATTING & MEDIA PREVIEW ---
function formatText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        // Image Preview
        if (url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
            return `<a href="${url}" target="_blank" class="chat-link">${url}</a><br><img src="${url}" style="max-width:200px; border-radius:8px; margin-top:5px; display:block;">`;
        }
        // YouTube Preview
        if (url.includes("youtube.com/watch?v=")) {
            const vid = url.split("v=")[1].split("&")[0];
            return `<a href="${url}" target="_blank" class="chat-link">${url}</a><br><iframe width="240" height="135" src="https://www.youtube.com/embed/${vid}" frameborder="0" allowfullscreen style="border-radius:8px; margin-top:5px;"></iframe>`;
        }
        return `<a href="${url}" target="_blank" class="chat-link">${url}</a>`;
    });
}

const getBadges = (u) => (u.dev ? '💻' : '') + (u.admin ? '🛠️' : '') + (u.salmon ? '🐟' : '') + (u.verified ? '✅' : '');

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (localStorage.getItem('salmon_status') === 'device_banned') { location.reload(); return; }
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        
        document.getElementById('my-name').innerHTML = `${currentUser.username} ${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 15000);
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- DYNAMIC MEMBER LIST (ROOM ONLY) ---
async function updateMemberList(memberIds) {
    const mList = document.getElementById('member-list');
    mList.innerHTML = "";
    for (const uid of memberIds) {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const u = uSnap.data();
            const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 45000);
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `<span><span class="status-dot ${isOnline ? 'online' : ''}"></span>${u.username} ${getBadges(u)}</span>
                ${currentUser.admin && uid !== currentUser.id ? `<button onclick="banUser('${uid}', '${u.username}')" style="color:var(--danger); background:none; border:none; cursor:pointer; font-size:10px;">BAN</button>` : ''}`;
            mList.appendChild(div);
        }
    }
}

// --- OPEN CHAT ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id; activeChatName = name.toLowerCase();
    syncSidebar();

    document.getElementById('chat-title').innerHTML = `<span>${isDM ? '@' : '#'} ${name}</span>`;
    document.getElementById('input-area').style.display = 'block';

    // Member List Listener for this room
    memberUnsub = onSnapshot(doc(db, "conversations", id), (snap) => {
        const data = snap.data();
        if (data && data.members) updateMemberList(data.members);
    });

    let firstLoad = true;
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMention = m.content.includes(`@${currentUser.username}`);
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'} ${isMention ? 'mention' : ''}`;
                div.innerHTML = `<div class="msg-meta">${m.senderName} ${getBadges(m.senderFlags || {})}</div><div class="bubble">${formatText(m.content)}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
        if (!firstLoad && snap.docChanges().some(c => c.type === "added" && c.doc.data().senderId !== currentUser.id)) ping.play().catch(()=>{});
        firstLoad = false;
    });
}

function syncSidebar() {
    onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.id)), async (snap) => {
        const cDiv = document.getElementById('channel-list'), dDiv = document.getElementById('dm-list');
        cDiv.innerHTML = ""; dDiv.innerHTML = "";
        snap.forEach(async docSnap => {
            const data = docSnap.data(), id = docSnap.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(uid => uid !== currentUser.id);
                const u = (await getDoc(doc(db, "users", other))).data();
                btn.innerHTML = `<span class="dm-status"></span>${u?.username || 'User'}`;
                btn.onclick = () => openChat(id, u?.username, true);
                dDiv.appendChild(btn);
            } else {
                btn.innerHTML = `# ${data.name}`;
                btn.onclick = () => openChat(id, data.name, false);
                cDiv.appendChild(btn);
            }
        });
    });
}

// --- SEARCH & ADD ---
document.getElementById('search-user-input').oninput = async (e) => {
    const v = e.target.value.toLowerCase(), res = document.getElementById('search-results');
    if (v.length < 2) { res.innerHTML = ""; return; }
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", v), where("username_lower", "<=", v + '\uf8ff'), limit(5)));
    res.innerHTML = "";
    snap.forEach(d => {
        const u = d.data(); if (d.id === currentUser.id) return;
        const div = document.createElement('div'); div.className = "member-item"; div.style.cursor = "pointer";
        div.innerHTML = `<span><b>${u.username}</b></span> <span style="color:var(--accent);">+ Add</span>`;
        div.onclick = async () => {
            if (activeChatId && !activeChatId.includes("_dm_")) {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
            } else {
                const dmId = [currentUser.id, d.id].sort().join("_dm_");
                await setDoc(doc(db, "conversations", dmId), { type: 'dm', members: [currentUser.id, d.id], lastUpdated: serverTimestamp() });
                openChat(dmId, u.username, true);
            }
            document.getElementById('search-modal').style.display = 'none';
        };
        res.appendChild(div);
    });
};

// --- CORE UI ---
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input'), txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, salmon:!!currentUser.salmon, dev:!!currentUser.dev, verified:!!currentUser.verified },
        timestamp: serverTimestamp()
    });
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

window.banUser = async (uid, name) => { if (confirm(`Ban ${name}?`)) await updateDoc(doc(db, "users", uid), { banned: true }); };
