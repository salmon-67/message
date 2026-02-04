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
let isRegisterMode = false;
let msgUnsub = null; // To stop listening when switching chats
let memberUnsub = null; // To stop listening to member updates

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Fetch full profile
        const userSnap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...userSnap.data() };
        
        // Update UI
        document.getElementById('my-username').innerText = currentUser.username;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // Start Sidebar Listener
        syncLeftSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

document.getElementById('btn-login').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const email = `${u}@salmon.chat`; // Fake email generation

    try {
        if (isRegisterMode) {
            const res = await createUserWithEmailAndPassword(auth, email, p);
            // Save extra user details
            await setDoc(doc(db, "users", res.user.uid), {
                username: u,
                username_lower: u.toLowerCase(), // Helper for search
                admin: false,
                online: true,
                createdAt: serverTimestamp()
            });
        } else {
            await signInWithEmailAndPassword(auth, email, p);
        }
    } catch (e) {
        alert("Error: " + e.message);
    }
};

document.getElementById('btn-toggle-auth').onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-status').innerText = isRegisterMode ? "Create Account" : "Login";
    document.getElementById('btn-login').innerText = isRegisterMode ? "Register" : "Sign In";
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

// --- SIDEBAR (LEFT) ---
function syncLeftSidebar() {
    // Listen for conversations where I am a member
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    
    onSnapshot(q, (snap) => {
        const cList = document.getElementById('channel-list');
        const dList = document.getElementById('dm-list');
        cList.innerHTML = "";
        dList.innerHTML = "";

        snap.forEach(async (d) => {
            const data = d.data();
            const div = document.createElement('div');
            
            // Highlight active
            div.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            
            if (data.type === 'dm') {
                // For DM, find the OTHER person's ID to display their name
                const otherId = data.members.find(uid => uid !== currentUser.id) || currentUser.id;
                
                // Fetch name (basic cache implementation)
                let name = "Loading...";
                const uSnap = await getDoc(doc(db, "users", otherId));
                if(uSnap.exists()) name = uSnap.data().username;
                
                div.innerHTML = `<span style="color:#22c55e">●</span>&nbsp; ${name}`;
                div.onclick = () => openChat(d.id, name, true);
                dList.appendChild(div);
            } else {
                // Regular Channel
                div.innerHTML = `# ${data.name}`;
                div.onclick = () => openChat(d.id, data.name, false);
                cList.appendChild(div);
            }
        });
    });
}

// --- CHAT LOGIC ---
async function openChat(chatId, chatName, isDM) {
    if (msgUnsub) msgUnsub(); // Unsubscribe previous listener
    
    activeChatId = chatId;
    
    // UI Updates
    document.getElementById('chat-header-title').innerText = isDM ? `@ ${chatName}` : `# ${chatName}`;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('messages-box').innerHTML = ""; // Clear old msgs
    
    // Hide "Leave" button for DMs, show for Groups
    document.getElementById('btn-leave').style.display = isDM ? 'none' : 'block';
    document.getElementById('btn-add-user').style.display = isDM ? 'none' : 'block';
    
    // Admin Button
    document.getElementById('btn-admin-nuke').style.display = currentUser.admin ? 'block' : 'none';

    // 1. Load Members (Right Sidebar)
    syncRightSidebar(chatId);

    // 2. Load Messages
    const q = query(collection(db, "conversations", chatId, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(q, (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = ""; // Redrawing all for simplicity, can be optimized

        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            
            // Format Timestamp
            let timeStr = "";
            if (m.timestamp) {
                timeStr = m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            if (m.senderId === 'system') {
                div.className = "msg-row";
                div.innerHTML = `<div class="system-msg">${m.content}</div>`;
            } else {
                const isMe = m.senderId === currentUser.id;
                div.className = `msg-row ${isMe ? 'me' : 'them'}`;
                
                // Fetch sender name logic (omitted for brevity, assume stored or fetch)
                // For now, we won't fetch name for every single message to save reads,
                // but usually you'd store displayName in the message itself.
                
                div.innerHTML = `
                    ${!isMe ? `<div class="msg-name">${m.senderName || 'User'}</div>` : ''}
                    <div class="bubble">
                        ${m.content}
                        <span class="timestamp">${timeStr}</span>
                    </div>
                `;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight; // Auto scroll to bottom
    });
}

// --- RIGHT SIDEBAR (MEMBERS) ---
async function syncRightSidebar(chatId) {
    const list = document.getElementById('member-list');
    list.innerHTML = "<div style='padding:10px; color:gray;'>Loading...</div>";

    // Get Chat Document to find member IDs
    const chatSnap = await getDoc(doc(db, "conversations", chatId));
    if (!chatSnap.exists()) return;
    
    const memberIds = chatSnap.data().members || [];
    list.innerHTML = ""; // Clear loading

    // Fetch each user profile
    memberIds.forEach(async (uid) => {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists()) {
            const u = uSnap.data();
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `
                <div class="status-dot ${u.online ? 'online' : ''}"></div>
                <div>
                    <div>${u.username} ${u.admin ? '🛡️' : ''}</div>
                </div>
            `;
            list.appendChild(div);
        }
    });
}

// --- SENDING MESSAGES ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const txt = input.value.trim();
    if (!txt || !activeChatId) return;

    input.value = ""; // Clear input
    
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt,
        senderId: currentUser.id,
        senderName: currentUser.username, // Store name in msg for easier display
        timestamp: serverTimestamp()
    });
};

