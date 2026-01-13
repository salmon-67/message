import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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
let isCreating = false;

const emojiMap = { ":heart:": "❤️", ":fire:": "🔥", ":smile:": "😊", ":lol:": "😂", ":rocket:": "🚀" };

// --- AUTH ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    if(!user || pass.length < 6) return alert("Username required & password must be 6+ chars");

    try {
        const nameCheck = await getDoc(doc(db, "usernames", user));
        if (nameCheck.exists()) return alert("Username already taken!");

        const res = await createUserWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
        // Wait for auth sync to avoid permission errors
        setTimeout(async () => {
            await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
            await setDoc(doc(db, "users", res.user.uid), { username: user, uid: res.user.uid });
            alert("Account created successfully!");
        }, 1000);
    } catch (e) { alert(e.message); }
};

window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, `${user}@salmon.com`, pass); } 
    catch (e) { alert("Login failed. Check your details."); }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- GROUPS ---
window.searchAndAdd = async () => {
    const input = document.getElementById('search-username');
    const target = input.value.toLowerCase().trim();
    if (!target) return;

    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (uid === currentUser.uid) return alert("You're already the owner!");
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            const tag = document.createElement('span');
            tag.className = 'user-tag'; tag.innerText = `@${target}`;
            document.getElementById('selected-users').appendChild(tag);
            input.value = "";
        }
    } else { alert("User not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if (isCreating || !name || selectedMembers.length === 0) return alert("Room name and members required!");
    
    isCreating = true;
    document.getElementById('create-btn').disabled = true;

    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), {
        name: name, members: members, updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "conversations", docRef.id, "messages"), {
        content: `Welcome to the "${name}" room!`, type: "system", timestamp: serverTimestamp()
    });

    selectedMembers = [];
    document.getElementById('selected-users').innerHTML = "";
    document.getElementById('group-name').value = "";
    isCreating = false;
    document.getElementById('create-btn').disabled = false;
    openChat(docRef.id, name);
};

window.leaveGroup = async () => {
    if (!activeChatId || !confirm("Leave this room?")) return;
    const chatRef = doc(db, "conversations", activeChatId);
    const myName = auth.currentUser.email.split('@')[0];

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: `@${myName} left the chat`, type: "system", timestamp: serverTimestamp()
    });

    await updateDoc(chatRef, { members: arrayRemove(currentUser.uid) });
    activeChatId = null;
    document.getElementById('messages').innerHTML = "";
    document.getElementById('current-chat-title').innerText = "Select a Chat";
    document.getElementById('leave-btn').style.display = "none";
};

// --- CHAT & MEDIA ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(doc => {
            const btn = document.createElement('button');
            btn.className = "chat-item"; btn.innerText = `# ${doc.data().name}`;
            btn.onclick = () => openChat(doc.id, doc.data().name);
            list.appendChild(btn);
        });
    });
}

function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    document.getElementById('leave-btn').style.display = "block";
    
    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            if (data.type === "system") {
                msgDiv.innerHTML += `<div class="system-msg">${data.content}</div>`;
            } else {
                const isMine = data.senderId === currentUser.uid;
                let body = data.type === "image" ? `<img class="chat-img" src="${data.content}">` : parseText(data.content);
                msgDiv.innerHTML += `
                    <div class="message ${isMine ? 'mine' : ''}">
                        <span class="sender-name">@${data.senderName}</span>
                        ${body}
                    </div>`;
            }
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });
}

function parseText(text) {
    Object.keys(emojiMap).forEach(k => text = text.replace(new RegExp(k, 'g'), emojiMap[k]));
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" style="color: #00aff4;">${url}</a>`);
}

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: input.value, type: "text", senderId: currentUser.uid,
        senderName: auth.currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
    input.value = "";
};

window.uploadImage = async (input) => {
    if (!activeChatId || !input.files[0]) return;
    const file = input.files[0];
    const refImg = ref(storage, `chats/${activeChatId}/${Date.now()}_${file.name}`);
    try {
        const snap = await uploadBytes(refImg, file);
        const url = await getDownloadURL(snap.ref);
        await addDoc(collection(db, "conversations", activeChatId, "messages"), {
            content: url, type: "image", senderId: currentUser.uid,
            senderName: auth.currentUser.email.split('@')[0], timestamp: serverTimestamp()
        });
    } catch (e) { alert("Upload failed"); }
};
