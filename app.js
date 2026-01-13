import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let activeChannelId = null;
let msgUnsub = null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChannels();
    }
});

// --- ADD TO GROUP LOGIC ---
document.getElementById('btn-add-to-group').addEventListener('click', async () => {
    const targetName = document.getElementById('add-user-name').value.trim().toLowerCase();
    if (!targetName || !activeChannelId) return;

    // 1. Find the user ID based on username
    const userRef = doc(db, "usernames", targetName);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        const targetId = userSnap.data().uid;
        // 2. Add that ID to the conversation members array
        const channelRef = doc(db, "conversations", activeChannelId);
        await updateDoc(channelRef, {
            members: arrayUnion(targetId)
        });
        alert(`Added ${targetName} to group!`);
        document.getElementById('add-user-name').value = "";
    } else {
        alert("User not found!");
    }
});

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snapshot.forEach(doc => {
            const div = document.createElement('div');
            div.className = "channel-btn";
            div.innerText = "# " + doc.data().name;
            div.onclick = () => switchChannel(doc.id, doc.data().name);
            list.appendChild(div);
        });
    });
}

function switchChannel(id, name) {
    if (msgUnsub) msgUnsub();
    activeChannelId = id;
    document.getElementById('active-channel-name').innerText = "# " + name;
    document.getElementById('messages').innerHTML = "";

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = `msg ${m.senderId === currentUser.uid ? 'mine' : ''}`;
            div.innerHTML = `<small>${m.senderName}</small><div>${m.content}</div>`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('msg-input');
    if (!input.value.trim() || !activeChannelId) return;
    await addDoc(collection(db, "conversations", activeChannelId, "messages"), {
        content: input.value,
        senderId: currentUser.uid,
        senderName: currentUser.email.split('@')[0],
        timestamp: serverTimestamp()
    });
    input.value = "";
});

document.getElementById('btn-create-channel').addEventListener('click', async () => {
    const name = document.getElementById('new-channel-name').value.trim();
    if (!name) return;
    await addDoc(collection(db, "conversations"), {
        name: name,
        members: [currentUser.uid]
    });
    document.getElementById('new-channel-name').value = "";
});

document.getElementById('btn-login').addEventListener('click', async () => {
    const u = document.getElementById('username').value.trim().toLowerCase() + "@salmon.com";
    const p = document.getElementById('password').value;
    signInWithEmailAndPassword(auth, u, p).catch(e => alert(e.message));
});

document.getElementById('btn-signup').addEventListener('click', async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    const res = await createUserWithEmailAndPassword(auth, u + "@salmon.com", p);
    await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
    await setDoc(doc(db, "users", res.user.uid), { username: u });
});