// --- CREATING CHANNEL ---
document.getElementById('btn-create-channel').onclick = async () => {
    const name = document.getElementById('new-channel-input').value.trim();
    if (name.length < 3) return alert("Name too short");

    await addDoc(collection(db, "conversations"), {
        name: name,
        type: 'channel',
        members: [currentUser.id],
        createdBy: currentUser.id,
        createdAt: serverTimestamp()
    });
    
    document.getElementById('new-channel-input').value = "";
};

// --- SEARCH & ADD USERS ---
let searchAction = null; // 'dm' or 'add'

document.getElementById('btn-dm-add').onclick = () => {
    searchAction = 'dm';
    document.getElementById('search-modal').style.display = 'flex';
};

document.getElementById('btn-add-user').onclick = () => {
    searchAction = 'add';
    document.getElementById('search-modal').style.display = 'flex';
};

document.getElementById('search-input').oninput = async (e) => {
    const val = e.target.value.toLowerCase();
    const resDiv = document.getElementById('search-results');
    resDiv.innerHTML = "";
    if (val.length < 2) return;

    // Search users by username_lower
    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);

    snap.forEach(d => {
        if (d.id === currentUser.id) return; // Don't show myself
        const u = d.data();
        const btn = document.createElement('div');
        btn.style = "padding:10px; background:rgba(255,255,255,0.1); margin:5px; cursor:pointer;";
        btn.innerHTML = `<b>${u.username}</b>`;
        
        btn.onclick = async () => {
            if (searchAction === 'dm') {
                // CREATE DM: ID is combination of both UIDs to ensure uniqueness
                const dmId = [currentUser.id, d.id].sort().join("_");
                
                await setDoc(doc(db, "conversations", dmId), {
                    type: 'dm',
                    members: [currentUser.id, d.id],
                    createdAt: serverTimestamp()
                }, { merge: true }); // Merge prevents overwriting if exists
                
            } else if (searchAction === 'add') {
                // ADD TO GROUP
                await updateDoc(doc(db, "conversations", activeChatId), {
                    members: arrayUnion(d.id)
                });
                // System message
                await addDoc(collection(db, "conversations", activeChatId, "messages"), {
                    content: `${u.username} was added to the room.`,
                    senderId: 'system',
                    timestamp: serverTimestamp()
                });
            }
            document.getElementById('search-modal').style.display = 'none';
        };
        resDiv.appendChild(btn);
    });
};

// --- LEAVE & ADMIN ---
document.getElementById('btn-leave').onclick = async () => {
    if (!confirm("Leave this channel?")) return;
    
    await updateDoc(doc(db, "conversations", activeChatId), {
        members: arrayRemove(currentUser.id)
    });
    
    // System message
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: `${currentUser.username} left the room.`,
        senderId: 'system',
        timestamp: serverTimestamp()
    });
    
    location.reload(); // Quick refresh to reset state
};

document.getElementById('btn-admin-nuke').onclick = async () => {
    if (!confirm("ADMIN: Delete this entire room permanently?")) return;
    await deleteDoc(doc(db, "conversations", activeChatId));
    location.reload();
};
