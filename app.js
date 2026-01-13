import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.style = `padding:12px; cursor:pointer; margin:4px 8px; border-radius:4px; ${activeChatId === d.id ? 'background:#404249;' : ''}`;
            item.innerText = "# " + d.data().name;
            item.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(item);
        });
    });
}

async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = "# " + name;
    document.getElementById('messages').innerHTML = "";
    document.getElementById('sidebar-left').classList.remove('open');

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        snap.forEach(change => {
            const m = change.data();
            if (!m.content || !m.timestamp) return;
            const row = document.createElement('div');
            row.className = `msg-container ${m.senderId === currentUser.uid ? 'mine' : ''}`;
            row.innerHTML = `<div class="msg-content">
                <div style="font-size:10px; opacity:0.5;">${m.senderName}</div>
                <div>${m.content}</div>
            </div>`;
            box.appendChild(row);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// THE "ADD TO GROUP" LOGIC
document.getElementById('btn-add-user').addEventListener('click', async () => {
    const nameInput = document.getElementById('add-user-input');
    const targetName = nameInput.value.toLowerCase().trim();
    if (!targetName || !activeChatId) return;

    const userSnap = await getDoc(doc(db, "usernames", targetName));
    if (userSnap.exists()) {
        const targetId = userSnap.data().uid;
        await updateDoc(doc(db, "conversations", activeChatId), {
            members: arrayUnion(targetId)
        });
        alert(`Added ${targetName}!`);
        nameInput.value = "";
    } else {
        alert("User not found!");
    }
});

document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('msg-input');
    if (!input.value.trim() || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: input.value,
        senderId: currentUser.uid,
        senderName: currentUser.email.split('@')[0],
        timestamp: serverTimestamp()
    });
    input.value = "";
});

document.getElementById('btn-create-channel').addEventListener('click', async () => {
    const n = document.getElementById('group-name').value;
    if (!n) return;
    await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid] });
    document.getElementById('group-name').value = "";
});

document.getElementById('btn-login').addEventListener('click', async () => {
    const u = document.getElementById('username').value.toLowerCase().trim() + "@salmon.com";
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, u, p).catch(e => alert(e.message));
});

document.getElementById('btn-signup').addEventListener('click', async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    const res = await createUserWithEmailAndPassword(auth, u + "@salmon.com", p);
    await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
    await setDoc(doc(db, "users", res.user.uid), { username: u });
});

document.getElementById('btn-open-menu').onclick = () => document.getElementById('sidebar-left').classList.add('open');
document.getElementById('btn-close-menu').onclick = () => document.getElementById('sidebar-left').classList.remove('open');
