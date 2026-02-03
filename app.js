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
let isAddingMode = "channel"; 
let msgUnsub = null, memberUnsub = null;

// --- AUTH & ADMIN SYNC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        document.getElementById('my-name').innerText = currentUser.username + (currentUser.admin ? " [ADMIN]" : "");
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR: ADMINS SEE ALL ROOMS ---
async function syncSidebar() {
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

// --- OPEN CHAT ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id;

    const isAnnounce = name?.toLowerCase().includes("announcement");
    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('btn-leave-room').style.display = (isDM || isAnnounce) ? 'none' : 'block';
    document.getElementById('header-add-user').style.display = (isDM || isAnnounce) ? 'none' : 'block';
    document.getElementById('btn-delete-channel').style.display = currentUser.admin ? 'block' : 'none';

    // Shadow Mode: Admins don't send "Joined" alerts unless they aren't already members
    const roomSnap = await getDoc(doc(db, "conversations", id));
    if (!roomSnap.data().members.includes(currentUser.id)) {
        await updateDoc(doc(db, "conversations", id), { members: arrayUnion(currentUser.id) });
        if (!currentUser.admin) { // Only alert if NOT admin
            await addDoc(collection(db, "conversations", id, "messages"), {
                content: `${currentUser.username} joined.`, senderId: "system", timestamp: serverTimestamp()
            });
        }
    }

    // Member List
    memberUnsub = onSnapshot(doc(db, "conversations", id), (snap) => {
        const list = document.getElementById('member-list'); list.innerHTML = "";
        (snap.data()?.members || []).forEach(async uid => {
            const u = (await getDoc(doc(db, "users", uid))).data();
            const div = document.createElement('div'); div.className = "member-item";
            div.innerHTML = `<span>${u?.username}</span>${currentUser.admin && uid !== currentUser.id ? `<button onclick="kickUser('${uid}')" class="btn-danger">Kick</button>` : ''}`;
            list.appendChild(div);
        });
    });

    // Messages
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const del = currentUser.admin ? `<span onclick="deleteMsg('${d.id}')" style="color:red; cursor:pointer; margin-left:8px;">×</span>` : "";
                div.innerHTML = `<div class="bubble">${m.content}${del}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- ADMIN & USER ACTIONS ---
window.kickUser = async (uid) => {
    if (confirm("Kick user?")) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(uid) });
        await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: "A user was kicked.", senderId: "system", timestamp: serverTimestamp() });
    }
};

window.deleteMsg = async (mid) => { if (confirm("Delete message?")) await deleteDoc(doc(db, "conversations", activeChatId, "messages", mid)); };

document.getElementById('btn-leave-room').onclick = async () => {
    if (confirm("Leave chat?")) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.id) });
        await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: `${currentUser.username} left.`, senderId: "system", timestamp: serverTimestamp() });
        location.reload();
    }
};

document.getElementById('btn-delete-channel').onclick = async () => {
    if (confirm("Delete this room forever?")) {
        const batch = writeBatch(db);
        const msgs = await getDocs(collection(db, "conversations", activeChatId, "messages"));
        msgs.forEach(m => batch.delete(m.ref));
        batch.delete(doc(db, "conversations", activeChatId));
        await batch.commit();
        location.reload();
    }
};

// --- SEARCH ---
const sInp = document.getElementById('search-user-input');
sInp.oninput = async () => {
    const v = sInp.value.toLowerCase(); if (v.length < 2) return;
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", v), where("username_lower", "<=", v + '\uf8ff'), limit(5)));
    const res = document.getElementById('search-results'); res.innerHTML = "";
    snap.forEach(d => {
        if (d.id === currentUser.id) return;
        const div = document.createElement('div'); div.className = "search-item";
        div.innerHTML = `<span>${d.data().username}</span>`;
        div.onclick = async () => {
            if (isAddingMode === "channel") {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
                await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: `${d.data().username} was added.`, senderId: "system", timestamp: serverTimestamp() });
            } else {
                const dmId = [currentUser.id, d.id].sort().join("_dm_");
                await setDoc(doc(db, "conversations", dmId), { type: "dm", members: [currentUser.id, d.id], lastUpdated: serverTimestamp() });
                openChat(dmId, d.data().username, true);
            }
            document.getElementById('search-modal').style.display = "none";
        };
        res.appendChild(div);
    });
};

document.getElementById('header-add-user').onclick = () => { isAddingMode="channel"; document.getElementById('search-modal').style.display="flex"; };
document.getElementById('open-dm-search').onclick = () => { isAddingMode="dm"; document.getElementById('search-modal').style.display="flex"; };
document.getElementById('close-search').onclick = () => document.getElementById('search-modal').style.display="none";

document.getElementById('btn-send').onclick = async () => {
    const val = document.getElementById('msg-input').value.trim();
    if (!val) return;
    document.getElementById('msg-input').value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: val, senderId: currentUser.id, timestamp: serverTimestamp() });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};

document.getElementById('btn-signin').onclick = () => signInWithEmailAndPassword(auth, `${document.getElementById('login-user').value.toLowerCase()}@salmon.com`, document.getElementById('login-pass').value);
document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.toLowerCase(), p = document.getElementById('login-pass').value;
    const r = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    await setDoc(doc(db, "users", r.user.uid), { username: u, username_lower: u, admin: false });
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
