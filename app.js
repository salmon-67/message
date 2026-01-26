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
let memberUnsub = null; // New listener for members

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const name = user.email.split('@')[0];
        document.getElementById('user-display-name').innerText = name;
        document.getElementById('user-badge').innerText = name[0].toUpperCase();
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        autoLoadChannels(); // Start live channel listener
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// --- AUTO-LOAD CHANNELS (Left Sidebar) ---
function autoLoadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.className = `channel-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${d.data().name}</span>`;
            item.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(item);
        });
    });
}

// --- OPEN CHAT & AUTO-LOAD MESSAGES/MEMBERS ---
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub(); // Kill old member listener
    activeChatId = id;
    
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('btn-leave-chat').style.display = 'block';
    document.getElementById('chat-title').innerText = `# ${name}`;

    // 1. LIVE MESSAGE LISTENER
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(qMsg, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = 'msg-container';
            div.innerHTML = `<span class="msg-sender">${m.senderName}</span><span class="msg-content">${m.content}</span>`;
            box.appendChild(div);
        });
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    });

    // 2. LIVE MEMBER LISTENER (Right Sidebar)
    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const list = document.getElementById('member-list');
        list.innerHTML = "";
        const memberIds = docSnap.data()?.members || [];
        
        for (const uid of memberIds) {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
                const div = document.createElement('div');
                div.style = "padding:4px 0; font-size:13px; display:flex; align-items:center; gap:8px;";
                div.innerHTML = `<div style="width:6px; height:6px; background:var(--discord-green); border-radius:50%"></div> ${userSnap.data().username}`;
                list.appendChild(div);
            }
        }
    });
}

// --- ACTIONS (Login, Signup, Send) ---
document.getElementById('btn-login').onclick = () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(() => alert("Firebase error"));
};

document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch (e) { alert("Firebase error"); }
};

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
    const nameInput = document.getElementById('add-user-input');
    const name = nameInput.value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    const snap = await getDoc(doc(db, "usernames", name));
    if (snap.exists()) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(snap.data().uid) });
        nameInput.value = "";
    } else { alert("User not found"); }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);
document.getElementById('btn-toggle-menu').onclick = () => document.getElementById('sidebar-left').classList.toggle('open');
