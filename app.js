import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let msgUnsub = null, memberUnsub = null, sidebarUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- HELPERS ---
function getBadges(user) {
    let b = "";
    if (user.dev) b += " 💻";
    if (user.admin) b += " 🛠️";
    if (user.mod) b += " 🛡️";
    if (user.salmon) b += " 🐟";
    if (user.vip) b += " 💎";
    if (user.verified) b += " ✅";
    return b;
}

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) { signOut(auth); return; }
        currentUser = { id: user.uid, ...snap.data() };
        
        if (!currentUser.username_lower) {
            await updateDoc(doc(db, "users", user.uid), { username_lower: currentUser.username.toLowerCase() });
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username}${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 20000);
        
        await autoJoinAnnouncements();
        syncSidebar();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR (FIXED CHANNELS & DM ONLINE) ---
function syncSidebar() {
    if (sidebarUnsub) sidebarUnsub();

    // Fetch ALL conversations the user is in to avoid indexing issues
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    
    sidebarUnsub = onSnapshot(q, async (snap) => {
        const channelsDiv = document.getElementById('channel-list');
        const dmsDiv = document.getElementById('dm-list');
        channelsDiv.innerHTML = "";
        dmsDiv.innerHTML = "";

        for (const d of snap.docs) {
            const data = d.data();
            const isDM = data.type === "dm";
            const active = activeChatId === d.id;
            const unread = !active && (data.lastUpdated?.toMillis() || 0) > (lastReadMap[d.id] || 0);
            
            const btn = document.createElement('div');
            btn.className = `channel-btn ${active ? 'active' : ''}`;
            
            if (isDM) {
                // Find the other user's ID to check status
                const otherId = data.members.find(id => id !== currentUser.id);
                const otherSnap = await getDoc(doc(db, "users", otherId));
                const otherData = otherSnap.data();
                const isOnline = otherData?.lastSeen && (Date.now() - otherData.lastSeen.toMillis() < 60000);
                
                btn.innerHTML = `<span class="dm-status ${isOnline ? 'online' : ''}"></span>@ ${otherData?.username || "User"}`;
                btn.onclick = () => openChat(d.id, otherData?.username, true);
                dmsDiv.appendChild(btn);
            } else {
                btn.innerHTML = `${unread ? '<span class="unread-dot"></span>' : ''}# ${data.name || "General"}`;
                btn.onclick = () => openChat(d.id, data.name, false);
                channelsDiv.appendChild(btn);
            }
        }
    });
}

// --- SEARCH ---
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
        div.innerHTML = `<b>${uData.username}</b>${getBadges(uData)}`;
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
            type: "dm", members: [currentUser.id, targetId], lastUpdated: serverTimestamp()
        });
        openChat(newDoc.id, targetName, true);
    }
    document.getElementById('search-modal').style.display = 'none';
}

// --- CHAT LOGIC ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(doc => {
            const m = doc.data();
            const div = document.createElement('div');
            div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
            div.innerHTML = `<div class="msg-meta">${m.senderName}</div><div class="bubble">${m.content}</div>`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

// BASIC AUTH
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
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};
document.getElementById('btn-logout').onclick = () => signOut(auth);

async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const s = await getDocs(q);
    if (!s.empty) await updateDoc(doc(db, "conversations", s.docs[0].id), { members: arrayUnion(currentUser.id) });
}
