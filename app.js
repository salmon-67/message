import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

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
const storage = getStorage(app);

let currentUser = null;
let activeChatId = null;
let selectedMembers = [];

// --- STATUS ---
const setPresence = async (status) => {
    if (auth.currentUser) await setDoc(doc(db, "users", auth.currentUser.uid), { status }, { merge: true });
};

// --- AUTH ---
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

// --- GROUP LOGIC ---
window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists() && !selectedMembers.includes(snap.data().uid)) {
        selectedMembers.push(snap.data().uid);
        alert(`Added ${target}`);
    }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), { name, members });
    await addDoc(collection(db, "conversations", docRef.id, "messages"), {
        content: `--- ${name} group created ---`, type: "system", timestamp: serverTimestamp()
    });
    selectedMembers = [];
    openChat(docRef.id, name);
};

// --- REAL-TIME CHAT ---
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
    
    // Message Listener
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
                const senderName = data.senderName || "Unknown"; // Fixes undefined
                msgDiv.innerHTML += `
                    <div class="message-bubble ${isMine ? 'mine' : ''}">
                        <div class="avatar-box">
                            <img class="avatar-img" src="https://ui-avatars.com/api/?name=${senderName}">
                        </div>
                        <div class="msg-content">
                            <small style="display:block; font-size:10px; opacity:0.7;">@${senderName}</small>
                            ${data.type === "image" ? `<img src="${data.content}" style="max-width:200px; display:block; margin-top:5px;">` : (data.content || "")}
                        </div>
                    </div>`;
            }
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Member Online Listener
    onSnapshot(doc(db, "conversations", id), (chatSnap) => {
        const members = chatSnap.data().members;
        const memberListDiv = document.getElementById('member-list');
        memberListDiv.innerHTML = "";
        members.forEach(mUid => {
            onSnapshot(doc(db, "users", mUid), (uSnap) => {
                if (!uSnap.exists()) return;
                const uData = uSnap.data();
                const id = `mem-${mUid}`;
                if (document.getElementById(id)) document.getElementById(id).remove();
                
                memberListDiv.innerHTML += `
                    <div class="user-row" id="${id}" style="display:flex; align-items:center; margin-bottom:10px;">
                        <div class="avatar-box" style="width:24px; height:24px; margin:0 8px 0 0;">
                            <img class="avatar-img" src="https://ui-avatars.com/api/?name=${uData.username}">
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

window.uploadImage = async (input) => {
    if (!activeChatId || !input.files[0]) return;
    const file = input.files[0];
    const senderName = auth.currentUser.email.split('@')[0];
    const refImg = ref(storage, `chats/${activeChatId}/${Date.now()}_${file.name}`);
    const snap = await uploadBytes(refImg, file);
    const url = await getDownloadURL(snap.ref);
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: url, type: "image", senderId: currentUser.uid,
        senderName: senderName, timestamp: serverTimestamp()
    });
};
