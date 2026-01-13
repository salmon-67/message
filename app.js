import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let activeListeners = [];

// --- HELPERS ---
const stopListeners = () => { activeListeners.forEach(u => u()); activeListeners = []; };
const showToast = (msg) => {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerText = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
};

const msgDiv = document.getElementById('messages');
const jumpBtn = document.getElementById('jump-btn');
msgDiv.addEventListener('scroll', () => {
    const isAtBottom = msgDiv.scrollHeight - msgDiv.scrollTop - msgDiv.clientHeight < 100;
    jumpBtn.style.display = isAtBottom ? 'none' : 'block';
});
window.scrollToBottom = () => { msgDiv.scrollTop = msgDiv.scrollHeight; };

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        await setDoc(doc(db, "users", user.uid), { status: "online", lastSeen: serverTimestamp() }, { merge: true });
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// --- LOAD CHANNELS ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const item = document.createElement('div');
            item.className = `chat-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${data.name}</span>`;
            item.onclick = () => openChat(d.id, data.name);
            list.appendChild(item);
        });
    });
}

// --- OPEN CHAT ---
async function openChat(id, name) {
    if (activeChatId === id && msgDiv.innerHTML !== "") return;
    activeChatId = id;
    stopListeners();
    document.getElementById('current-chat-title').innerText = `# ${name}`;
    document.getElementById('leave-btn-container').style.display = 'block';
    msgDiv.innerHTML = "";

    if (window.innerWidth <= 768) document.getElementById('sidebar-left').classList.remove('open');

    // 1. Messages Listener
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    const unsubMsg = onSnapshot(qMsg, (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const m = change.doc.data();
                if (!m || !m.content || m.content === "undefined") return; // Filter undefined
                if (document.getElementById(`msg-${change.doc.id}`)) return;

                const isMine = m.senderId === currentUser.uid;
                const isSystem = m.type === 'system' || !m.senderName;
                const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

                const msgEl = document.createElement('div');
                msgEl.id = `msg-${change.doc.id}`;

                if (isSystem) {
                    msgEl.className = "system-msg";
                    msgEl.innerHTML = `<span>${m.content}</span>`;
                } else {
                    msgEl.className = `msg-container ${isMine ? 'mine' : ''}`;
                    msgEl.innerHTML = `
                        <div class="avatar-box">
                            <img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img">
                            <div class="status-dot offline" id="dot-${change.doc.id}"></div>
                        </div>
                        <div class="msg-content">
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:11px;">
                                <strong>${m.senderName}</strong> <span style="opacity:0.5;">${time}</span>
                            </div>
                            <div>${m.content}</div>
                        </div>`;
                    
                    const unsubStat = onSnapshot(doc(db, "users", m.senderId), (uSnap) => {
                        const dot = document.getElementById(`dot-${change.doc.id}`);
                        if(dot && uSnap.exists()) dot.className = `status-dot ${uSnap.data().status === 'online' ? 'online' : 'offline'}`;
                    });
                    activeListeners.push(unsubStat);
                }
                
                const isNearBottom = msgDiv.scrollHeight - msgDiv.scrollTop - msgDiv.clientHeight < 150;
                msgDiv.appendChild(msgEl);
                if (isNearBottom || isMine) window.scrollToBottom();
            }
        });
    });
    activeListeners.push(unsubMsg);

    // 2. Members Listener
    const unsubRoom = onSnapshot(doc(db, "conversations", id), (snap) => {
        const memberList = document.getElementById('member-list');
        memberList.innerHTML = "";
        if(!snap.exists()) return;
        snap.data().members.forEach(uid => {
            const unsubMem = onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data(); if (!u) return;
                const old = document.getElementById(`mem-${uid}`); if(old) old.remove();
                const row = document.createElement('div');
                row.id = `mem-${uid}`;
                row.style = "display:flex; align-items:center; margin-bottom:12px; font-size:14px;";
                row.innerHTML = `
                    <div class="avatar-box" style="width:28px; height:28px; margin:0 10px 0 0;">
                        <img src="https://ui-avatars.com/api/?name=${u.username}" class="avatar-img">
                        <div class="status-dot ${u.status === 'online' ? 'online' : 'offline'}"></div>
                    </div>
                    <span>${u.username}</span>`;
                memberList.appendChild(row);
            });
            activeListeners.push(unsubMem);
        });
    });
    activeListeners.push(unsubRoom);
}

// --- ACTIONS ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    const txt = input.value.trim();
    if (!activeChatId || !txt || txt === "undefined") return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp(), type: "chat"
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastMessageAt: serverTimestamp() });
};

window.addUserToActiveChat = async () => {
    const input = document.getElementById('add-to-chat-input');
    const name = input.value.toLowerCase().trim();
    if (!activeChatId || !name) return;
    const uSnap = await getDoc(doc(db, "usernames", name));
    if (uSnap.exists()) {
        const uid = uSnap.data().uid;
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(uid) });
        await addDoc(collection(db, "conversations", activeChatId, "messages"), {
            content: `@${name} was added to the channel.`, type: "system", timestamp: serverTimestamp()
        });
        input.value = "";
        showToast(`Added @${name}`);
    } else { showToast("User not found"); }
};

window.handleSignup = async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u, uid: res.user.uid, status: "online" });
    } catch(e) { alert(e.message); }
};

window.handleLogin = async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p); } catch(e) { alert(e.message); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return;
    const ref = await addDoc(collection(db, "conversations"), { name, members: [currentUser.uid], lastMessageAt: serverTimestamp() });
    document.getElementById('group-name').value = "";
    openChat(ref.id, name);
};

window.leaveCurrentGroup = async () => {
    if (!confirm("Leave channel?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
    location.reload();
};

window.toggleSidebar = () => document.getElementById('sidebar-left').classList.toggle('open');
