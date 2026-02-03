import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// (Note: Ensure your SDK imports point to the correct firebase sub-modules as per your config)
import { getFirestore as fs, collection as col, doc as dc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let isAddingMode = "channel";
let isRegisterMode = false;
let msgUnsub = null, memberUnsub = null;

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        const rank = currentUser.admin ? " 🛠️" : (currentUser.vip ? " ✨" : "");
        document.getElementById('my-name').innerText = currentUser.username + rank;
        document.getElementById('btn-admin-dash').style.display = currentUser.admin ? 'block' : 'none';
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR & HIGHLIGHT ---
function syncSidebar() {
    const q = currentUser.admin 
        ? query(collection(db, "conversations"), orderBy("lastUpdated", "desc"))
        : query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));

    onSnapshot(q, (snap) => {
        const cList = document.getElementById('channel-list'), dList = document.getElementById('dm-list');
        cList.innerHTML = ""; dList.innerHTML = "";
        snap.forEach(async d => {
            const data = d.data(), id = d.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(uid => uid !== currentUser.id) || data.members[0];
                const uSnap = await getDoc(doc(db, "users", other));
                btn.innerText = "@ " + (uSnap.data()?.username || "Private DM");
                btn.onclick = () => openChat(id, uSnap.data()?.username, true);
                dList.appendChild(btn);
            } else {
                btn.innerText = "# " + data.name;
                btn.onclick = () => openChat(id, data.name, false);
                cList.appendChild(btn);
            }
        });
    });
}

// --- OPEN CHAT & HEADER ACTIONS ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub(); if (memberUnsub) memberUnsub();
    activeChatId = id;
    syncSidebar();

    const isAnnounce = name?.toLowerCase().includes("announcement");
    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('btn-delete-channel').style.display = currentUser.admin ? 'block' : 'none';
    document.getElementById('btn-leave-room').style.display = (isDM || isAnnounce) ? 'none' : 'block';
    document.getElementById('header-add-user').style.display = (isDM || isAnnounce) ? 'none' : 'block';

    const roomRef = doc(db, "conversations", id);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.data().members.includes(currentUser.id)) {
        await updateDoc(roomRef, { members: arrayUnion(currentUser.id) });
        if (!currentUser.admin) {
            await addDoc(collection(db, "conversations", id, "messages"), { content: `${currentUser.username} joined.`, senderId: "system", timestamp: serverTimestamp() });
        }
    }

    // Message Listener
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), async (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        for (const d of snap.docs) {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                const s = (await getDoc(doc(db, "users", m.senderId))).data();
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const del = currentUser.admin ? `<span onclick="deleteMsg('${d.id}')" style="color:red; cursor:pointer; margin-left:8px;">×</span>` : "";
                div.innerHTML = `<div style="font-size:10px; color:var(--text-dim); margin-bottom:2px;">${s?.username}</div><div class="bubble">${m.content}${del}</div>`;
            }
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;
    });
}

// --- ANTI-SPAM CREATE ---
document.getElementById('btn-create').onclick = async () => {
    const input = document.getElementById('new-channel-name');
    let name = input.value.trim().replace(/[^a-zA-Z0-9 ]/g, "");
    
    if (name.length < 3 || name.length > 20) return alert("Invalid Name (3-20 chars, no symbols)");

    const q = query(collection(db, "conversations"), where("name", "==", name), limit(1));
    const check = await getDocs(q);
    if (!check.empty) return alert("Channel exists!");

    await addDoc(collection(db, "conversations"), {
        name: name, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp()
    });
    input.value = "";
};

// --- LEAVE ROOM ---
document.getElementById('btn-leave-room').onclick = async () => {
    if (!confirm("Leave this room?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.id) });
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: `${currentUser.username} left.`, senderId: "system", timestamp: serverTimestamp() });
    location.reload();
};

// --- AUTH BUTTONS ---
document.getElementById('btn-auth-main').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    const email = `${u}@salmon.chat`;
    if (isRegisterMode) {
        const res = await createUserWithEmailAndPassword(auth, email, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, username_lower: u, admin: false, vip: false });
    } else {
        await signInWithEmailAndPassword(auth, email, p);
    }
};

document.getElementById('btn-auth-toggle').onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-status').innerText = isRegisterMode ? "Create Account" : "Sign In";
};

document.getElementById('btn-send').onclick = async () => {
    const v = document.getElementById('msg-input').value.trim(); if (!v) return;
    document.getElementById('msg-input').value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: v, senderId: currentUser.id, timestamp: serverTimestamp() });
};

document.getElementById('btn-logout').onclick = () => signOut(auth);
document.getElementById('btn-admin-dash').onclick = () => document.getElementById('admin-overlay').style.display = 'flex';
document.getElementById('close-admin').onclick = () => document.getElementById('admin-overlay').style.display = 'none';
document.getElementById('header-add-user').onclick = () => document.getElementById('search-modal').style.display = 'flex';
document.getElementById('close-search').onclick = () => document.getElementById('search-modal').style.display = 'none';
