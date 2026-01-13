import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- CORE AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await setDoc(doc(db, "users", user.uid), { status: "online", lastSeen: serverTimestamp() }, { merge: true });
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- SIDEBAR ACTIONS ---
window.toggleSidebar = () => {
    document.getElementById('sidebar-left').classList.toggle('open');
};

window.leaveCurrentGroup = async () => {
    if (!activeChatId || !confirm("Leave this group?")) return;
    try {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
        location.reload(); 
    } catch(e) { alert(e.message); }
};

// --- CHANNELS ---
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

// --- MESSAGES ---
async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    document.getElementById('leave-btn-container').style.display = 'block';
    
    if (window.innerWidth <= 768) document.getElementById('sidebar-left').classList.remove('open');

    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMine = m.senderId === currentUser.uid;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
            
            const msgRow = document.createElement('div');
            msgRow.className = `msg-bubble ${isMine ? 'mine' : ''}`;
            msgRow.innerHTML = `
                <div class="avatar-box">
                    <img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img">
                    <div class="status-dot offline" id="dot-${d.id}"></div>
                </div>
                <div class="msg-content">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                        <small style="font-weight:bold; font-size:11px;">@${m.senderName}</small>
                        <small style="font-size:9px; opacity:0.5;">${time}</small>
                    </div>
                    <div>${m.content}</div>
                </div>`;
            msgDiv.appendChild(msgRow);

            // Real-time status on message avatar
            onSnapshot(doc(db, "users", m.senderId), (uSnap) => {
                const u = uSnap.data();
                const dot = document.getElementById(`dot-${d.id}`);
                if (dot && u) dot.className = `status-dot ${u.status === 'online' ? 'online' : 'offline'}`;
            });
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Right Sidebar Members
    onSnapshot(doc(db, "conversations", id), (snap) => {
        if (!snap.exists()) return;
        const members = snap.data().members;
        const memberList = document.getElementById('member-list');
        memberList.innerHTML = "";
        members.forEach(uid => {
            onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data(); if(!u) return;
                const row = document.createElement('div');
                row.className = "user-row";
                row.innerHTML = `
                    <div class="avatar-box" style="width:24px; height:24px;">
                        <img src="https://ui-avatars.com/api/?name=${u.username}" style="width:100%; border-radius:50%;">
                        <div class="status-dot ${u.status === 'online' ? 'online' : 'offline'}"></div>
                    </div>
                    <span>${u.username}</span>`;
                memberList.appendChild(row);
            });
        });
    });
}

// --- GLOBAL ATTACHMENTS ---
window.handleSignup = async () => {
    try {
        const uVal = document.getElementById('username').value.toLowerCase().trim();
        const pVal = document.getElementById('password').value;
        const res = await createUserWithEmailAndPassword(auth, `${uVal}@salmon.com`, pVal);
        await setDoc(doc(db, "usernames", uVal), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: uVal, uid: res.user.uid, status: "online" });
    } catch(e) { alert(e.message); }
};

window.handleLogin = async () => {
    try {
        const uVal = document.getElementById('username').value.toLowerCase().trim();
        const pVal = document.getElementById('password').value;
        await signInWithEmailAndPassword(auth, `${uVal}@salmon.com`, pVal);
    } catch(e) { alert(e.message); }
};

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const txt = input.value;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid });
};

window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    const snap = await getDoc(doc(db, "usernames", target));
    if(snap.exists()) { selectedMembers.push(snap.data().uid); alert("User Added!"); }
    else { alert("Not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value;
    if(!name) return;
    const docRef = await addDoc(collection(db, "conversations"), { name, members: [...selectedMembers, currentUser.uid], lastMessageAt: serverTimestamp() });
    openChat(docRef.id, name);
};
