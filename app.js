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

// Presence System
const setStatus = async (status) => {
    if (auth.currentUser) {
        await setDoc(doc(db, "users", auth.currentUser.uid), { status }, { merge: true });
    }
};

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

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        setStatus("online");
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

window.addEventListener('beforeunload', () => setStatus("offline"));

window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    if (!target) return;
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            alert(`@${target} added to invite list!`);
            document.getElementById('search-username').value = "";
        }
    } else { alert("User not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return alert("Enter room name");
    const members = [...selectedMembers, currentUser.uid];
    try {
        const docRef = await addDoc(collection(db, "conversations"), { 
            name, members, lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid 
        });
        selectedMembers = [];
        document.getElementById('group-name').value = "";
        openChat(docRef.id, name);
    } catch (e) { console.error(e); }
};

function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        let chats = [];
        snap.forEach(d => chats.push({ id: d.id, ...d.data() }));
        chats.sort((a, b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));

        list.innerHTML = "";
        chats.forEach(async (data) => {
            const btn = document.createElement('button');
            btn.className = `chat-item ${activeChatId === data.id ? 'active' : ''}`;
            btn.innerHTML = `<span># ${data.name}</span><div class="unread-dot"></div>`;
            btn.onclick = () => openChat(data.id, data.name);
            list.appendChild(btn);

            const statusSnap = await getDoc(doc(db, "users", currentUser.uid, "readStatus", data.id));
            const lastRead = statusSnap.exists() ? statusSnap.data().at?.toMillis() : 0;
            const lastMsg = data.lastMessageAt?.toMillis() || 0;
            if (lastMsg > lastRead && data.lastMessageBy !== currentUser.uid) {
                btn.classList.add('unread');
            }
        });
    });
}

async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    if (window.innerWidth < 768) document.getElementById('sidebar-left').classList.remove('open');
    await setDoc(doc(db, "users", currentUser.uid, "readStatus", id), { at: serverTimestamp() }, { merge: true });

    // Load Messages
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const isMine = data.senderId === currentUser.uid;
            const time = data.timestamp ? data.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";
            msgDiv.innerHTML += `
                <div class="msg-bubble ${isMine ? 'mine' : ''}">
                    <div class="avatar-box"><img class="avatar-img" src="https://ui-avatars.com/api/?name=${data.senderName}&background=random"></div>
                    <div class="msg-content">
                        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:4px;">
                            <small style="font-weight:bold; font-size:11px;">@${data.senderName}</small>
                            <span style="font-size:9px; opacity:0.5;">${time}</span>
                        </div>
                        ${data.content}
                    </div>
                </div>`;
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Load Online Members
    onSnapshot(doc(db, "conversations", id), (chatSnap) => {
        const members = chatSnap.data().members;
        const memberListDiv = document.getElementById('member-list');
        memberListDiv.innerHTML = "";
        members.forEach(mUid => {
            onSnapshot(doc(db, "users", mUid), (uSnap) => {
                const uData = uSnap.data();
                if(!uData) return;
                const memId = `mem-${mUid}`;
                if (document.getElementById(memId)) document.getElementById(memId).remove();
                memberListDiv.innerHTML += `
                    <div class="user-row" id="${memId}" style="display:flex; align-items:center; margin-bottom:12px;">
                        <div class="avatar-box" style="width:24px; height:24px; margin:0 10px 0 0;">
                            <img class="avatar-img" src="https://ui-avatars.com/api/?name=${uData.username}&background=random">
                            <div class="status-dot ${uData.status === 'online' ? 'online' : 'offline'}"></div>
                        </div>
                        <span style="font-size:13px;">${uData.username}</span>
                    </div>`;
            });
        });
    });
}

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
