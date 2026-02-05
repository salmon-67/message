import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
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

// --- STATE ---
let currentUser = null; 
let activeChatId = null;
let msgUnsub = null;

// --- AUTH SYSTEM ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const docSnap = await getDoc(doc(db, "users", user.uid));
        if (docSnap.exists()) {
            currentUser = { uid: user.uid, ...docSnap.data() };
            document.getElementById('my-username').innerText = currentUser.username;
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'flex';
            initSidebar();
        }
    } else {
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
    }
});

document.getElementById('btn-login').onclick = () => handleAuth(false);
document.getElementById('btn-reg').onclick = () => handleAuth(true);
document.getElementById('btn-logout').onclick = () => signOut(auth);

async function handleAuth(isRegister) {
    const u = document.getElementById('auth-user').value.trim();
    const p = document.getElementById('auth-pass').value;
    const email = `${u.toLowerCase()}@salmon.chat`; 

    try {
        if (isRegister) {
            const cred = await createUserWithEmailAndPassword(auth, email, p);
            await setDoc(doc(db, "users", cred.user.uid), {
                username: u,
                username_lower: u.toLowerCase(),
                admin: false
            });
        } else {
            await signInWithEmailAndPassword(auth, email, p);
        }
    } catch (err) {
        document.getElementById('auth-error').innerText = err.message;
    }
}

// --- SIDEBAR ---
function initSidebar() {
    let q;
    // Admin sees all channels, Normal user sees only joined ones
    if (currentUser.admin) {
        q = query(collection(db, "conversations"), orderBy("name"));
    } else {
        q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    }

    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snapshot.forEach(d => {
            const data = d.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerText = `# ${data.name}`;
            btn.onclick = () => loadChat(d.id, data.name);
            list.appendChild(btn);
        });
    });
}

document.getElementById('btn-create').onclick = async () => {
    const name = document.getElementById('new-channel-input').value.trim();
    if (!name) return;
    await addDoc(collection(db, "conversations"), {
        name: name,
        members: [currentUser.uid],
        createdAt: serverTimestamp()
    });
    document.getElementById('new-channel-input').value = "";
};

// --- CHAT ENGINE ---
async function loadChat(chatId, chatName) {
    if (msgUnsub) msgUnsub();
    activeChatId = chatId;
    document.getElementById('chat-header').innerText = `# ${chatName}`;

    // Announcements Logic
    const isAnn = chatName.toLowerCase().includes("announcements");
    const isAdmin = currentUser.admin === true;

    // Toggle Input
    const inputZone = document.getElementById('input-zone');
    inputZone.classList.toggle('hidden', isAnn && !isAdmin);

    // Toggle Actions
    const actions = document.getElementById('header-actions');
    actions.classList.remove('hidden');
    document.getElementById('btn-open-search').classList.toggle('hidden', isAnn);
    document.getElementById('btn-leave').classList.toggle('hidden', isAnn);

    // Load Messages
    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("timestamp"));
    msgUnsub = onSnapshot(q, (snapshot) => {
        const list = document.getElementById('messages-list');
        list.innerHTML = "";
        
        snapshot.forEach(d => {
            const msg = d.data();
            // Data Normalization (Fixes "undefined")
            const text = msg.text || msg.content || "";
            const name = msg.senderName || msg.name || "User";
            const isMe = msg.uid === currentUser.uid || msg.senderId === currentUser.uid;

            const div = document.createElement('div');
            div.className = `msg-row ${isMe ? 'me' : 'them'}`;
            
            let delBtn = "";
            if (isAdmin) {
                delBtn = `<span class="delete-link" onclick="window.deleteMsg('${d.id}')">Delete</span>`;
            }

            div.innerHTML = `
                ${!isMe ? `<div class="msg-name">${name}</div>` : ""}
                <div class="msg-bubble">
                    ${text}
                    ${delBtn}
                </div>
            `;
            list.appendChild(div);
        });
        list.scrollTop = list.scrollHeight;
    });
}

// Global Delete Function
window.deleteMsg = async (msgId) => {
    if(confirm("Delete message?")) {
        await deleteDoc(doc(db, "conversations", activeChatId, "messages", msgId));
    }
}

// --- SEND MESSAGE ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        text: text,
        senderName: currentUser.username,
        uid: currentUser.uid,
        timestamp: serverTimestamp()
    });
    input.value = "";
};

// --- SEARCH & ADD MEMBERS ---
const searchInput = document.getElementById('search-query');
const resultsBox = document.getElementById('search-results');

document.getElementById('btn-open-search').onclick = () => {
    document.getElementById('search-modal').classList.remove('hidden');
    searchInput.focus();
};

document.getElementById('btn-close-search').onclick = () => {
    document.getElementById('search-modal').classList.add('hidden');
};

searchInput.oninput = async (e) => {
    const term = e.target.value.trim().toLowerCase();
    resultsBox.innerHTML = "";
    if (term.length < 2) return;

    // Search query
    const q = query(collection(db, "users"), 
        where("username_lower", ">=", term), 
        where("username_lower", "<=", term + '\uf8ff'), 
        limit(5));
    
    const snap = await getDocs(q);
    
    if(snap.empty) {
        resultsBox.innerHTML = "<div style='padding:10px; color:gray; font-size:12px;'>No users found.</div>";
        return;
    }

    snap.forEach(uDoc => {
        if (uDoc.id === currentUser.uid) return;
        const u = uDoc.data();
        
        const row = document.createElement('div');
        row.className = 'result-row';
        row.innerHTML = `
            <span>${u.username}</span>
            <button class="btn btn-primary btn-sm add-btn" data-uid="${uDoc.id}">Add</button>
        `;
        resultsBox.appendChild(row);
    });
};

// Event Delegation for dynamic buttons
resultsBox.onclick = async (e) => {
    if (e.target.classList.contains('add-btn')) {
        const uid = e.target.getAttribute('data-uid');
        try {
            await updateDoc(doc(db, "conversations", activeChatId), {
                members: arrayUnion(uid)
            });
            alert("User added!");
            document.getElementById('search-modal').classList.add('hidden');
            searchInput.value = "";
            resultsBox.innerHTML = "";
        } catch (err) {
            alert("Error adding user: " + err.message);
        }
    }
};

document.getElementById('btn-leave').onclick = async () => {
    if (!activeChatId || !confirm("Leave this channel?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), {
        members: arrayRemove(currentUser.uid)
    });
    location.reload();
};
