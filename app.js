import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, getDocs, deleteDoc, arrayUnion, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- AUTH LOGIC ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            signOut(auth);
            return;
        }

        currentUser = { id: user.uid, ...userSnap.data() };
        document.getElementById('my-name').innerText = currentUser.username;
        
        if (currentUser.admin) {
            document.getElementById('btn-open-admin').style.display = 'block';
        }

        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        await autoJoinAnnouncements();
        loadChannels();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// SIGN IN BUTTON
document.getElementById('btn-signin').addEventListener('click', async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const err = document.getElementById('login-error');

    if (!u || !p) { err.innerText = "Enter username/password"; return; }

    try {
        err.innerText = "Signing in...";
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        err.innerText = "Error: " + e.code;
        console.error(e);
    }
});

// REGISTER BUTTON
document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, verified: false, admin: false 
        });
    } catch (e) { document.getElementById('login-error').innerText = e.code; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- CHANNEL LOGIC ---
async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
        await updateDoc(doc(db, "conversations", snap.docs[0].id), {
            members: arrayUnion(currentUser.id)
        });
    } else {
        await addDoc(collection(db, "conversations"), {
            name: "announcements",
            lastUpdated: serverTimestamp(),
            members: [currentUser.id]
        });
    }
}

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerText = `# ${data.name}`;
            btn.onclick = () => openChat(d.id, data.name);
            list.appendChild(btn);
        });
    });
}

function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === currentUser.id;
            const div = document.createElement('div');
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `
                <div style="font-size:10px; color:gray;">${m.senderName}</div>
                <div class="bubble">${m.content}</div>
            `;
            if (currentUser.admin) {
                const del = document.createElement('button');
                del.className = "delete-btn"; del.innerText = "Delete";
                del.onclick = () => deleteDoc(doc(db, "conversations", id, "messages", d.id));
                div.appendChild(del);
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- SEND MESSAGE ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
};

// --- ADMIN PANEL ---
document.getElementById('btn-open-admin').onclick = async () => {
    document.getElementById('admin-overlay').style.display = 'flex';
    const list = document.getElementById('admin-user-list');
    list.innerHTML = "Loading...";
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    snap.forEach(d => {
        const u = d.data();
        const row = document.createElement('div');
        row.style = "border-bottom: 1px solid #333; padding: 10px;";
        row.innerHTML = `
            <div><b>${u.username}</b> ${u.verified ? '✅' : ''}</div>
            <button onclick="window.adminVerify('${d.id}', ${u.verified})" class="btn-primary" style="padding:4px; font-size:10px; width:auto; margin-top:5px;">Toggle Verify</button>
            <button onclick="window.adminKick('${d.id}')" class="btn-danger" style="padding:4px; font-size:10px; width:auto;">KICK</button>
        `;
        list.appendChild(row);
    });
};

// GLOBAL ADMIN ACTIONS
window.adminVerify = async (id, current) => {
    await updateDoc(doc(db, "users", id), { verified: !current });
    document.getElementById('btn-open-admin').click();
};

window.adminKick = async (id) => {
    if(confirm("Kick user?")) {
        await deleteDoc(doc(db, "users", id));
        document.getElementById('btn-open-admin').click();
    }
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value;
    if(n) await addDoc(collection(db, "conversations"), { name: n, lastUpdated: serverTimestamp(), members: [currentUser.id] });
};
