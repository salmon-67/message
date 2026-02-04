import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let isRegisterMode = false;
let msgUnsub = null;
let memberUnsub = null;

const getBadge = (user) => user?.admin ? "🛠️ " : (user?.vip ? "✨ " : "");

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
            currentUser = { id: user.uid, ...snap.data() };
            await updateDoc(doc(db, "users", user.uid), { online: true });
            document.getElementById('my-name-display').innerText = getBadge(currentUser) + currentUser.username;
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app-layout').style.display = 'flex';
            syncSidebar();
        }
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

document.getElementById('btn-auth').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    if (u.length < 3) return alert("Username too short");
    try {
        if (isRegisterMode) {
            const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.chat`, p);
            await setDoc(doc(db, "users", res.user.uid), { username: u, username_lower: u, admin: false, vip: false, online: true });
        } else {
            await signInWithEmailAndPassword(auth, `${u}@salmon.chat`, p);
        }
    } catch (e) { alert(e.message); }
};

document.getElementById('auth-toggle').onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('btn-auth').innerText = isRegisterMode ? "Register" : "Enter Chat";
};

// --- SIDEBARS ---
function syncSidebar() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    onSnapshot(q, (snap) => {
        const box = document.getElementById('channel-list');
        box.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const div = document.createElement('div');
            div.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            div.innerText = "# " + data.name;
            div.onclick = () => openChat(d.id, data.name);
            box.appendChild(div);
        });
    });
}

function syncMembers(chatId) {
    if (memberUnsub) memberUnsub();
    memberUnsub = onSnapshot(doc(db, "conversations", chatId), async (docSnap) => {
        const box = document.getElementById('member-list-box');
        box.innerHTML = "";
        const memberIds = docSnap.data().members || [];
        for (const uid of memberIds) {
            const uSnap = await getDoc(doc(db, "users", uid));
            const u = uSnap.data();
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `<span class="status-dot ${u?.online ? 'online' : ''}"></span> ${getBadge(u)}${u?.username || 'User'}`;
            box.appendChild(div);
        }
    });
}

// --- CHAT ---
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = "# " + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    syncSidebar();
    syncMembers(id);

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === 'system') {
                div.className = "system-msg";
                div.innerText = m.content;
            } else {
                const isMe = m.senderId === currentUser.id;
                div.className = `msg-row ${isMe ? 'me' : 'them'}`;
                div.innerHTML = `
                    ${!isMe ? `<div class="msg-name">${m.senderBadge || ""}${m.senderName || "User"}</div>` : ""}
                    <div class="bubble">${m.content}</div>
                `;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    if (!inp.value.trim()) return;
    const txt = inp.value;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username, senderBadge: getBadge(currentUser), timestamp: serverTimestamp()
    });
};

// --- FIX: ADD MEMBER SYSTEM ---
document.getElementById('btn-trigger-add').onclick = () => {
    document.getElementById('search-modal').style.display = 'flex';
    document.getElementById('search-query').focus();
};

document.getElementById('search-query').oninput = async (e) => {
    const val = e.target.value.trim().toLowerCase();
    const box = document.getElementById('search-results-box');
    box.innerHTML = "";
    if (val.length < 2) return;

    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);

    snap.forEach(uDoc => {
        const u = uDoc.data();
        const div = document.createElement('div');
        div.className = "search-item";
        div.innerHTML = `<span>${getBadge(u)}${u.username}</span><button class="btn btn-primary" style="padding:4px 10px; font-size:10px;">ADD</button>`;
        
        div.querySelector('button').onclick = async () => {
            // Add user to the current conversation document
            await updateDoc(doc(db, "conversations", activeChatId), {
                members: arrayUnion(uDoc.id)
            });
            // System message alert
            await addDoc(collection(db, "conversations", activeChatId, "messages"), {
                content: `${u.username} has been added to the channel.`,
                senderId: "system",
                timestamp: serverTimestamp()
            });
            document.getElementById('search-modal').style.display = 'none';
            document.getElementById('search-query').value = "";
        };
        box.appendChild(div);
    });
};

// --- GLOBAL ACTIONS ---
document.getElementById('btn-create-channel').onclick = async () => {
    const name = document.getElementById('new-channel-input').value.trim();
    if (name.length < 2) return;
    await addDoc(collection(db, "conversations"), { name: name, members: [currentUser.id], createdAt: serverTimestamp() });
    document.getElementById('new-channel-input').value = "";
};

document.getElementById('btn-logout').onclick = async () => {
    await updateDoc(doc(db, "users", currentUser.id), { online: false });
    signOut(auth);
};

document.getElementById('btn-leave').onclick = async () => {
    if (!confirm("Leave this channel?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.id) });
    location.reload();
};
