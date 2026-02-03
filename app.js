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
let msgUnsub = null, sidebarUnsub = null, memberUnsub = null, banUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- 1. DEVICE BAN CHECK ---
function checkDeviceBan() {
    if (localStorage.getItem('salmon_status') === 'device_banned') {
        document.body.innerHTML = `
            <div style="height:100vh; display:flex; align-items:center; justify-content:center; background:#09090b; color:#ef4444; text-align:center; padding:20px;">
                <div><h1 style="font-size:40px;">DEVICE BANNED</h1><p style="color:#a1a1aa;">Access revoked.</p>
                <button onclick="localStorage.removeItem('salmon_status'); location.reload();" style="background:none; border:1px solid #333; color:#555; padding:5px 10px; cursor:pointer; margin-top:20px;">Check for Unban</button></div>
            </div>`;
        return true;
    }
    return false;
}
if (checkDeviceBan()) throw new Error("Blocked");

// --- 2. HELPERS ---
const getBadges = (u) => (u.dev ? " 💻" : "") + (u.admin ? " 🛠️" : "") + (u.salmon ? " 🐟" : "") + (u.verified ? " ✅" : "");
async function sys(cid, t) { await addDoc(collection(db, "conversations", cid, "messages"), { content: t, senderId: "system", timestamp: serverTimestamp() }); }

// --- 3. AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) { signOut(auth); return; }
        currentUser = { id: user.uid, ...snap.data() };
        
        if (currentUser.banned) {
            localStorage.setItem('salmon_status', 'device_banned');
            checkDeviceBan();
            signOut(auth);
            return;
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username}${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 15000);
        syncSidebar();
        if (currentUser.admin) syncBannedList();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- 4. SIDEBAR ---
function syncSidebar() {
    if (sidebarUnsub) sidebarUnsub();
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    sidebarUnsub = onSnapshot(q, async (snap) => {
        const cDiv = document.getElementById('channel-list'), dDiv = document.getElementById('dm-list');
        cDiv.innerHTML = ""; dDiv.innerHTML = "";
        
        for (const docSnap of snap.docs) {
            const data = docSnap.data(), id = docSnap.id, isActive = activeChatId === id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${isActive ? 'active' : ''}`;
            
            if (data.type === 'dm') {
                const otherId = data.members.find(uid => uid !== currentUser.id);
                const uSnap = await getDoc(doc(db, "users", otherId));
                const u = uSnap.data();
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

// --- 5. CHAT & ADMIN TOOLS ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub(); if (memberUnsub) memberUnsub();
    activeChatId = id; activeChatName = name.toLowerCase();
    syncSidebar();

    const clearBtn = currentUser.admin ? `<button id="btn-clear" style="background:none; border:1px solid var(--danger); color:var(--danger); font-size:10px; cursor:pointer; padding:2px 5px; border-radius:4px;">Clear</button>` : "";
    document.getElementById('chat-title').innerHTML = `<span>${isDM ? '@' : '#'} ${name}</span> ${clearBtn}`;
    if (currentUser.admin) document.getElementById('btn-clear').onclick = () => clearChat(id);

    document.getElementById('input-area').style.display = (activeChatName === "announcements" && !currentUser.admin) ? 'none' : 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data(), div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                div.innerHTML = `<div class="msg-meta">${m.senderName}${getBadges(m.senderFlags || {})}</div><div class="bubble">${m.content}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });

    memberUnsub = onSnapshot(doc(db, "conversations", id), async (snap) => {
        const mList = document.getElementById('member-list'); mList.innerHTML = "";
        const data = snap.data(); if (!data || isDM) return;
        for (const uid of data.members) {
            const u = (await getDoc(doc(db, "users", uid))).data();
            const div = document.createElement('div'); div.className = "member-item";
            let action = (currentUser.admin && uid !== currentUser.id) ? `<span style="color:var(--danger); cursor:pointer;" onclick="banUser('${uid}', '${u.username}')">BAN</span>` : "";
            div.innerHTML = `<span>${u.username}${getBadges(u)}</span> ${action}`;
            mList.appendChild(div);
        }
    });
}

// --- 6. ADMIN FUNCTIONS ---
window.banUser = async (uid, name) => {
    if (confirm(`Ban ${name}?`)) {
        await updateDoc(doc(db, "users", uid), { banned: true });
        await sys(activeChatId, `🚫 ${name} was banned.`);
    }
};

window.unbanUser = async (uid, name) => {
    if (confirm(`Unban ${name}?`)) await updateDoc(doc(db, "users", uid), { banned: false });
};

async function clearChat(chatId) {
    if (!confirm("Clear all messages?")) return;
    const snap = await getDocs(collection(db, "conversations", chatId, "messages"));
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await sys(chatId, "🧹 Channel cleared by Admin.");
}

function syncBannedList() {
    const q = query(collection(db, "users"), where("banned", "==", true));
    onSnapshot(q, (snap) => {
        const root = document.getElementById('admin-tools');
        root.innerHTML = `<div class="section-label" style="color:var(--danger);">BANNED</div>`;
        snap.forEach(d => {
            const u = d.data();
            const div = document.createElement('div'); div.className = "member-item";
            div.innerHTML = `<span>${u.username}</span> <button onclick="unbanUser('${d.id}', '${u.username}')" style="background:none; border:1px solid var(--accent); color:var(--accent); font-size:10px; cursor:pointer;">Unban</button>`;
            root.appendChild(div);
        });
    });
}

// --- 7. UI EVENTS ---
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input'), txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, salmon:!!currentUser.salmon, verified:!!currentUser.verified },
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
    if (n) {
        const r = await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() });
        await sys(r.id, `🚀 #${n} created`);
    }
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
document.getElementById('open-dm-search').onclick = () => { document.getElementById('search-modal').style.display = 'flex'; document.getElementById('search-user-input').focus(); };

// Search Logic
document.getElementById('search-user-input').oninput = async (e) => {
    const v = e.target.value.toLowerCase(), res = document.getElementById('search-results');
    if (v.length < 2) { res.innerHTML = ""; return; }
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", v), where("username_lower", "<=", v + '\uf8ff'), limit(5)));
    res.innerHTML = "";
    snap.forEach(d => {
        const u = d.data(); if (d.id === currentUser.id) return;
        const div = document.createElement('div'); div.className = "member-item"; div.style.cursor = "pointer";
        div.innerHTML = `<b>${u.username}</b>${getBadges(u)}`;
        div.onclick = async () => {
            const dmDoc = await addDoc(collection(db, "conversations"), { type: 'dm', members: [currentUser.id, d.id], lastUpdated: serverTimestamp() });
            openChat(dmDoc.id, u.username, true);
            document.getElementById('search-modal').style.display = 'none';
        };
        res.appendChild(div);
    });
};
