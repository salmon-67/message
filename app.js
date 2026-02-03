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
let isAddingToGroup = false; 
let msgUnsub = null, memberUnsub = null;

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        document.getElementById('my-name').innerText = currentUser.username + (currentUser.admin ? " 🛠️" : "");
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- ADMIN: DELETE MESSAGE ---
window.deleteMsg = async (msgId) => {
    if (!currentUser.admin) return;
    if (confirm("Delete this message?")) {
        try {
            await deleteDoc(doc(db, "conversations", activeChatId, "messages", msgId));
        } catch (e) { console.error("Error deleting message:", e); }
    }
};

// --- ADMIN: DELETE ROOM (RECURSIVE) ---
document.getElementById('btn-delete-channel').onclick = async () => {
    if (!currentUser.admin || !activeChatId) return;
    if (confirm("Permanently delete this room and ALL messages?")) {
        try {
            // 1. Get all messages in the subcollection
            const msgSnap = await getDocs(collection(db, "conversations", activeChatId, "messages"));
            const batch = writeBatch(db);
            
            // 2. Batch delete messages
            msgSnap.forEach((msgDoc) => batch.delete(msgDoc.ref));
            
            // 3. Delete the conversation document itself
            batch.delete(doc(db, "conversations", activeChatId));
            
            await batch.commit();
            
            // 4. Reset UI
            activeChatId = null;
            document.getElementById('messages-box').innerHTML = "";
            document.getElementById('chat-title').innerText = "# Select a chat";
            document.getElementById('chat-actions').style.display = "none";
        } catch (e) {
            alert("Delete failed. You might lack permissions.");
            console.error(e);
        }
    }
};

// --- OPEN CHAT ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id;

    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    
    // Only show room delete button if admin AND it's not a DM
    document.getElementById('btn-delete-channel').style.display = (currentUser.admin && !isDM) ? 'block' : 'none';

    memberUnsub = onSnapshot(doc(db, "conversations", id), (snap) => {
        if (snap.exists() && snap.data().members) loadMembers(snap.data().members);
    });

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                // Added a small 'x' for admins to delete messages
                const delBtn = currentUser.admin ? `<span onclick="deleteMsg('${d.id}')" style="cursor:pointer; color:red; margin-left:8px; font-size:10px;">[x]</span>` : "";
                div.innerHTML = `<div class="bubble">${m.content} ${delBtn}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- REMAINING FUNCTIONS (MEMBER LIST, SIDEBAR, SEARCH) ---
async function loadMembers(memberIds) {
    const list = document.getElementById('member-list');
    list.innerHTML = "";
    for (const uid of memberIds) {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const u = uSnap.data();
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `<span><span class="status-dot online"></span>${u.username}</span>`;
            list.appendChild(div);
        }
    }
}

function syncSidebar() {
    onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.id)), (snap) => {
        const cList = document.getElementById('channel-list'), dList = document.getElementById('dm-list');
        cList.innerHTML = ""; dList.innerHTML = "";
        snap.forEach(async d => {
            const data = d.data(), id = d.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(uid => uid !== currentUser.id);
                const u = (await getDoc(doc(db, "users", other))).data();
                btn.innerText = "@ " + (u?.username || "User");
                btn.onclick = () => openChat(id, u?.username, true);
                dList.appendChild(btn);
            } else {
                btn.innerText = "# " + data.name;
                btn.onclick = () => openChat(id, data.name, false);
                cList.appendChild(btn);
            }
        });
    });
}

const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-user-input');
const searchResults = document.getElementById('search-results');

document.getElementById('header-add-user').onclick = () => {
    isAddingToGroup = true;
    document.getElementById('search-title').innerText = "Add User";
    searchModal.style.display = "flex";
    searchInput.value = ""; searchResults.innerHTML = "";
};

document.getElementById('open-dm-search').onclick = () => {
    isAddingMode = false;
    document.getElementById('search-title').innerText = "New DM";
    searchModal.style.display = "flex";
    searchInput.value = ""; searchResults.innerHTML = "";
};

searchInput.oninput = async () => {
    const val = searchInput.value.toLowerCase();
    if (val.length < 2) return;
    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);
    searchResults.innerHTML = "";
    snap.forEach(d => {
        if (d.id === currentUser.id) return;
        const u = d.data();
        const div = document.createElement('div');
        div.className = "search-item";
        div.innerHTML = `<span>${u.username}</span> <span>+</span>`;
        div.onclick = async () => {
            if (isAddingToGroup) {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
                await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: `${u.username} joined.`, senderId: "system", timestamp: serverTimestamp() });
            } else {
                const dmId = [currentUser.id, d.id].sort().join("_dm_");
                await setDoc(doc(db, "conversations", dmId), { type: "dm", members: [currentUser.id, d.id], lastUpdated: serverTimestamp() });
                openChat(dmId, u.username, true);
            }
            searchModal.style.display = "none";
        };
        searchResults.appendChild(div);
    });
};

document.getElementById('close-search').onclick = () => searchModal.style.display = "none";

document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input'), txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, timestamp: serverTimestamp()
    });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id] });
};

document.getElementById('btn-signin').onclick = () => signInWithEmailAndPassword(auth, `${document.getElementById('login-user').value.toLowerCase()}@salmon.com`, document.getElementById('login-pass').value);
document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.toLowerCase(), p = document.getElementById('login-pass').value;
    const r = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    await setDoc(doc(db, "users", r.user.uid), { username: u, username_lower: u, admin: false });
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
