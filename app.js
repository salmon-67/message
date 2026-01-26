import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex'; // Activates Flexbox Layout
        
        // Load User Info
        const uDoc = await getDoc(doc(db, "users", user.uid));
        if (uDoc.exists()) {
            const data = uDoc.data();
            document.getElementById('my-username').innerText = data.username;
            document.getElementById('my-avatar').innerText = data.username[0].toUpperCase();
            
            if (data.admin) {
                document.getElementById('btn-admin-tools').style.display = 'block';
            }
        }
        
        loadChannels();
    } else {
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

document.getElementById('btn-login').addEventListener('click', () => {
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value;
    if(!u || !p) return alert("Please fill in all fields");
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(e => alert(e.message));
});

document.getElementById('btn-register').addEventListener('click', async () => {
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value;
    if(!u || !p) return alert("Please fill in all fields");
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        // Create user profile in Firestore immediately
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, 
            verified: false, 
            admin: false 
        });
    } catch (e) { alert(e.message); }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// --- CHAT LOGIC ---
function loadChannels() {
    onSnapshot(query(collection(db, "conversations"), orderBy("lastUpdated", "desc")), (snapshot) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = "";
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === docSnap.id ? 'active' : ''}`;
            btn.innerText = `# ${data.name}`;
            btn.onclick = () => openChat(docSnap.id, data.name);
            list.appendChild(btn);
        });
    });
}

async function openChat(chatId, chatName) {
    if (msgUnsub) msgUnsub(); // Detach previous listener
    activeChatId = chatId;
    
    // Update Header & Active State
    document.getElementById('current-channel-name').innerText = `# ${chatName}`;
    document.querySelectorAll('.channel-btn').forEach(b => b.classList.remove('active'));
    // (Optional: Re-highlight active button here if strictly needed)

    // Check Restrictions (Announcements)
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const isAdmin = userDoc.data()?.admin;
    const isRestricted = chatName.toLowerCase() === 'announcements' && !isAdmin;
    
    const inputZone = document.getElementById('input-zone');
    inputZone.style.display = isRestricted ? 'none' : 'block';

    // Load Members (Realtime for this chat)
    updateMemberList(chatId);

    // Load Messages
    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snapshot) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        
        snapshot.forEach(async (msgDoc) => {
            const m = msgDoc.data();
            const isMe = m.senderId === currentUser.uid;
            
            // Get sender verification status
            // Note: In a massive app, you'd cache this. For this scale, fetching is fine.
            let isVerified = false;
            if(!isMe) {
                const sDoc = await getDoc(doc(db, "users", m.senderId));
                isVerified = sDoc.exists() && sDoc.data().verified;
            }

            const div = document.createElement('div');
            div.className = `msg-wrapper ${isMe ? 'me' : 'them'}`;
            
            div.innerHTML = `
                ${!isMe ? `<div class="msg-info">
                    ${m.senderName} ${isVerified ? '<span class="badge-verified">✔</span>' : ''}
                </div>` : ''}
                <div class="msg-bubble">${m.content}</div>
            `;
            box.appendChild(div);
        });
        
        // Auto Scroll
        setTimeout(() => box.scrollTop = box.scrollHeight, 100);
    });
}

async function updateMemberList(chatId) {
    const list = document.getElementById('member-list');
    list.innerHTML = '<div style="padding:10px; color:grey;">Loading...</div>';
    
    const chatDoc = await getDoc(doc(db, "conversations", chatId));
    if(!chatDoc.exists()) return;
    
    const members = chatDoc.data().members || [];
    list.innerHTML = ""; // Clear loader
    
    for(const uid of members) {
        const uDoc = await getDoc(doc(db, "users", uid));
        if(uDoc.exists()) {
            const u = uDoc.data();
            const div = document.createElement('div');
            div.style.padding = "8px 12px";
            div.style.display = "flex";
            div.style.alignItems = "center";
            div.style.gap = "8px";
            div.innerHTML = `
                <div style="width:8px; height:8px; background:${u.verified ? 'var(--accent)' : 'gray'}; border-radius:50%;"></div>
                <span style="font-size:14px;">${u.username}</span>
                ${u.admin ? '<span style="font-size:10px; color:var(--danger); border:1px solid var(--danger); padding:1px 4px; border-radius:4px;">ADMIN</span>' : ''}
            `;
            list.appendChild(div);
        }
    }
}

// --- SENDING MESSAGES ---
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if(!text || !activeChatId) return;
    
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const username = userDoc.data().username;

    input.value = "";
    
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text,
        senderId: currentUser.uid,
        senderName: username,
        timestamp: serverTimestamp(),
        type: "text"
    });
    
    // Update Channel timestamp
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastUpdated: serverTimestamp()
    });
}

// --- CREATING CHANNELS ---
document.getElementById('btn-create-channel').addEventListener('click', async () => {
    const name = document.getElementById('new-channel-name').value.trim();
    if(!name) return;
    
    await addDoc(collection(db, "conversations"), {
        name: name,
        members: [currentUser.uid], // Creator is first member
        lastUpdated: serverTimestamp()
    });
    
    document.getElementById('new-channel-name').value = "";
});

// --- UI TOGGLES ---
document.getElementById('btn-toggle-members').addEventListener('click', () => {
    const sb = document.getElementById('sidebar-right');
    sb.style.display = (sb.style.display === 'none' || sb.style.display === '') ? 'flex' : 'none';
});

document.getElementById('btn-mobile-menu').addEventListener('click', () => {
    document.getElementById('sidebar-left').classList.toggle('open');
});

// --- ADMIN DASHBOARD ---
document.getElementById('btn-admin-tools').addEventListener('click', async () => {
    document.getElementById('admin-overlay').style.display = 'flex';
    const list = document.getElementById('admin-user-list');
    list.innerHTML = "Loading...";
    
    const snap = await getDocs(collection(db, "users"));
    list.innerHTML = "";
    
    snap.forEach(docSnap => {
        const u = docSnap.data();
        const div = document.createElement('div');
        div.style = "display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #333; align-items:center;";
        div.innerHTML = `
            <span>${u.username}</span>
            <button class="verify-btn" data-id="${docSnap.id}" data-status="${u.verified}" 
            style="background:${u.verified ? 'var(--danger)' : 'var(--success)'}; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer;">
                ${u.verified ? 'Revoke' : 'Verify'}
            </button>
        `;
        list.appendChild(div);
    });
    
    // Add listeners to new buttons
    document.querySelectorAll('.verify-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = e.target.getAttribute('data-id');
            const currentStatus = e.target.getAttribute('data-status') === 'true';
            await updateDoc(doc(db, "users", uid), { verified: !currentStatus });
            document.getElementById('btn-admin-tools').click(); // Refresh list
        });
    });
});
