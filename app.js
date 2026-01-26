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

// --- AUTH MONITOR ---
onAuthStateChanged(auth, async (user) => {
    const loginOverlay = document.getElementById('login-overlay');
    const appLayout = document.getElementById('app-layout');

    if (user) {
        try {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) {
                // If profile was deleted (Kicked), sign out immediately
                await signOut(auth);
                return;
            }

            currentUser = { id: user.uid, ...userSnap.data() };
            
            // UI Setup
            document.getElementById('my-name').innerText = currentUser.username;
            document.getElementById('my-avatar').innerText = currentUser.username[0].toUpperCase();
            
            if (currentUser.admin) {
                document.getElementById('btn-open-admin').style.display = 'block';
                document.getElementById('btn-group-settings').style.display = 'block';
            }

            loginOverlay.style.display = 'none';
            appLayout.style.display = 'flex';
            
            await setupAnnouncements();
            loadChannels();
        } catch (err) {
            console.error("Auth sync error:", err);
        }
    } else {
        loginOverlay.style.display = 'flex';
        appLayout.style.display = 'none';
    }
});

// --- LOGIN & REGISTER ---
document.getElementById('btn-signin').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');

    if (!u || !p) { errBox.innerText = "Please enter credentials."; return; }
    errBox.innerText = "Authenticating...";

    try {
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch (e) {
        console.error(e);
        errBox.innerText = "Login Failed: " + e.code;
    }
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');

    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, verified: false, admin: false, createdAt: serverTimestamp() 
        });
    } catch (e) { errBox.innerText = "Registration Error: " + e.code; }
};

document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());

// --- ANNOUNCEMENTS LOGIC ---
async function setupAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    
    if (snap.empty) {
        await addDoc(collection(db, "conversations"), {
            name: "announcements",
            lastUpdated: serverTimestamp(),
            members: [currentUser.id]
        });
    } else {
        await updateDoc(doc(db, "conversations", snap.docs[0].id), {
            members: arrayUnion(currentUser.id)
        });
    }
}

// --- CHANNEL LOADING ---
function loadChannels() {
    onSnapshot(query(collection(db, "conversations"), orderBy("lastUpdated", "desc")), (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerHTML = `<span># ${data.name}</span>`;
            btn.onclick = () => openChat(d.id, data.name);
            list.appendChild(btn);
        });
    });
}

async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    
    // Lockdown Announcements: Only admins can see the input bar
    const isAnnounce = name.toLowerCase() === 'announcements';
    document.getElementById('input-area').style.display = (isAnnounce && !currentUser.admin) ? 'none' : 'block';
    
    updateMembers(id);

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.senderId === currentUser.id;
            const div = document.createElement('div');
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `
                <div class="msg-meta">${m.senderName}</div>
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

// --- MESSAGING ---
document.getElementById('btn-send').onclick = sendMessage;
document.getElementById('msg-input').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
}

// --- ADMIN PANEL ---
document.getElementById('btn-open-admin').onclick = async () => {
    document.getElementById('admin-overlay').style.display = 'flex';
    const list = document.getElementById('admin-user-list');
    list.innerHTML = "Fetching users...";
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    
    snap.forEach(d => {
        const u = d.data();
        if (d.id === currentUser.id) return;
        
        const row = document.createElement('div');
        row.style = "padding:10px; border-bottom:1px solid #333; margin-bottom:10px;";
        row.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${u.username} ${u.verified ? '✅' : ''}</strong>
                <div>
                    <button class="v-btn" data-id="${d.id}" data-v="${u.verified}">${u.verified ? 'Unverify' : 'Verify'}</button>
                    <button class="k-btn" data-id="${d.id}" style="color:red;">KICK</button>
                </div>
            </div>
            <input type="text" placeholder="New Name" class="rename-input" style="width:70%; margin-top:5px;">
            <button class="r-btn" data-id="${d.id}">Go</button>
        `;
        list.appendChild(row);
    });

    // Admin Actions
    document.querySelectorAll('.v-btn').forEach(b => b.onclick = async (e) => {
        await updateDoc(doc(db, "users", e.target.dataset.id), { verified: e.target.dataset.v === 'false' });
        document.getElementById('btn-open-admin').click();
    });

    document.querySelectorAll('.r-btn').forEach(b => b.onclick = async (e) => {
        const name = e.target.previousElementSibling.value;
        if (name) await updateDoc(doc(db, "users", e.target.dataset.id), { username: name });
        document.getElementById('btn-open-admin').click();
    });

    document.querySelectorAll('.k-btn').forEach(b => b.onclick = async (e) => {
        if (confirm("Kick user?")) {
            await deleteDoc(doc(db, "users", e.target.dataset.id));
            document.getElementById('btn-open-admin').click();
        }
    });
};

// --- MEMBERS & HELPERS ---
async function updateMembers(id) {
    const snap = await getDoc(doc(db, "conversations", id));
    const mems = snap.data()?.members || [];
    const list = document.getElementById('member-list');
    list.innerHTML = "";
    for (let uid of mems) {
        const u = await getDoc(doc(db, "users", uid));
        if (u.exists()) {
            const div = document.createElement('div');
            div.style = "padding:8px; font-size:13px; border-bottom:1px solid #222;";
            div.innerHTML = `${u.data().username} ${u.data().verified ? '✅' : ''}`;
            list.appendChild(div);
        }
    }
}

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) {
        await addDoc(collection(db, "conversations"), { 
            name: n, lastUpdated: serverTimestamp(), members: [currentUser.id]
        });
        document.getElementById('new-channel-name').value = "";
    }
};
