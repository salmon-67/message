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
let chatUnsub = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChannels();
    }
});

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.className = "chat-item";
            item.style = `padding:12px; cursor:pointer; ${activeChatId === d.id ? 'background:#404249;' : ''}`;
            item.innerText = (d.id === "announcements" ? "📢 " : "# ") + d.data().name;
            item.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(item);
        });
    });
}

async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    if (chatUnsub) chatUnsub();
    activeChatId = id;

    document.getElementById('chat-title').innerText = (id === "announcements" ? "📢 " : "# ") + name;

    // UI RESTRICTION FOR ANNOUNCEMENTS
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const isAdmin = userSnap.data()?.role === "admin";
    const inputArea = document.getElementById('message-input-container'); // Wrap your input/button in this ID
    
    if (id === "announcements" && !isAdmin) {
        inputArea.style.opacity = "0.5";
        document.getElementById('msg-input').placeholder = "Only admins can post here";
        document.getElementById('msg-input').disabled = true;
        document.getElementById('btn-send').style.pointerEvents = "none";
    } else {
        inputArea.style.opacity = "1";
        document.getElementById('msg-input').placeholder = "Type a message...";
        document.getElementById('msg-input').disabled = false;
        document.getElementById('btn-send').style.pointerEvents = "auto";
    }

    chatUnsub = onSnapshot(doc(db, "conversations", id), (snap) => {
        if (snap.exists()) loadMembers(snap.data().members);
    });

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.style = `display:flex; margin-bottom:10px; ${m.senderId === currentUser.uid ? 'justify-content:flex-end' : ''}`;
            div.innerHTML = `<div class="msg-content"><small style="display:block;opacity:0.5">${m.senderName}</small>${m.content}</div>`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

async function loadMembers(memberIds) {
    const list = document.getElementById('member-list');
    if (!list) return;
    list.innerHTML = "";
    for (const uid of memberIds) {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `<div style="width:10px;height:10px;background:#23a55a;border-radius:50%"></div> ${snap.data().username} ${snap.data().role === 'admin' ? '👑' : ''}`;
            list.appendChild(div);
        }
    }
}

// SIGNUP WITH AUTO-JOIN
document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, u + "@salmon.com", p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u, role: "user" });
        
        // Auto-join the fixed ID "announcements"
        await updateDoc(doc(db, "conversations", "announcements"), {
            members: arrayUnion(res.user.uid)
        });
    } catch (e) { alert(e.message); }
};

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    if (!input.value.trim() || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: input.value, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
    input.value = "";
};

// Login and other existing functions...
document.getElementById('btn-login').onclick = () => {
    const u = document.getElementById('username').value.trim().toLowerCase() + "@salmon.com";
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, u, p);
};

document.getElementById('btn-create-channel').onclick = () => {
    const n = document.getElementById('group-name').value.trim();
    if (n) addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid] });
};

document.getElementById('btn-add-user').onclick = async () => {
    const name = document.getElementById('add-user-input').value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    const snap = await getDoc(doc(db, "usernames", name));
    if (snap.exists()) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(snap.data().uid) });
        alert("User added!");
    }
};
