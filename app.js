import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let msgUnsub = null;

// Helper to catch common setup errors
const handleErr = (e) => {
    console.error(e);
    if (e.code === 'auth/operation-not-allowed') {
        alert("Firebase Error: You must enable 'Email/Password' in the Firebase Auth Console.");
    } else {
        alert("Firebase error");
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const name = user.email.split('@')[0];
        document.getElementById('user-display-name').innerText = name;
        document.getElementById('user-badge').innerText = name[0].toUpperCase();
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChannels();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// LOG IN
document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    if (!u || !p) return;
    
    // Auto-adds @salmon.com
    const email = u.includes('@') ? u : `${u}@salmon.com`;
    signInWithEmailAndPassword(auth, email, p).catch(handleErr);
};

// SIGN UP
document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    if (!u || p.length < 6) return alert("Min 6 chars for password");

    const email = `${u}@salmon.com`;
    try {
        const res = await createUserWithEmailAndPassword(auth, email, p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch (e) { handleErr(e); }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- CHAT FUNCTIONS ---

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.className = `channel-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${d.data().name}</span>`;
            item.onclick = () => openChat(d.id, d.data().name, d.data().members);
            list.appendChild(item);
        });
    });
}

async function openChat(id, name, members) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('btn-leave-chat').style.display = 'block';
    document.getElementById('chat-title').innerHTML = `# ${name}`;

    loadMembers(members);
    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = 'msg-container';
            div.innerHTML = `<span class="msg-sender">${m.senderName}</span><span class="msg-content">${m.content}</span>`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

async function loadMembers(memberIds) {
    const list = document.getElementById('member-list');
    list.innerHTML = "";
    for (const uid of memberIds) {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const div = document.createElement('div');
            div.style = "padding:4px 0; font-size:13px; display:flex; align-items:center; gap:8px;";
            div.innerHTML = `<div style="width:6px; height:6px; background:var(--discord-green); border-radius:50%"></div> ${snap.data().username}`;
            list.appendChild(div);
        }
    }
}

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    if (!input.value.trim() || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: input.value, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
    input.value = "";
};

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim();
    if (n) {
        await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid] });
        document.getElementById('group-name').value = "";
    }
};

document.getElementById('btn-add-user').onclick = async () => {
    const name = document.getElementById('add-user-input').value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    const snap = await getDoc(doc(db, "usernames", name));
    if (snap.exists()) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(snap.data().uid) });
        document.getElementById('add-user-input').value = "";
    } else { alert("User not found"); }
};

document.getElementById('btn-leave-chat').onclick = async () => {
    if (confirm("Leave?")) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
        location.reload();
    }
};

document.getElementById('btn-toggle-menu').onclick = () => document.getElementById('sidebar-left').classList.toggle('open');
