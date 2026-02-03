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
let isAddingMode = "channel";
let isRegisterMode = false;
let msgUnsub = null;

// --- AUTH LOGIC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        
        // Update online status in DB
        await updateDoc(doc(db, "users", user.uid), { online: true });
        
        document.getElementById('my-name').innerText = currentUser.username + (currentUser.admin ? " 🛠️" : "");
        document.getElementById('btn-admin-dash').style.display = currentUser.admin ? 'block' : 'none';
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

function syncSidebar() {
    const q = currentUser.admin 
        ? query(collection(db, "conversations"), orderBy("lastUpdated", "desc"))
        : query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));

    onSnapshot(q, (snap) => {
        const cList = document.getElementById('channel-list'), dList = document.getElementById('dm-list');
        cList.innerHTML = ""; dList.innerHTML = "";
        snap.forEach(d => {
            const data = d.data(), id = d.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            btn.innerText = (data.type === 'dm' ? "@ " : "# ") + (data.name || "Private DM");
            btn.onclick = () => openChat(id, data.name, data.type === 'dm');
            (data.type === 'dm' ? dList : cList).appendChild(btn);
        });
    });
}

async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    syncSidebar();

    document.getElementById('chat-title').innerText = name || "Chat";
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('btn-delete-channel').style.display = currentUser.admin ? 'block' : 'none';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : ''}`;
            div.innerHTML = `<div class="bubble">${m.content}</div>`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- SEARCH & ADD USER ---
const sInp = document.getElementById('search-user-input');
const resBox = document.getElementById('search-results');

sInp.oninput = async () => {
    const val = sInp.value.trim().toLowerCase();
    if (val.length < 2) return resBox.innerHTML = "";

    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);
    resBox.innerHTML = "";

    snap.forEach(d => {
        if (d.id === currentUser.id) return;
        const u = d.data();
        const div = document.createElement('div');
        div.className = "search-item";
        div.innerHTML = `
            <div>
                <span class="status-dot ${u.online ? 'online' : ''}"></span>
                <strong>${u.username}</strong>
            </div>
            <button class="add-user-action btn-primary" style="padding:4px 10px; font-size:11px; width:auto; border-radius:6px;">Add</button>
        `;
        div.onclick = async () => {
            if (isAddingMode === "channel") {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
                alert(`${u.username} added!`);
            } else {
                const dmId = [currentUser.id, d.id].sort().join("_dm_");
                await setDoc(doc(db, "conversations", dmId), { type: "dm", name: u.username, members: [currentUser.id, d.id], lastUpdated: serverTimestamp() }, { merge: true });
                openChat(dmId, u.username, true);
            }
            document.getElementById('search-modal').style.display = "none";
        };
        resBox.appendChild(div);
    });
};

// --- BUTTON EVENTS ---
document.getElementById('btn-auth-main').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    if (isRegisterMode) {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.chat`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, username_lower: u, admin: false, online: true });
    } else {
        await signInWithEmailAndPassword(auth, `${u}@salmon.chat`, p);
    }
};

document.getElementById('btn-create').onclick = async () => {
    const input = document.getElementById('new-channel-name');
    let name = input.value.trim().replace(/[^a-zA-Z0-9 ]/g, "");
    if (name.length < 3) return alert("Invalid Name");
    await addDoc(collection(db, "conversations"), { name: name, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
    input.value = "";
};

document.getElementById('btn-send').onclick = async () => {
    const v = document.getElementById('msg-input').value.trim();
    if (!v) return;
    document.getElementById('msg-input').value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: v, senderId: currentUser.id, timestamp: serverTimestamp() });
};

document.getElementById('header-add-user').onclick = () => { isAddingMode = "channel"; document.getElementById('search-modal').style.display = 'flex'; };
document.getElementById('open-dm-search').onclick = () => { isAddingMode = "dm"; document.getElementById('search-modal').style.display = 'flex'; };
document.getElementById('close-search').onclick = () => document.getElementById('search-modal').style.display = 'none';
document.getElementById('btn-logout').onclick = async () => {
    await updateDoc(doc(db, "users", currentUser.id), { online: false });
    signOut(auth);
};
