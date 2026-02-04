import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// State Variables
let currentUser = null;
let activeChatId = null;
let isAddingMode = "channel"; // 'channel' or 'dm'
let isRegisterMode = false;
let msgUnsub = null;

// --- AUTHENTICATION ---
document.getElementById('btn-auth-toggle').onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-status').innerText = isRegisterMode ? "Create a new account" : "Welcome back";
    document.getElementById('btn-auth-main').innerText = isRegisterMode ? "Register" : "Sign In";
    document.getElementById('btn-auth-toggle').innerText = isRegisterMode ? "Back to Login" : "Create an account";
};

document.getElementById('btn-auth-main').onclick = async () => {
    const userInp = document.getElementById('login-user').value.trim().toLowerCase();
    const passInp = document.getElementById('login-pass').value;

    if (userInp.length < 3 || passInp.length < 6) {
        return alert("Username must be 3+ chars, Password 6+ chars.");
    }

    const email = `${userInp}@salmon.chat`;

    try {
        if (isRegisterMode) {
            const res = await createUserWithEmailAndPassword(auth, email, passInp);
            // Create User Doc with username_lower for searching
            await setDoc(doc(db, "users", res.user.uid), { 
                username: userInp, 
                username_lower: userInp, 
                admin: false, 
                vip: false,
                online: true 
            });
        } else {
            await signInWithEmailAndPassword(auth, email, passInp);
        }
    } catch (e) {
        alert("Login Error: " + e.message);
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Fetch full profile
        const userDoc = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...userDoc.data() };
        
        // Update online status
        await updateDoc(doc(db, "users", user.uid), { online: true });

        // Update UI
        let badge = currentUser.admin ? " 🛠️" : (currentUser.vip ? " ✨" : "");
        document.getElementById('my-name').innerText = currentUser.username + badge;
        document.getElementById('btn-admin-dash').style.display = currentUser.admin ? 'block' : 'none';
        
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

document.getElementById('btn-logout').onclick = async () => {
    if (currentUser) {
        await updateDoc(doc(db, "users", currentUser.id), { online: false });
    }
    signOut(auth);
};

// --- SIDEBAR LOGIC ---
function syncSidebar() {
    // Show chats where user is a member
    const q = currentUser.admin 
        ? query(collection(db, "conversations"), orderBy("lastUpdated", "desc"))
        : query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));

    onSnapshot(q, (snap) => {
        const cList = document.getElementById('channel-list');
        const dList = document.getElementById('dm-list');
        cList.innerHTML = ""; 
        dList.innerHTML = "";
        
        snap.forEach(async (d) => {
            const data = d.data();
            const id = d.id;
            const btn = document.createElement('div');
            
            // Highlight Logic
            const isActive = activeChatId === id ? "active" : "";
            btn.className = `channel-btn ${isActive}`;
            
            if (data.type === 'dm') {
                // Find the OTHER person's ID to display their name
                const otherId = data.members.find(uid => uid !== currentUser.id) || data.members[0];
                // We fetch the name asynchronously
                const uSnap = await getDoc(doc(db, "users", otherId));
                const uData = uSnap.data();
                const onlineDot = uData?.online ? `<span class="status-dot online"></span>` : `<span class="status-dot"></span>`;
                
                btn.innerHTML = `<span>${onlineDot}${uData?.username || "Unknown"}</span>`;
                btn.onclick = () => openChat(id, uData?.username || "DM", true);
                dList.appendChild(btn);
            } else {
                btn.innerHTML = `<span># ${data.name}</span>`;
                btn.onclick = () => openChat(id, data.name, false);
                cList.appendChild(btn);
            }
        });
    });
}

