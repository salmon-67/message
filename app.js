import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIG ---
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

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // Load User Profile
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            document.getElementById('my-name').innerText = data.username;
            document.getElementById('my-avatar').innerText = data.username[0].toUpperCase();
            
            // Show Admin Button if admin
            if (data.admin) document.getElementById('btn-open-admin').style.display = 'block';
            
            // Switch Screens
            document.getElementById('login-overlay').style.display = 'none';
            document.getElementById('app-layout').style.display = 'flex';
            loadChannelList();
        }
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// LOGIN LOGIC
document.getElementById('btn-signin').addEventListener('click', () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');
    
    if (!u || !p) { errBox.innerText = "Please fill all fields"; return; }
    errBox.innerText = "Signing in...";

    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p)
        .catch((error) => {
            errBox.innerText = "Error: " + error.message.replace("Firebase: ", "");
        });
});

// REGISTER LOGIC
document.getElementById('btn-register').addEventListener('click', async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const errBox = document.getElementById('login-error');

    if (!u || !p) { errBox.innerText = "Please fill all fields"; return; }
    errBox.innerText = "Creating account...";

    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        // Create the user profile in Database
        await setDoc(doc(db, "users", res.user.uid), {
            username: u,
            verified: false,
            admin: false
        });
        errBox.innerText = "Success! Logging in...";
    } catch (error) {
        errBox.innerText = "Error: " + error.message.replace("Firebase: ", "");
    }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// --- CHAT LOGIC ---
function loadChannelList() {
    const q = query(collection(db, "conversations"), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('channel-list');
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
    if (msgUnsub) msgUnsub(); // Stop listening to old chat
    activeChatId = chatId;
    
    // UI Updates
    document.getElementById('chat-title').innerText = `# ${chatName}`;
    const inputArea = document.getElementById('input-area');
    const typeStatus = document.getElementById('typing-status');
    
    // Check Admin Permissions for Announcements
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const isAdmin = userSnap.data().admin;
    
    if (chatName.toLowerCase() === 'announcements' && !isAdmin) {
        inputArea.style.display = 'none';
    } else {
        inputArea.style.display = 'block';
        typeStatus.innerText = "";
    }

    // Refresh Member List
    updateMembers(chatId);

    // Load Messages
    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snapshot) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        
        snapshot.forEach(async (msgDoc) => {
            const m = msgDoc.data();
            const isMe = m.senderId === currentUser.uid;
            
            // Render Message
            const row = document.createElement('div');
            row.className = `msg-row ${isMe ? 'me' : 'them'}`;
            
            // Only fetch verification status if it's NOT me
            let badgeHtml = '';
            if (!isMe) {
                 // In a real app we would cache this to avoid reads, but for now fetch it
                 getDoc(doc(db, "users", m.senderId)).then(s => {
                     if(s.exists() && s.data().verified) {
                         row.querySelector('.msg-meta').innerHTML += `<span class="badge"></span>`;
                     }
                 });
            }

            row.innerHTML = `
                <div class="msg-meta">
                    ${isMe ? '' : m.senderName}
                </div>
                <div class="bubble">${m.content}</div>
            `;
            box.appendChild(row);
        });
        
        // Auto Scroll to bottom
        setTimeout(() => box.scrollTop = box.scrollHeight, 100);
    });
}

async function updateMembers(chatId) {
    const list = document.getElementById('member-list');
    list.innerHTML = '<div style="padding:10px; color:gray;">Loading...</div>';
    
    const chatDoc = await getDoc(doc(db, "conversations", chatId));
    const members = chatDoc.data().members || [];
    
    list.innerHTML = "";
    members.forEach(async (uid) => {
        const uDoc = await getDoc(doc(db, "users", uid));
        if (uDoc.exists()) {
            const u = uDoc.data();
            const div = document.createElement('div');
            div.style.padding = "10px";
            div.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            div.innerHTML = `
                <div style="font-size:14px; font-weight:500;">
                    ${u.username} 
                    ${u.verified ? '✅' : ''}
                    ${u.admin ? '<span class="admin-tag">ADMIN</span>' : ''}
                </div>
            `;
            list.appendChild(div);
        }
    });
}

// --- SEND MESSAGE ---
document.getElementById('btn-send').addEventListener('click', sendMessage);
document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    const myName = document.getElementById('my-name').innerText;
    input.value = ""; // Clear input immediately

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text,
        senderId: currentUser.uid,
        senderName: myName,
        timestamp: serverTimestamp()
    });
    
    // Update channel list order
    updateDoc(doc(db, "conversations", activeChatId), {
        lastUpdated: serverTimestamp()
    });
}

// --- NEW CHANNEL ---
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

// --- ADMIN DASHBOARD ---
document.getElementById('btn-open-admin').addEventListener('click', async () => {
    document.getElementById('admin-overlay').style.display = 'flex';
    const list = document.getElementById('admin-list');
    list.innerHTML = "Loading users...";
    
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    
    snap.forEach(d => {
        const u = d.data();
        const div = document.createElement('div');
        div.style.padding = "10px";
        div.style.borderBottom = "1px solid #333";
        div.style.display = "flex";
        div.style.justifyContent = "space-between";
        div.style.alignItems = "center";
        
        div.innerHTML = `
            <span>${u.username}</span>
            <button class="verify-btn" data-id="${d.id}" data-ver="${u.verified}"
                style="background:${u.verified ? '#ef4444' : '#22c55e'}; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">
                ${u.verified ? 'Unverify' : 'Verify'}
            </button>
        `;
        list.appendChild(div);
    });
    
    // Add click listeners to new buttons
    document.querySelectorAll('.verify-btn').forEach(btn => {
        btn.onclick = async (e) => {
            const uid = e.target.getAttribute('data-id');
            const isV = e.target.getAttribute('data-ver') === 'true';
            await updateDoc(doc(db, "users", uid), { verified: !isV });
            document.getElementById('btn-open-admin').click(); // Refresh
        };
    });
});

// --- TOGGLE SIDEBAR ---
document.getElementById('btn-toggle-members').addEventListener('click', () => {
    const sb = document.getElementById('sidebar-right');
    sb.style.display = (sb.style.display === 'none' || sb.style.display === '') ? 'flex' : 'none';
});
