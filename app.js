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

// --- AUTH & INITIALIZATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
            await signOut(auth);
            return;
        }

        currentUser = { id: user.uid, ...userSnap.data() };
        document.getElementById('my-name').innerText = currentUser.username;
        
        // This is why the panel might not open: check your Firestore 'admin' field!
        if (currentUser.admin === true) {
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

// --- LOGIN LOGIC ---
document.getElementById('btn-signin').addEventListener('click', async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        document.getElementById('login-error').innerText = "Login Failed: " + e.code;
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

// --- CHANNEL LOGIC ---
async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
        await updateDoc(doc(db, "conversations", snap.docs[0].id), { members: arrayUnion(currentUser.id) });
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

function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';

    updateMemberList(id);

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
            div.innerHTML = `<div style="font-size:10px; opacity:0.5;">${m.senderName}</div><div class="bubble">${m.content}</div>`;
            
            if (currentUser.admin) {
                const del = document.createElement('button');
                del.innerText = "×";
                del.style = "color:red; background:none; border:none; cursor:pointer;";
                del.onclick = () => deleteDoc(doc(db, "conversations", id, "messages", d.id));
                div.appendChild(del);
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- ADDING USERS TO GROUPS ---
async function updateMemberList(chatId) {
    const snap = await getDoc(doc(db, "conversations", chatId));
    const currentMembers = snap.data().members || [];
    const list = document.getElementById('member-list');
    list.innerHTML = "";

    // Show current members
    for (let uid of currentMembers) {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const div = document.createElement('div');
            div.style = "padding:5px; border-bottom:1px solid #222; font-size:12px;";
            div.innerText = uSnap.data().username;
            list.appendChild(div);
        }
    }

    // Admins get an "Invite" tool in the sidebar
    if (currentUser.admin) {
        const inviteDiv = document.createElement('div');
        inviteDiv.style = "margin-top:20px; padding:10px; background:var(--bg-input); border-radius:8px;";
        inviteDiv.innerHTML = `
            <small>Add User by ID</small>
            <input type="text" id="invite-uid" class="input-box" style="font-size:10px; padding:5px;">
            <button id="btn-invite-now" class="btn btn-primary" style="padding:5px; font-size:10px;">Add Member</button>
        `;
        list.appendChild(inviteDiv);

        document.getElementById('btn-invite-now').onclick = async () => {
            const targetId = document.getElementById('invite-uid').value.trim();
            if (targetId) {
                await updateDoc(doc(db, "conversations", chatId), { members: arrayUnion(targetId) });
                alert("User added!");
                updateMemberList(chatId);
            }
        };
    }
}

// --- MASTER ADMIN PANEL ---
document.getElementById('btn-open-admin').onclick = async () => {
    const overlay = document.getElementById('admin-overlay');
    overlay.style.display = 'flex';
    const list = document.getElementById('admin-user-list');
    list.innerHTML = "Fetching...";
    
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    snap.forEach(d => {
        const u = d.data();
        const row = document.createElement('div');
        row.style = "padding:10px; border-bottom:1px solid #333; font-size:11px;";
        row.innerHTML = `
            <div><b>${u.username}</b></div>
            <code style="color:var(--accent);">${d.id}</code><br>
            <button onclick="window.adminVerify('${d.id}', ${u.verified})">Verify</button>
            <button onclick="window.adminKick('${d.id}')" style="color:red;">KICK</button>
            <input type="text" id="ren-${d.id}" placeholder="Rename">
            <button onclick="window.adminRename('${d.id}')">Go</button>
        `;
        list.appendChild(row);
    });
};

// Global Admin Helpers
window.adminVerify = async (id, cur) => { await updateDoc(doc(db, "users", id), { verified: !cur }); document.getElementById('btn-open-admin').click(); };
window.adminKick = async (id) => { if(confirm("Kick?")) await deleteDoc(doc(db, "users", id)); document.getElementById('btn-open-admin').click(); };
window.adminRename = async (id) => { 
    const n = document.getElementById(`ren-${id}`).value;
    if(n) await updateDoc(doc(db, "users", id), { username: n });
    document.getElementById('btn-open-admin').click();
};

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if(n) {
        await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() });
        document.getElementById('new-channel-name').value = "";
    }
};