// --- CHAT LOGIC ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    
    // Refresh sidebar to apply blue highlight
    syncSidebar();

    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    
    // Header Buttons
    const isAnnounce = name?.toLowerCase().includes("announcement");
    document.getElementById('btn-delete-channel').style.display = currentUser.admin ? 'block' : 'none';
    // Hide Leave/Add for DMs or Announcements
    document.getElementById('btn-leave-room').style.display = (isDM || isAnnounce) ? 'none' : 'block';
    document.getElementById('header-add-user').style.display = (isDM || isAnnounce) ? 'none' : 'block';

    // Auto-Join if Shadow Mode (Admin) or just visiting
    const roomRef = doc(db, "conversations", id);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.data().members.includes(currentUser.id) && !currentUser.admin) {
        await updateDoc(roomRef, { members: arrayUnion(currentUser.id) });
    }

    // Load Messages
    const mq = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(mq, async (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        
        for (const d of snap.docs) {
            const m = d.data();
            const div = document.createElement('div');
            
            if (m.senderId === "system") {
                div.style = "text-align:center; font-size:11px; color:gray; margin:10px 0;";
                div.innerText = m.content;
            } else {
                // Fetch sender name
                const sSnap = await getDoc(doc(db, "users", m.senderId));
                const sData = sSnap.data();
                const badge = sData?.admin ? "🛠️" : (sData?.vip ? "✨" : "");
                
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                
                // Add Delete button if Admin
                const deleteBtn = currentUser.admin ? `<span style="color:red; cursor:pointer; margin-left:8px;" onclick="window.delMsg('${d.id}')">×</span>` : "";

                div.innerHTML = `
                    <div class="msg-meta">${badge} ${sData?.username || "User"}</div>
                    <div class="bubble">${m.content} ${deleteBtn}</div>
                `;
            }
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;
    });
}

// Sending Messages
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    const val = inp.value.trim();
    if (!val) return;
    
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: val,
        senderId: currentUser.id,
        timestamp: serverTimestamp()
    });
    // Update lastUpdated for sorting
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

// Creating Channels
document.getElementById('btn-create').onclick = async () => {
    const inp = document.getElementById('new-channel-name');
    // Sanitize: only alphanumeric
    const name = inp.value.trim().replace(/[^a-zA-Z0-9 ]/g, "");
    
    if (name.length < 3) return alert("Name too short.");
    
    // Check Duplicate
    const q = query(collection(db, "conversations"), where("name", "==", name), limit(1));
    const exists = await getDocs(q);
    if (!exists.empty) return alert("Channel already exists!");

    await addDoc(collection(db, "conversations"), {
        name: name,
        type: 'channel',
        members: [currentUser.id],
        createdBy: currentUser.id,
        lastUpdated: serverTimestamp()
    });
    inp.value = "";
};

// Leave Room
document.getElementById('btn-leave-room').onclick = async () => {
    if(!confirm("Leave this channel?")) return;
    
    await updateDoc(doc(db, "conversations", activeChatId), {
        members: arrayRemove(currentUser.id)
    });
    
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: `${currentUser.username} left the room.`,
        senderId: "system",
        timestamp: serverTimestamp()
    });
    
    activeChatId = null;
    document.getElementById('messages-box').innerHTML = "";
    document.getElementById('input-area').style.display = "none";
    document.getElementById('chat-actions').style.display = "none";
    document.getElementById('chat-title').innerText = "Select a channel";
    syncSidebar();
};

// Delete Room (Admin)
document.getElementById('btn-delete-channel').onclick = async () => {
    if(!confirm("DELETE entire room? Cannot be undone.")) return;
    await deleteDoc(doc(db, "conversations", activeChatId));
    location.reload();
};

// --- SEARCH & ADD USERS ---
const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-user-input');
const searchResults = document.getElementById('search-results');

// Open Modals
document.getElementById('header-add-user').onclick = () => {
    isAddingMode = "channel";
    document.getElementById('search-title').innerText = "Add User to Channel";
    searchModal.style.display = 'flex';
    searchInput.focus();
};
document.getElementById('open-dm-search').onclick = () => {
    isAddingMode = "dm";
    document.getElementById('search-title').innerText = "New Direct Message";
    searchModal.style.display = 'flex';
    searchInput.focus();
};
document.getElementById('close-search').onclick = () => {
    searchModal.style.display = 'none';
    searchInput.value = "";
    searchResults.innerHTML = "";
};

