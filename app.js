import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const setPresence = async (status) => {
    if (auth.currentUser) await setDoc(doc(db, "users", auth.currentUser.uid), { status }, { merge: true });
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
        setPresence("online");
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

window.addEventListener('beforeunload', () => setPresence("offline"));

window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists() && !selectedMembers.includes(snap.data().uid)) {
        selectedMembers.push(snap.data().uid);
        alert(`Added ${target} to the list!`);
    } else { alert("User not found or already added."); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if(!name || selectedMembers.length === 0) return alert("Room name and members required!");
    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), { name, members });
    await addDoc(collection(db, "conversations", docRef.id, "messages"), {
        content: `--- ${name} created ---`, type: "system", timestamp: serverTimestamp()
    });
    selectedMembers = [];
    openChat(docRef.id, name);
};

function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(doc => {
            const btn = document.createElement('button');
            btn.className = "chat-item";
            btn.innerText = "# " + doc.data().name;
            btn.onclick = () => openChat(doc.id, doc.data().name);
            list.appendChild(btn);
        });
    });
}

function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    
    // Messages
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            if (data.type === "system") {
                msgDiv.innerHTML += `<div class="system-msg">${data.content}</div>`;
            } else {
                const isMine = data.senderId === currentUser.uid;
                const senderName = data.senderName || "Unknown";
                msgDiv.innerHTML += `
                    <div class="message-bubble ${isMine ? 'mine' : ''}">
                        <div class="avatar-box">
                            <img class="avatar-img" src="https://ui-avatars.com/api/?name=${senderName}&background=random">
                        </div>
                        <div class="msg-content">
                            <small style="display:block; font-size:10px; opacity:0.7;">@${senderName}</small>
                            ${data.content || ""}
                        </div>
                    </div>`;
            }
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Sidebar Status
    onSnapshot(doc(db, "conversations", id), (chatSnap) => {
        const members = chatSnap.data().members;
        const memberListDiv = document.getElementById('member-list');
        memberListDiv.innerHTML = "";
        members.forEach(mUid => {
            onSnapshot(doc(db, "users", mUid), (uSnap) => {
                if (!uSnap.exists()) return;
                const uData = uSnap.data();
                const memId = `mem-${mUid}`;
                if (document.getElementById(memId)) document.getElementById(memId).remove();
                
                memberListDiv.innerHTML += `
                    <div class="user-row" id="${memId}" style="display:flex; align-items:center; margin-bottom:10px;">
                        <div class="avatar-box" style="width:24px; height:24px; margin:0 8px 0 0;">
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
    const senderName = auth.currentUser.email.split('@')[0];
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: input.value, type: "text", senderId: currentUser.uid,
        senderName: senderName, timestamp: serverTimestamp()
    });
    input.value = "";
};
