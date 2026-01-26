import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    addDoc, 
    query, 
    where, 
    onSnapshot, 
    orderBy, 
    serverTimestamp, 
    updateDoc, 
    arrayUnion, 
    arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
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

// --- AUTHENTICATION ---

onAuthStateChanged(auth, async (user) => {
    const authBox = document.getElementById('auth-container');
    const appBox = document.getElementById('app-container');
    
    if (user) {
        currentUser = user;
        const name = user.email.split('@')[0];
        document.getElementById('user-display-name').innerText = name;
        document.getElementById('user-badge').innerText = name[0].toUpperCase();
        
        authBox.style.display = 'none';
        appBox.style.display = 'flex';
        loadChannels();
    } else {
        authBox.style.display = 'block';
        appBox.style.display = 'none';
    }
});

// LOGIN ACTION
document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    
    if (!u || !p) return alert("Enter username and password");

    try {
        // We append @salmon.com to turn the username into a valid email format
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        console.error("DEBUG: Firebase Login Error Code ->", e.code);
        alert("Firebase error"); 
    }
};

// SIGNUP ACTION
document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;

    if (!u || p.length < 6) return alert("Username required & Password min 6 characters");

    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        
        // Save user data to Firestore so we can search for them later
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u });
        
        alert("Account Created! Logging in...");
    } catch (e) {
        console.error("DEBUG: Firebase Signup Error Code ->", e.code);
        alert("Firebase error");
    }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- CHAT LOGIC ---

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
    document.getElementById('chat-title').innerHTML = `<span style="opacity:0.5">#</span> ${name}`;

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
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
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

// --- ACTIONS ---

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    if (!input.value.trim() || !activeChatId) return;
    try {
        await addDoc(collection(db, "conversations", activeChatId, "messages"), {
            content: input.value, 
            senderId: currentUser.uid, 
            senderName: currentUser.email.split('@')[0], 
            timestamp: serverTimestamp()
        });
        input.value = "";
    } catch (e) { alert("Firebase error"); }
};

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim();
    if (n) {
        try {
            await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.uid] });
            document.getElementById('group-name').value = "";
        } catch (e) { alert("Firebase error"); }
    }
};

document.getElementById('btn-add-user').onclick = async () => {
    const name = document.getElementById('add-user-input').value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    try {
        const snap = await getDoc(doc(db, "usernames", name));
        if (snap.exists()) {
            await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(snap.data().uid) });
            document.getElementById('add-user-input').value = "";
            alert("User added!");
        } else { alert("User not found"); }
    } catch (e) { alert("Firebase error"); }
};

document.getElementById('btn-leave-chat').onclick = async () => {
    if (!activeChatId || !confirm("Leave group?")) return;
    try {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
        location.reload(); 
    } catch (e) { alert("Firebase error"); }
};

document.getElementById('btn-toggle-menu').onclick = () => {
    document.getElementById('sidebar-left').classList.toggle('open');
};
