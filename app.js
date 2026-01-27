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

// --- AUTH STATE & AUTO-JOIN ---
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

// --- LOGIN/REGISTER ACTIONS ---
document.getElementById('btn-signin').addEventListener('click', async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    if (!u || !p) return;
    try {
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        document.getElementById('login-error').innerText = "Failed: Check credentials.";
    }
});

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, admin: false, verified: false, createdAt: serverTimestamp() 
        });
    } catch (e) { document.getElementById('login-error').innerText = e.code; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- CHANNEL MANAGEMENT ---
async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
        const annId = snap.docs[0].id;
        await updateDoc(doc(db, "conversations", annId), { members: arrayUnion(currentUser.id) });
    } else {
        await addDoc(collection(db, "conversations"), { name: "announcements", members: [currentUser.id], lastUpdated: serverTimestamp() });
    }
}

function loadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerText = `# ${d.data().name}`;
            btn.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(btn);
        });
    });
}

async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    
    // Admin only for announcements
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';

    updateMemberList(id);

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === currentUser.id;
            const div = document.createElement('div');
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `
                <div style="font-size:10px; opacity:0.5;">${m.senderName}</div>
                <div class="bubble">${m.content}</div>
            `;
            if (currentUser.admin) {
                const del = document.createElement('button');
                del.innerText = "Delete";
                del.style = "font-size:9px; color:red; background:none; border:none; cursor:pointer;";
                del.onclick = () => deleteDoc(doc(db, "conversations", id, "messages", d.id));
                div.appendChild(del);
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- MESSAGE SEND ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

// --- USER LIST (RIGHT SIDEBAR) ---
async function updateMemberList(chatId) {
    const snap = await getDoc(doc(db, "conversations", chatId));
    const members = snap.data().members || [];
    const list = document.getElementById('member-list');
    list.innerHTML = "";
    for (let uid of members) {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const div = document.createElement('div');
            div.style = "padding:5px; font-size:13px;";
            div.innerText = uSnap.data().username + (uSnap.data().verified ? " ✅" : "");
            list.appendChild(div);
        }
    }
}

// --- ADMIN PANEL FUNCTIONS ---
document.getElementById('btn-open-admin').onclick = async () => {
    document.getElementById('admin-overlay').style.display = 'flex';
    const list = document.getElementById('admin-user-list');
    list.innerHTML = "Fetching...";
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    snap.forEach(d => {
        const u = d.data();
        if (d.id === currentUser.id) return;
        const row = document.createElement('div');
        row.style = "padding:10px; border-bottom:1px solid #222;";
        row.innerHTML = `
            <div><b>${u.username}</b></div>
            <button class="admin-action-btn" style="background:orange" onclick="window.adminVerify('${d.id}', ${u.verified})">Toggle Verify</button>
            <button class="admin-action-btn" style="background:red" onclick="window.adminKick('${d.id}')">KICK</button>
            <input type="text" placeholder="New Name" id="ren-${d.id}" style="width:60px; font-size:10px;">
            <button class="admin-action-btn" style="background:grey" onclick="window.adminRename('${d.id}')">Rename</button>
        `;
        list.appendChild(row);
    });
};

window.adminVerify = async (id, current) => { await updateDoc(doc(db, "users", id), { verified: !current }); document.getElementById('btn-open-admin').click(); };
window.adminKick = async (id) => { if(confirm("Kick?")) await deleteDoc(doc(db, "users", id)); document.getElementById('btn-open-admin').click(); };
window.adminRename = async (id) => { 
    const val = document.getElementById(`ren-${id}`).value;
    if(val) await updateDoc(doc(db, "users", id), { username: val });
    document.getElementById('btn-open-admin').click();
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value;
    if(n) await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() });
};