// Search Logic
searchInput.oninput = async () => {
    const val = searchInput.value.trim().toLowerCase();
    if (val.length < 2) return;

    // Search by username_lower
    const q = query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5));
    const snap = await getDocs(q);
    
    searchResults.innerHTML = "";
    snap.forEach(d => {
        if(d.id === currentUser.id) return; // Don't show self
        
        const u = d.data();
        const div = document.createElement('div');
        div.className = "search-item";
        
        const onlineStatus = u.online ? "online" : "";
        
        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <div class="status-dot ${onlineStatus}"></div>
                <span>${u.username}</span>
            </div>
            <button class="action-btn-small">${isAddingMode === 'channel' ? 'Add' : 'Chat'}</button>
        `;
        
        // Handle Click
        div.querySelector('button').onclick = async () => {
            if (isAddingMode === "channel") {
                // Add to existing channel
                await updateDoc(doc(db, "conversations", activeChatId), {
                    members: arrayUnion(d.id)
                });
                await addDoc(collection(db, "conversations", activeChatId, "messages"), {
                    content: `${u.username} was added.`,
                    senderId: "system",
                    timestamp: serverTimestamp()
                });
                alert("User added!");
            } else {
                // Create DM
                const dmId = [currentUser.id, d.id].sort().join("_");
                await setDoc(doc(db, "conversations", dmId), {
                    type: 'dm',
                    members: [currentUser.id, d.id],
                    lastUpdated: serverTimestamp()
                }, { merge: true }); // merge prevents overwriting existing DMs
                
                openChat(dmId, u.username, true);
            }
            searchModal.style.display = 'none';
            searchInput.value = "";
            searchResults.innerHTML = "";
        };
        searchResults.appendChild(div);
    });
};

// --- ADMIN DASHBOARD ---
document.getElementById('btn-admin-dash').onclick = () => document.getElementById('admin-overlay').style.display = 'flex';
document.getElementById('close-admin').onclick = () => document.getElementById('admin-overlay').style.display = 'none';

document.getElementById('admin-search-users').oninput = async (e) => {
    const val = e.target.value.toLowerCase();
    if(val.length < 2) return;
    
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(10)));
    const res = document.getElementById('admin-user-results');
    res.innerHTML = "";
    
    snap.forEach(d => {
        const u = d.data();
        const div = document.createElement('div');
        div.style = "background:rgba(255,255,255,0.05); padding:10px; margin-bottom:5px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;";
        div.innerHTML = `
            <span>${u.username} <small style="color:gray">${u.admin?'(Admin)':''}</small></span>
            <div>
                <button onclick="window.setRank('${d.id}', 'admin')" style="background:#8b5cf6; color:white; border:none; padding:4px; border-radius:4px; cursor:pointer;">Admin</button>
                <button onclick="window.setRank('${d.id}', 'vip')" style="background:#f59e0b; color:white; border:none; padding:4px; border-radius:4px; cursor:pointer;">VIP</button>
                <button onclick="window.setRank('${d.id}', 'member')" style="background:#10b981; color:white; border:none; padding:4px; border-radius:4px; cursor:pointer;">Member</button>
            </div>
        `;
        res.appendChild(div);
    });
};

// Global helpers for inline onclicks
window.setRank = async (uid, rank) => {
    const ref = doc(db, "users", uid);
    if(rank === 'admin') await updateDoc(ref, {admin:true, vip:false});
    else if(rank === 'vip') await updateDoc(ref, {admin:false, vip:true});
    else await updateDoc(ref, {admin:false, vip:false});
    alert(`User set to ${rank}`);
};

window.delMsg = async (msgId) => {
    if(confirm("Delete message?")) {
        await deleteDoc(doc(db, "conversations", activeChatId, "messages", msgId));
    }
};
