import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let isRegisterMode = false;
let isAddingToGroup = true;
let msgUnsub = null;

const getBadge = (user) => user?.admin ? "🛠️ " : (user?.vip ? "✨ " : "");

// --- AUTHENTICATION FLOW ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            currentUser = { id: user.uid, ...userDoc.data() };
            await updateDoc(doc(db, "users", user.uid), { online: true });
            
            document.getElementById('my-name-display').innerText = getBadge(currentUser) + currentUser.username;
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app-layout').style.display = 'flex';
            syncSidebar();
        }
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

document.getElementById('btn-auth').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    const msg = document.getElementById('auth-msg');

    if (u.length < 3 || p.length < 6) {
        return alert("Username must be 3+ chars, Password 6+ chars.");
    }

    try {
        if (isRegisterMode) {
            // Check if username taken
            const q = query(collection(db, "users"), where("username_lower", "==", u));
            const check = await getDocs(q);
            if (!check.empty) return alert("Username already taken!");

            const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.chat`, p);
            await setDoc(doc(db, "users", res.user.uid), {
                username: u,
                username_lower: u,
                admin: false,
                vip: false,
                online: true,
                createdAt: serverTimestamp()
            });
        } else {
            await signInWithEmailAndPassword(auth, `${u}@salmon.chat`, p);
        }
    } catch (e) {
        alert("Auth failed: " + e.message);
    }
};

document.getElementById('auth-toggle').onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('btn-auth').innerText = isRegisterMode ? "Register" : "Sign In";
    document.getElementById('auth-toggle').innerText = isRegisterMode ? "Back to Login" : "Need an account? Register";
};

// --- SIDEBARS ---
function syncSidebar() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    onSnapshot(q, (snap) => {
        const cBox = document.getElementById('channel-list'), dBox = document.getElementById('dm-list');
        cBox.innerHTML = ""; dBox.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const div = document.createElement('div');
            div.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            div.innerText = data.type === 'dm' ? "👤 DM" : "# " + data.name;
            div.onclick = () => openChat(d.id, data.name || "Private DM");
            data.type === 'dm' ? dBox.appendChild(div) : cBox.appendChild(div);
        });
    });
}

async function syncMembers(chatId) {
    const box = document.getElementById('member-list-box');
    box.innerHTML = "";
    const snap = await getDoc(doc(db, "conversations", chatId));
    const memberIds = snap.data().members || [];
    
    for (const uid of memberIds) {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const u = uSnap.data();
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `<span class="status-dot ${u.online ? 'online' : ''}"></span> ${getBadge(u)}${u.username}`;
            box.appendChild(div);
        }
    }
}

// --- CHAT LOGIC ---
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    syncSidebar();
    syncMembers(id);

    const q = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            const isMe = m.senderId === currentUser.id;
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `
                ${!isMe ? `<div class="msg-name">${m.senderBadge || ""}${m.senderName || "User"}</div>` : ""}
                <div class="bubble">${m.content}</div>
            `;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    const val = inp.value.trim();
    if (!val) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: val, 
        senderId: currentUser.id, 
        senderName: currentUser.username,
        senderBadge: getBadge(currentUser),
        timestamp: serverTimestamp()
    });
};

// --- ADD/DM SEARCH ---
document.getElementById('search-query').oninput = async (e) => {
    const val = e.target.value.trim().toLowerCase();
    const box = document.getElementById('search-results-box');
    box.innerHTML = "";
    if (val.length < 2) return;

    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);

    snap.forEach(uDoc => {
        if (uDoc.id === currentUser.id) return;
        const u = uDoc.data();
        const div = document.createElement('div');
        div.style = "display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(255,255,255,0.05); margin-top:5px; border-radius:5px;";
        div.innerHTML = `<span>${getBadge(u)}${u.username}</span><button class="btn btn-primary" style="padding:4px 8px; font-size:10px;">ADD</button>`;
        
        div.querySelector('button').onclick = async () => {
            if (isAddingToGroup) {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(uDoc.id) });
            } else {
                const dmId = [currentUser.id, uDoc.id].sort().join("_");
                await setDoc(doc(db, "conversations", dmId), { type: 'dm', members: [currentUser.id, uDoc.id] }, { merge: true });
                openChat(dmId, u.username);
            }
            document.getElementById('search-modal').style.display = 'none';
        };
        box.appendChild(div);
    });
};

document.getElementById('btn-trigger-add').onclick = () => { isAddingToGroup = true; document.getElementById('modal-type-title').innerText = "Add User"; document.getElementById('search-modal').style.display = 'flex'; };
document.getElementById('open-dm').onclick = () => { isAddingToGroup = false; document.getElementById('modal-type-title').innerText = "Start DM"; document.getElementById('search-modal').style.display = 'flex'; };

document.getElementById('btn-create-channel').onclick = async () => {
    const name = document.getElementById('new-channel-input').value.trim();
    if (!name) return;
    await addDoc(collection(db, "conversations"), { name, type: 'channel', members: [currentUser.id] });
    document.getElementById('new-channel-input').value = "";
};

document.getElementById('btn-logout').onclick = async () => {
    if(currentUser) await updateDoc(doc(db, "users", currentUser.id), { online: false });
    signOut(auth);
};

document.getElementById('btn-leave').onclick = async () => {
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.id) });
    location.reload();
};
