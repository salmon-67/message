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

// --- AUTH & STATUS ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await setDoc(doc(db, "users", user.uid), { status: "online", lastSeen: serverTimestamp() }, { merge: true });
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- UI HELPERS ---
const toggleSidebar = () => {
    document.getElementById('sidebar-left').classList.toggle('open');
};

// --- LEAVE GROUP ---
window.leaveCurrentGroup = async () => {
    if (!activeChatId || !confirm("Leave this group?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
    location.reload(); 
};

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

// --- OPEN CHAT ---
async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    document.getElementById('leave-btn-container').style.display = 'block';
    
    // AUTO-MINIMIZE SIDEBAR ON MOBILE
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar-left').classList.remove('open');
    }

    // Messages with Live Status on Avatars
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMine = m.senderId === currentUser.uid;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "...";
            
            const msgRow = document.createElement('div');
            msgRow.className = `msg-bubble ${isMine ? 'mine' : ''}`;
            msgRow.innerHTML = `
                <div class="avatar-box" id="msg-av-${d.id}">
                    <img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img">
                    <div class="status-dot offline" id="dot-${d.id}-${m.senderId}"></div>
                </div>
                <div class="msg-content">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:3px;">
                        <small style="font-weight:bold; font-size:11px;">@${m.senderName}</small>
                        <small style="font-size:9px; opacity:0.5;">${time}</small>
                    </div>
                    ${m.content}
                </div>`;
            msgDiv.appendChild(msgRow);

            // Sync the status dot on the message avatar
            onSnapshot(doc(db, "users", m.senderId), (uSnap) => {
                const u = uSnap.data();
                const dot = document.getElementById(`dot-${d.id}-${m.senderId}`);
                if (dot && u) {
                    dot.className = `status-dot ${u.status === 'online' ? 'online' : 'offline'}`;
                }
            });
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Right Sidebar Member List
    onSnapshot(doc(db, "conversations", id), (snap) => {
        if (!snap.exists()) return;
        const members = snap.data().members;
        const memberList = document.getElementById('member-list');
        memberList.innerHTML = "";
        members.forEach(uid => {
            onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data(); if(!u) return;
                const rowId = `mem-row-${uid}`;
                if(document.getElementById(rowId)) document.getElementById(rowId).remove();
                const row = document.createElement('div');
                row.id = rowId;
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

// --- GLOBAL EXPORTS ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    const res = await createUserWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
    await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
    await setDoc(doc(db, "users", res.user.uid), { username: user, uid: res.user.uid, status: "online" });
};
window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    await signInWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
};
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const content = input.value;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid });
};
window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    const snap = await getDoc(doc(db, "usernames", target));
    if(snap.exists()) { selectedMembers.push(snap.data().uid); alert("Added!"); }
};
window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value;
    const docRef = await addDoc(collection(db, "conversations"), { name, members: [...selectedMembers, currentUser.uid], lastMessageAt: serverTimestamp() });
    openChat(docRef.id, name);
};
window.toggleSidebar = toggleSidebar;
