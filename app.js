import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- STATE ---
let currentUser = null;
let activeChatId = null;
let selectedMembers = []; // For group creation

// --- AUTH LOGIC ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase();
    const pass = document.getElementById('password').value;
    const fakeEmail = `${user}@myapp.com`;

    try {
        // Check if username taken
        const nameCheck = await getDoc(doc(db, "usernames", user));
        if (nameCheck.exists()) return alert("Username taken!");

        const res = await createUserWithEmailAndPassword(auth, fakeEmail, pass);
        await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
        await setDoc(doc(doc(db, "users", res.user.uid)), { username: user, uid: res.user.uid });
        alert("Account Created!");
    } catch (e) { alert(e.message); }
};

window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase();
    const pass = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, `${user}@myapp.com`, pass);
    } catch (e) { alert("Login Failed"); }
};

// --- CHAT LOGIC ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// Search and queue users for a group
window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase();
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            document.getElementById('selected-users').innerHTML += `<span>@${target} </span>`;
        }
    } else { alert("User not found"); }
};

// Create the Conversation Document
window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value || "New Chat";
    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), {
        name: name,
        members: members,
        type: members.length > 2 ? "group" : "private",
        updatedAt: serverTimestamp()
    });
    selectedMembers = [];
    document.getElementById('selected-users').innerHTML = "";
    openChat(docRef.id, name);
};

// Load the sidebar list of chats
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(doc => {
            const btn = document.createElement('button');
            btn.innerText = doc.data().name;
            btn.onclick = () => openChat(doc.id, doc.data().name);
            list.appendChild(btn);
        });
    });
}

// Open a specific chat and listen for messages
function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    
    onSnapshot(q, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(doc => {
            msgDiv.innerHTML += `<p><strong>${doc.data().sender}</strong>: ${doc.data().text}</p>`;
        });
    });
}

window.sendMessage = async () => {
    if (!activeChatId) return;
    const text = document.getElementById('msg-input').value;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        text: text,
        sender: auth.currentUser.email.split('@')[0], // The username
        timestamp: serverTimestamp()
    });
    document.getElementById('msg-input').value = "";
};
