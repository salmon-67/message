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
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- DEVICE BAN SYSTEM ---
function checkDeviceBan() {
    if (localStorage.getItem('salmon_status') === 'device_banned') {
        document.body.innerHTML = `
            <div style="height:100vh; display:flex; align-items:center; justify-content:center; background:#09090b; color:#ef4444; font-family:sans-serif; text-align:center; padding:20px;">
                <div>
                    <h1 style="font-size:48px; margin:0;">DEVICE BANNED</h1>
                    <p style="color:#a1a1aa; margin-top:10px;">Your access has been revoked. If this was a mistake, contact an admin.</p>
                    <button onclick="localStorage.removeItem('salmon_status'); location.reload();" style="margin-top:20px; background:none; border:1px solid #333; color:#555; cursor:pointer; padding:5px 10px; border-radius:4px;">Check for Unban</button>
                </div>
            </div>`;
        return true;
    }
    return false;
}
if (checkDeviceBan()) throw new Error("Blocked");

// --- HELPERS ---
async function sys(cid, t) {
    await addDoc(collection(db, "conversations", cid, "messages"), { content: t, senderId: "system", timestamp: serverTimestamp() });
}

function getBadges(u) {
    let b = "";
    if (u.dev) b += " 💻";
    if (u.admin) b += " 🛠️";
    if (u.salmon) b += " 🐟";
    if (u.verified) b += " ✅";
    return b;
}

// --- AUTH ---
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
        if (currentUser.admin) loadBannedList();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- ADMIN: BANNED USERS LIST ---
function loadBannedList() {
    const q = query(collection(db, "users"), where("banned", "==", true));
    onSnapshot(q, (snap) => {
        const side = document.getElementById('sidebar-right');
        // We append the banned list to the bottom of the right sidebar
        let banSection = document.getElementById('ban-section');
        if (!banSection) {
            banSection = document.createElement('div');
            banSection.id = 'ban-section';
            side.appendChild(banSection);
        }
        banSection.innerHTML = `<div class="section-label" style="color:var(--danger); margin-top:20px;">BANNED USERS</div>`;
        snap.forEach(uDoc => {
            const u = uDoc.data();
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `<span>${u.username}</span> <button onclick="unbanUser('${uDoc.id}', '${u.username}')" style="background:none; border:1px solid var(--accent); color:var(--accent); font-size:9px; cursor:pointer; border-radius:3px;">UNBAN</button>`;
            banSection.appendChild(div);
        });
    });
}

window.unbanUser = async (uid, name) => {
    if (!confirm(`Unban ${name}?`)) return;
    await updateDoc(doc(db, "users", uid), { banned: false });
    if (activeChatId) await sys(activeChatId, `🔓 ${name} was unbanned.`);
};

window.banUser = async (uid, name) => {
    if (!confirm(`BAN ${name}?`)) return;
    await updateDoc(doc(db, "users", uid), { banned: true });
    if (activeChatId) await sys(activeChatId, `🚫 ${name} was banned.`);
};

window.clearChat = async (chatId) => {
    if (!confirm("Clear all messages?")) return;
    const snap = await getDocs(query(collection(db, "conversations", chatId, "messages")));
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await sys(chatId, "🧹 Channel cleared by Admin.");
};

// --- CHAT LOGIC ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id; activeChatName = name.toLowerCase();
    
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    const clearBtn = currentUser.admin ? `<button onclick="clearChat('${id}')" style="background:none; border:1px solid var(--danger); color:var(--danger); font-size:10px; padding:2px 6px; cursor:pointer; border-radius:4px; margin-left:10px;">Clear</button>` : "";
    document.getElementById('chat-title').innerHTML = `<span>${isDM ? '@' : '#'} ${name}</span> ${clearBtn}`;
    document.getElementById('input-area').style.display = (activeChatName === "announcements" && !currentUser.admin) ? 'none' : 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(doc => {
            const m = doc.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg";
                div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                div.innerHTML = `<div class="msg-meta">${m.senderName}${getBadges(m.senderFlags || {})}</div><div class="bubble">${m.content}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });

    memberUnsub = onSnapshot(doc(db, "conversations", id), async (snap) => {
        const data = snap.data();
        const mList = document.getElementById('member-list');
        if (!mList) return;
        mList.innerHTML = "";
        if (!data || isDM) return;
        for (const uid of data.members) {
            const uSnap = await getDoc(doc(db, "users", uid));
            const uData = uSnap.data();
            const item = document.createElement('div');
            item.className = "member-item";
            let action = (currentUser.admin && uid !== currentUser.id) ? `<span style="color:var(--danger); cursor:pointer; font-size:10px; margin-left:10px;" onclick="banUser('${uid}', '${uData.username}')">BAN</span>` : "";
            item.innerHTML = `<span>${uData.username}${getBadges(uData)}</span>${action}`;
            mList.appendChild(item);
        }
    });
}

// --- SIDEBAR & AUTH (PREVIOUS LOGIC) ---
function syncSidebar() {
    onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.id)), (snap) => {
        const cDiv = document.getElementById('channel-list');
        const dDiv = document.getElementById('dm-list');
        cDiv.innerHTML = ""; dDiv.innerHTML = "";
        snap.forEach(async d => {
            const data = d.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(i => i !== currentUser.id);
                const u = await getDoc(doc(db, "users", other));
                btn.innerHTML = `@ ${u.data()?.username}`;
                btn.onclick = () => openChat(d.id, u.data()?.username, true);
                dDiv.appendChild(btn);
            } else {
                btn.innerHTML = `# ${data.name}`;
                btn.onclick = () => openChat(d.id, data.name, false);
                cDiv.appendChild(btn);
            }
        });
    });
}

document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if (!txt || !activeChatId || (activeChatName === "announcements" && !currentUser.admin)) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, salmon:!!currentUser.salmon, verified:!!currentUser.verified },
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-signin').onclick = () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
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
    if (n) {
        const r = await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() });
        await sys(r.id, `🚀 #${n} created`);
        document.getElementById('new-channel-name').value = "";
    }
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
