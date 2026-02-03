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
let isAddingMode = false; // Add to Group vs Start DM

let msgUnsub = null, sidebarUnsub = null, memberUnsub = null;
const ping = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');

// --- FORMATTING ---
function formatText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        if (url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
            return `<a href="${url}" target="_blank" class="chat-link">${url}</a><br><img src="${url}" style="max-width:250px; border-radius:8px; margin-top:8px; display:block; border:var(--border);">`;
        }
        if (url.includes("youtube.com/watch?v=")) {
            const vid = url.split("v=")[1].split("&")[0];
            return `<a href="${url}" target="_blank" class="chat-link">${url}</a><br><iframe width="280" height="157" src="https://www.youtube.com/embed/${vid}" frameborder="0" allowfullscreen style="border-radius:8px; margin-top:8px;"></iframe>`;
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
        if (currentUser.banned) { localStorage.setItem('salmon_status', 'device_banned'); signOut(auth); return; }

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

// --- MEMBER LIST (FORCED ROOM SYNC) ---
async function updateMemberList(memberIds) {
    const mList = document.getElementById('member-list');
    mList.innerHTML = ""; // FORCE CLEAR
    
    for (const uid of memberIds) {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const u = uSnap.data();
            const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 45000);
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `
                <span><span class="status-dot ${isOnline ? 'online' : ''}"></span>${u.username}</span>
                ${currentUser.admin && uid !== currentUser.id ? `<button onclick="banUser('${uid}', '${u.username}')" class="btn-danger">BAN</button>` : ''}
            `;
            mList.appendChild(div);
        }
    }
}

// --- OPEN CHAT ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    
    activeChatId = id; activeChatName = name;

    document.getElementById('chat-title').innerText = (isDM ? '@ ' : '# ') + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('header-add-user').style.display = isDM ? 'none' : 'block';
    document.getElementById('btn-delete-channel').style.display = (currentUser.admin && !isDM) ? 'block' : 'none';

    // ROOM MEMBERS ONLY
    memberUnsub = onSnapshot(doc(db, "conversations", id), (snap) => {
        const data = snap.data();
        if (data && data.members) updateMemberList(data.members);
    });

    // MESSAGES
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
                const edit = currentUser.admin ? `<span onclick="editMsg('${d.id}')" style="opacity:0.3; cursor:pointer; font-size:9px;"> Edit</span>` : "";
                div.innerHTML = `<div class="msg-meta">${m.senderName} ${getBadges(m.senderFlags || {})}${edit}</div><div class="bubble">${formatText(m.content)}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
        if (!firstLoad && snap.docChanges().some(c => c.type === "added" && c.doc.data().senderId !== currentUser.id)) ping.play().catch(()=>{});
        firstLoad = false;
    });
}

// --- SEARCH & PROMPT LOGIC ---
const searchInput = document.getElementById('search-user-input');

document.getElementById('header-add-user').onclick = () => {
    isAddingMode = true;
    document.getElementById('search-modal-title').innerText = "Add User to Channel";
    document.getElementById('search-modal').style.display = 'flex';
    searchInput.focus();
};

document.getElementById('open-dm-search').onclick = () => {
    isAddingMode = false;
    document.getElementById('search-modal-title').innerText = "Start a Direct Message";
    document.getElementById('search-modal').style.display = 'flex';
    searchInput.focus();
};

searchInput.oninput = async (e) => {
    const v = e.target.value.toLowerCase(), res = document.getElementById('search-results');
    if (v.length < 2) { res.innerHTML = ""; return; }
    
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", v), where("username_lower", "<=", v + '\uf8ff'), limit(5)));
    res.innerHTML = "";
    
    snap.forEach(d => {
        const u = d.data(); if (d.id === currentUser.id) return;
        const div = document.createElement('div'); div.className = "member-item";
        div.innerHTML = `<span><b>${u.username}</b></span> <span style="color:var(--accent);">Select</span>`;
        
        div.onclick = async () => {
            if (isAddingMode) {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
                await addDoc(collection(db, "conversations", activeChatId, "messages"), { 
                    content: `${u.username} was added.`, senderId: "system", timestamp: serverTimestamp() 
                });
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

// --- CORE ---
function syncSidebar() {
    sidebarUnsub = onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.id)), (snap) => {
        const cDiv = document.getElementById('channel-list'), dDiv = document.getElementById('dm-list');
        cDiv.innerHTML = ""; dDiv.innerHTML = "";
        snap.forEach(async docSnap => {
            const data = docSnap.data(), id = docSnap.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(uid => uid !== currentUser.id);
                const uSnap = await getDoc(doc(db, "users", other));
                btn.innerHTML = `<span>@ ${uSnap.data()?.username || 'User'}</span>`;
                btn.onclick = () => openChat(id, uSnap.data()?.username, true);
                dDiv.appendChild(btn);
            } else {
                btn.innerHTML = `<span># ${data.name}</span>`;
                btn.onclick = () => openChat(id, data.name, false);
                cDiv.appendChild(btn);
            }
        });
    });
}

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

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};

document.getElementById('btn-delete-channel').onclick = async () => {
    if (confirm("Delete this channel?")) {
        await deleteDoc(doc(db, "conversations", activeChatId));
        location.reload();
    }
};

window.banUser = async (uid, name) => { if (confirm(`Ban ${name}?`)) await updateDoc(doc(db, "users", uid), { banned: true }); };
window.editMsg = async (mid) => {
    const t = prompt("Edit:");
    if (t) await updateDoc(doc(db, "conversations", activeChatId, "messages", mid), { content: t + " (edited)" });
};

document.getElementById('btn-signin').onclick = () => signInWithEmailAndPassword(auth, `${document.getElementById('login-user').value.toLowerCase()}@salmon.com`, document.getElementById('login-pass').value);
document.getElementById('btn-register').onclick = () => {
    const u = document.getElementById('login-user').value.toLowerCase(), p = document.getElementById('login-pass').value;
    createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p).then(r => setDoc(doc(db, "users", r.user.uid), { username: u, username_lower: u, admin:false }));
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
