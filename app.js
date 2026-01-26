import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- GLOBAL VARIABLES ---
let currentUser = null;
let activeChatId = null;
let msgUnsub = null;

// --- AUTH LISTENER (THE BRAIN) ---
onAuthStateChanged(auth, async (user) => {
    const errBox = document.getElementById('login-error');
    
    if (user) {
        console.log("Auth Detected: " + user.uid);
        if(errBox) errBox.innerText = "Loading Profile...";
        
        // --- RETRY LOGIC TO FIX "LOADING FOREVER" ---
        // Sometimes Auth finishes before the Database is ready. We retry 3 times.
        let userSnap = null;
        let attempts = 0;
        
        while (attempts < 5) {
            userSnap = await getDoc(doc(db, "users", user.uid));
            if (userSnap.exists()) break;
            console.log("Profile not found yet, retrying...");
            await new Promise(r => setTimeout(r, 1000)); // Wait 1 second
            attempts++;
        }

        if (userSnap && userSnap.exists()) {
            // SUCCESS
            currentUser = user;
            const data = userSnap.data();
            
            // Update UI elements safely
            const nameEl = document.getElementById('my-name');
            const avatarEl = document.getElementById('my-avatar');
            const adminBtn = document.getElementById('btn-open-admin');
            
            if(nameEl) nameEl.innerText = data.username;
            if(avatarEl) avatarEl.innerText = (data.username || "?")[0].toUpperCase();
            if(adminBtn && data.admin) adminBtn.style.display = 'block';

            // Hide Login, Show App
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app-layout').style.display = 'flex';
            
            loadChannelList();
        } else {
            // FAILED TO FIND PROFILE
            console.error("User authenticated but no profile found in Firestore.");
            if(errBox) errBox.innerText = "Error: Profile not found. Please register again.";
            await signOut(auth); // Force logout so they can try again
        }
    } else {
        // LOGGED OUT
        console.log("User is logged out");
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- LOGIN BUTTON ---
document.getElementById('btn-signin').addEventListener('click', () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');

    if (!u || !p) { errBox.innerText = "Fill in all fields"; return; }
    errBox.innerText = "Authenticating...";

    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p)
        .catch((error) => {
            console.error(error);
            // Clean up error message
            let msg = error.message.replace("Firebase: ", "").replace("auth/", "");
            errBox.innerText = "Login Failed: " + msg;
        });
});

// --- REGISTER BUTTON ---
document.getElementById('btn-register').addEventListener('click', async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');

    if (!u || !p) { errBox.innerText = "Fill in all fields"; return; }
    errBox.innerText = "Creating Account...";

    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        console.log("Account created on Auth Server.");
        
        errBox.innerText = "Setting up Database...";
        
        // CRITICAL: Wait for this to finish before the Auth Listener tries to read it
        await setDoc(doc(db, "users", res.user.uid), {
            username: u,
            verified: false,
            admin: false
        });
        
        console.log("Database Profile Created.");
        errBox.innerText = "Success! Entering...";
        
    } catch (error) {
        console.error(error);
        let msg = error.message.replace("Firebase: ", "").replace("auth/", "");
        errBox.innerText = "Signup Failed: " + msg;
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    // Reset state
    currentUser = null;
    activeChatId = null;
    if(msgUnsub) msgUnsub();
    signOut(auth).then(() => location.reload()); // Refresh page to clear cache
});

// --- CHAT FUNCTIONS ---
function loadChannelList() {
    const q = query(collection(db, "conversations"), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('channel-list');
        if(!list) return;
        list.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const div = document.createElement('div');
            div.className = `channel-btn ${activeChatId === docSnap.id ? 'active' : ''}`;
            div.innerText = `# ${data.name}`;
            div.onclick = () => openChat(docSnap.id, data.name);
            list.appendChild(div);
        });
    });
}

async function openChat(chatId, chatName) {
    if (msgUnsub) msgUnsub();
    activeChatId = chatId;
    
    document.getElementById('chat-title').innerText = `# ${chatName}`;
    const inputArea = document.getElementById('input-area');
    
    // Check Admin Permissions for Announcements
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const isAdmin = userSnap.data()?.admin || false;
    
    if (chatName.toLowerCase() === 'announcements' && !isAdmin) {
        inputArea.style.display = 'none';
    } else {
        inputArea.style.display = 'block';
    }

    updateMembers(chatId);

    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snapshot) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        
        snapshot.forEach(async (msgDoc) => {
            const m = msgDoc.data();
            const isMe = m.senderId === currentUser.uid;
            
            const row = document.createElement('div');
            row.className = `msg-row ${isMe ? 'me' : 'them'}`;
            
            // Only add badge if not me
            if (!isMe) {
                 getDoc(doc(db, "users", m.senderId)).then(s => {
                     if(s.exists() && s.data().verified) {
                         const meta = row.querySelector('.msg-meta');
                         if(meta) meta.innerHTML += `<span class="badge"></span>`;
                     }
                 });
            }

            row.innerHTML = `
                <div class="msg-meta">${isMe ? '' : m.senderName}</div>
                <div class="bubble">${m.content}</div>
            `;
            box.appendChild(row);
        });
        
        setTimeout(() => box.scrollTop = box.scrollHeight, 100);
    });
}

async function updateMembers(chatId) {
    const list = document.getElementById('member-list');
    list.innerHTML = '<div style="padding:10px; color:gray;">Loading...</div>';
    
    const chatDoc = await getDoc(doc(db, "conversations", chatId));
    const members = chatDoc.data()?.members || [];
    
    list.innerHTML = "";
    members.forEach(async (uid) => {
        const uDoc = await getDoc(doc(db, "users", uid));
        if (uDoc.exists()) {
            const u = uDoc.data();
            const div = document.createElement('div');
            div.style.padding = "10px";
            div.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            div.innerHTML = `${u.username} ${u.verified ? '✅' : ''}`;
            list.appendChild(div);
        }
    });
}

// --- SEND & CREATE ---
document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    const myName = document.getElementById('my-name').innerText;
    input.value = ""; 

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text,
        senderId: currentUser.uid,
        senderName: myName,
        timestamp: serverTimestamp()
    });
    
    updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
}

document.getElementById('btn-create').addEventListener('click', async () => {
    const name = document.getElementById('new-channel-name').value.trim();
    if (!name) return;
    await addDoc(collection(db, "conversations"), {
        name: name,
        members: [currentUser.uid],
        lastUpdated: serverTimestamp()
    });
    document.getElementById('new-channel-name').value = "";
});

document.getElementById('btn-toggle-members').addEventListener('click', () => {
    const sb = document.getElementById('sidebar-right');
    sb.style.display = (sb.style.display === 'none' || sb.style.display === '') ? 'flex' : 'none';
});
