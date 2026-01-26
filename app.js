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

// --- DOM ELEMENTS ---
const elements = {
    authCont: document.getElementById('auth-container'),
    appCont: document.getElementById('app-container'),
    welcome: document.getElementById('welcome-view'),
    messages: document.getElementById('messages'),
    inputArea: document.getElementById('input-area'),
    chatTitle: document.getElementById('chat-title'),
    chatList: document.getElementById('chat-list'),
    memberList: document.getElementById('member-list'),
    userDisplay: document.getElementById('user-display-name'),
    userBadge: document.getElementById('user-badge'),
    leaveBtn: document.getElementById('btn-leave-chat')
};

// --- AUTHENTICATION LOGIC ---

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const name = user.email.split('@')[0];
        elements.userDisplay.innerText = name;
        elements.userBadge.innerText = name[0].toUpperCase();
        
        elements.authCont.style.display = 'none';
        elements.appCont.style.display = 'flex';
        loadChannels();
    } else {
        elements.authCont.style.display = 'block';
        elements.appCont.style.display = 'none';
    }
});

document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    if(!u || !p) return;

    try {
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        console.error("Login Error:", e.code);
        alert("Firebase error");
    }
};

document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    if(!u || p.length < 6) return alert("Username required & Password min 6 chars");

    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        // Create user records in Firestore
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch (e) {
        console.error("Signup Error:", e.code);
        alert("Firebase error");
    }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- CHAT & DATABASE LOGIC ---

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        elements.chatList.innerHTML = "";
        snap.forEach(d => {
            const item = document.createElement('div');
            item.className = `channel-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${d.data().name}</span>`;
            item.onclick = () => openChat(d.id, d.data().name, d.data().members);
            elements.chatList.appendChild(item);
        });
    });
}

async function openChat(id, name, members) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    
    // UI Transitions
    elements.welcome.style.display = 'none';
    elements.messages.style.display = 'flex';
    elements.inputArea.style.display = 'block';
    elements.leaveBtn.style.display = 'block';
    elements.chatTitle.innerHTML = `<span style="opacity:0.5; margin-right:4px;">#</span>${name}`;

    loadMembers(members);

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        elements.messages.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = 'msg-container';
            div.innerHTML = `
                <span class="msg-sender">${m.senderName}</span>
                <span class="msg-content">${m.content}</span>
            `;
            elements.messages.appendChild(div);
        });
        elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: 'smooth' });
    });
}

async function loadMembers(memberIds) {
    elements.memberList.innerHTML = "";
    for (const uid of memberIds) {
        try {
            const snap = await getDoc(doc(db, "users", uid));
            if (snap.exists()) {
                const div = document.createElement('div');
                div.style = "padding:6px 0; font-size:13px; display:flex; align-items:center; gap:8px;";
                div.innerHTML = `<div style="width:8px; height:8px; background:var(--discord-green); border-radius:50%"></div> ${snap.data().username}`;
                elements.memberList.appendChild(div);
            }
        } catch (e) { console.error("Member Load Error:", e); }
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
    if (!n) return;
    try {
        await addDoc(collection(db, "conversations"), { 
            name: n, 
            members: [currentUser.uid],
            createdAt: serverTimestamp() 
        });
        document.getElementById('group-name').value = "";
    } catch (e) { alert("Firebase error"); }
};

document.getElementById('btn-add-user').onclick = async () => {
    const nameInput = document.getElementById('add-user-input');
    const name = nameInput.value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    
    try {
        const snap = await getDoc(doc(db, "usernames", name));
        if (snap.exists()) {
            await updateDoc(doc(db, "conversations", activeChatId), { 
                members: arrayUnion(snap.data().uid) 
            });
            nameInput.value = "";
        } else {
            alert("User not found");
        }
    } catch (e) { alert("Firebase error"); }
};

document.getElementById('btn-leave-chat').onclick = async () => {
    if (!activeChatId) return;
    if (confirm("Are you sure you want to leave this group?")) {
        try {
            await updateDoc(doc(db, "conversations", activeChatId), { 
                members: arrayRemove(currentUser.uid) 
            });
            // Reset View
            activeChatId = null;
            elements.welcome.style.display = 'flex';
            elements.messages.style.display = 'none';
            elements.inputArea.style.display = 'none';
            elements.leaveBtn.style.display = 'none';
            elements.chatTitle.innerText = "Home";
        } catch (e) { alert("Firebase error"); }
    }
};

document.getElementById('btn-toggle-menu').onclick = () => {
    document.getElementById('sidebar-left').classList.toggle('open');
};

// Enter key support for messaging
document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-send').click();
});
