import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let selectedMembers = [];

// --- LOGIN/SIGNUP ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
        await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: user, uid: res.user.uid, status: "online" });
    } catch (e) { alert(e.message); }
};

window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, `${user}@salmon.com`, pass); } catch (e) { alert(e.message); }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await setDoc(doc(db, "users", user.uid), { status: "online", lastSeen: serverTimestamp() }, { merge: true });
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- CHAT LIST ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        let rooms = [];
        snap.forEach(d => rooms.push({ id: d.id, ...d.data() }));
        rooms.sort((a,b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));

        rooms.forEach(data => {
            const item = document.createElement('div');
            item.className = `chat-item ${activeChatId === data.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${data.name}</span>`;
            item.onclick = () => openChat(data.id, data.name);
            list.appendChild(item);
        });
    });
}

// --- MESSAGES & MEMBERS ---
async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    const msgDiv = document.getElementById('messages');
    const memberList = document.getElementById('member-list');
    msgDiv.innerHTML = "<p style='color:gray; padding:20px;'>Loading messages...</p>";
    memberList.innerHTML = "";

    // Listen for Messages
    const msgQuery = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(msgQuery, (snap) => {
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMine = m.senderId === currentUser.uid;
            msgDiv.innerHTML += `
                <div class="msg-bubble ${isMine ? 'mine' : ''}">
                    <div class="avatar-box"><img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img"></div>
                    <div class="msg-content">
                        <small style="font-weight:bold; display:block; font-size:10px; margin-bottom:2px;">@${m.senderName}</small>
                        ${m.content}
                    </div>
                </div>`;
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Listen for Room Members
    onSnapshot(doc(db, "conversations", id), (snap) => {
        const members = snap.data().members;
        memberList.innerHTML = "";
        members.forEach(uid => {
            onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data();
                if(!u) return;
                const rowId = `mem-${uid}`;
                if(document.getElementById(rowId)) document.getElementById(rowId).remove();
                
                const row = document.createElement('div');
                row.id = rowId;
                row.className = "user-row";
                row.style = "display:flex; align-items:center; margin-bottom:10px;";
                row.innerHTML = `
                    <div class="avatar-box" style="width:20px; height:20px; margin-right:8px;">
                        <img src="https://ui-avatars.com/api/?name=${u.username}" style="width:100%; border-radius:50%;">
                        <div class="status-dot ${u.status === 'online' ? 'online' : 'offline'}"></div>
                    </div>
                    <span style="font-size:13px; color:${u.status === 'online' ? '#fff' : '#888'}">${u.username}</span>
                `;
                memberList.appendChild(row);
            });
        });
    });
}

// --- ACTIONS ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const content = input.value;
    const senderName = auth.currentUser.email.split('@')[0];
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content, senderId: currentUser.uid, senderName, timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid
    });
};

window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    const snap = await getDoc(doc(db, "usernames", target));
    if(snap.exists()){
        selectedMembers.push(snap.data().uid);
        alert(`@${target} added!`);
        document.getElementById('search-username').value = "";
    } else { alert("User not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if(!name) return;
    const docRef = await addDoc(collection(db, "conversations"), { 
        name, members: [...selectedMembers, currentUser.uid], lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid 
    });
    selectedMembers = [];
    document.getElementById('group-name').value = "";
    openChat(docRef.id, name);
};
