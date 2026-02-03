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
let msgUnsub = null, sidebarUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- BADGES ---
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

// --- AUTH & INITIAL REPAIR ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) { signOut(auth); return; }
        currentUser = { id: user.uid, ...snap.data() };
        
        // Ensure old users are searchable
        if (!currentUser.username_lower) {
            await updateDoc(doc(db, "users", user.uid), { username_lower: currentUser.username.toLowerCase() });
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username}${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // Heartbeat for online status
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 15000);
        
        syncSidebar();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR LOGIC (FIXED CHANNELS & ONLINE STATUS) ---
function syncSidebar() {
    if (sidebarUnsub) sidebarUnsub();

    // FIXED: Fetch ALL conversations you are a member of. No complex "type" filters to break old channels.
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    
    sidebarUnsub = onSnapshot(q, async (snap) => {
        const channelsDiv = document.getElementById('channel-list');
        const dmsDiv = document.getElementById('dm-list');
        channelsDiv.innerHTML = "";
        dmsDiv.innerHTML = "";

        // Process all chats
        const allChats = [];
        snap.forEach(d => allChats.push({ id: d.id, ...d.data() }));
        
        // Sort by most recent message
        allChats.sort((a, b) => (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0));

        for (const data of allChats) {
            const isDM = data.type === "dm";
            const active = activeChatId === data.id;
            const unread = !active && (data.lastUpdated?.toMillis() || 0) > (lastReadMap[data.id] || 0);
            
            const btn = document.createElement('div');
            // FIXED: Class handling for blue active state and unread notifications
            btn.className = `channel-btn ${active ? 'active' : ''} ${unread ? 'unread' : ''}`;
            
            if (isDM) {
                const otherId = data.members.find(id => id !== currentUser.id);
                const otherSnap = await getDoc(doc(db, "users", otherId));
                const otherData = otherSnap.data();
                const isOnline = otherData?.lastSeen && (Date.now() - otherData.lastSeen.toMillis() < 45000);
                
                btn.innerHTML = `<span class="dm-status ${isOnline ? 'online' : ''}"></span>${otherData?.username || "User"}`;
                btn.onclick = () => openChat(data.id, otherData?.username, true);
                dmsDiv.appendChild(btn);
            } else {
                btn.innerHTML = `${unread ? '<span class="unread-dot"></span>' : ''}# ${data.name || "Unnamed Channel"}`;
                btn.onclick = () => openChat(data.id, data.name, false);
                channelsDiv.appendChild(btn);
            }
        }
    });
}

// --- OPEN CHAT (FIXED BLUE STATE & NOTIFICATIONS) ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    
    activeChatId = id;
    
    // Mark as read immediately
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    // Force sidebar to update so the blue highlight moves immediately
    syncSidebar();

    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(doc => {
            const m = doc.data();
            const div = document.createElement('div');
            div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
            const badges = m.senderFlags ? getBadges(m.senderFlags) : "";
            
            div.innerHTML = `
                <div class="msg-meta">${m.senderName}${badges}</div>
                <div class="bubble">${m.content}</div>
            `;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- MESSAGE SENDING ---
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    const txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt,
        senderId: currentUser.id,
        senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, salmon:!!currentUser.salmon, verified:!!currentUser.verified },
        timestamp: serverTimestamp()
    });
    
    await updateDoc(doc(db, "conversations", activeChatId), { 
        lastUpdated: serverTimestamp() 
    });
};

// --- USER SEARCH ---
document.getElementById('search-user-input').oninput = async (e) => {
    const val = e.target.value.trim().toLowerCase();
    const results = document.getElementById('search-results');
    if (val.length < 2) { results.innerHTML = ""; return; }

    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);
    results.innerHTML = "";

    snap.forEach(uDoc => {
        if (uDoc.id === currentUser.id) return;
        const uData = uDoc.data();
        const div = document.createElement('div');
        div.className = "member-item";
        div.style.cursor = "pointer";
        div.innerHTML = `<b>${uData.username}</b>${getBadges(uData)}`;
        div.onclick = async () => {
            // Check for existing DM
            const dmQ = query(collection(db, "conversations"), where("type", "==", "dm"), where("members", "array-contains", currentUser.id));
            const dmSnap = await getDocs(dmQ);
            let existingId = null;
            dmSnap.forEach(d => { if (d.data().members.includes(uDoc.id)) existingId = d.id; });

            if (existingId) {
                openChat(existingId, uData.username, true);
            } else {
                const newDoc = await addDoc(collection(db, "conversations"), {
                    type: "dm", members: [currentUser.id, uDoc.id], lastUpdated: serverTimestamp()
                });
                openChat(newDoc.id, uData.username, true);
            }
            document.getElementById('search-modal').style.display = 'none';
        };
        results.appendChild(div);
    });
};

// --- AUTH BUTTONS ---
document.getElementById('btn-signin').onclick = () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(e => alert("Login Failed"));
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
        await addDoc(collection(db, "conversations"), { 
            name: n, 
            type: 'channel', 
            members: [currentUser.id], 
            lastUpdated: serverTimestamp() 
        });
        document.getElementById('new-channel-name').value = "";
    }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);
