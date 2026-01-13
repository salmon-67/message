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

// --- AUTH HANDLER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await setDoc(doc(db, "users", user.uid), { status: "online" }, { merge: true });
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- CHANNEL LIST ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.style = `padding:12px; cursor:pointer; color:#949ba4; margin:4px 8px; border-radius:4px; ${activeChatId === d.id ? 'background:#404249; color:white;' : ''}`;
            item.innerText = "# " + d.data().name;
            item.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(item);
        });
    });
}

// --- MESSAGE LISTENER ---
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = "# " + name;
    document.getElementById('messages').innerHTML = "";
    document.getElementById('sidebar-left').classList.remove('open');

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        snap.docChanges().forEach(change => {
            if (change.type === "added") {
                const m = change.doc.data();
                
                // BOUNCER: Ignore undefined or broken data
                if (!m || !m.content || m.content === "undefined" || !m.timestamp) return;

                const row = document.createElement('div');
                if (m.type === 'system') {
                    row.className = "system-msg";
                    row.innerHTML = `<span>${m.content}</span>`;
                } else {
                    const isMine = m.senderId === currentUser.uid;
                    row.className = `msg-container ${isMine ? 'mine' : ''}`;
                    row.innerHTML = `
                        <div style="width:32px; height:32px; margin:0 8px; flex-shrink:0;">
                            <img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" style="width:100%; border-radius:50%;">
                        </div>
                        <div class="msg-content">
                            <div style="font-size:10px; opacity:0.5; margin-bottom:2px;">${m.senderName}</div>
                            <div>${m.content}</div>
                        </div>`;
                }
                const box = document.getElementById('messages');
                box.appendChild(row);
                box.scrollTop = box.scrollHeight;
            }
        });
    });
}

// --- UI BUTTONS (addEventListener fix) ---
document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('msg-input');
    const val = input.value.trim();
    if (!val || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: val, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
});

document.getElementById('btn-login').addEventListener('click', async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, u + "@salmon.com", p); } catch(e) { alert(e.message); }
});

document.getElementById('btn-signup').addEventListener('click', async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, u + "@salmon.com", p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch(e) { alert(e.message); }
});

document.getElementById('btn-create-channel').addEventListener('click', async () => {
    const n = document.getElementById('group-name').value.trim();
    if (!n) return;
    await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid], lastMessageAt: serverTimestamp() });
    document.getElementById('group-name').value = "";
});

document.getElementById('btn-add-user').addEventListener('click', async () => {
    const input = document.getElementById('add-user-input');
    const name = input.value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    const snap = await getDoc(doc(db, "usernames", name));
    if (snap.exists()) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(snap.data().uid) });
        await addDoc(collection(db, "conversations", activeChatId, "messages"), {
            content: `@${name} was added`, type: 'system', timestamp: serverTimestamp()
        });
        input.value = "";
    } else { alert("User not found"); }
});

document.getElementById('btn-open-menu').onclick = () => document.getElementById('sidebar-left').classList.add('open');
document.getElementById('btn-close-menu').onclick = () => document.getElementById('sidebar-left').classList.remove('open');
