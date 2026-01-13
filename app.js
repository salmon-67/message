import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let selectedMembers = [];
let activeListeners = [];

// --- HELPER: TOAST NOTIFICATIONS ---
function showToast(msg, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- HELPER: CLEANUP LISTENERS ---
const stopListeners = () => {
    activeListeners.forEach(unsub => unsub());
    activeListeners = [];
};

// --- AUTH ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // Set Online
        await setDoc(doc(db, "users", user.uid), { status: "online", lastSeen: serverTimestamp() }, { merge: true });
        
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        showToast(`Welcome back, ${user.email.split('@')[0]}!`);
        loadChatList();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// Set offline on close
window.addEventListener('beforeunload', () => {
    if (currentUser) setDoc(doc(db, "users", currentUser.uid), { status: "offline" }, { merge: true });
});

// --- CHAT LIST ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        let rooms = [];
        snap.forEach(d => rooms.push({ id: d.id, ...d.data() }));
        rooms.sort((a,b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));

        if (rooms.length === 0) list.innerHTML = "<div style='padding:20px; text-align:center; font-size:12px; color:gray'>No channels yet. Create one!</div>";

        rooms.forEach(data => {
            const item = document.createElement('div');
            item.className = `chat-item ${activeChatId === data.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${data.name}</span>`;
            item.onclick = () => openChat(data.id, data.name);
            list.appendChild(item);
        });
    });
}

// --- OPEN CHAT (The Core Logic) ---
async function openChat(id, name) {
    if (activeChatId === id) {
        if (window.innerWidth <= 768) document.getElementById('sidebar-left').classList.remove('open');
        return;
    }
    
    activeChatId = id;
    stopListeners();
    
    document.getElementById('current-chat-title').innerText = `# ${name}`;
    document.getElementById('leave-btn-container').style.display = 'block';
    
    const msgDiv = document.getElementById('messages');
    msgDiv.innerHTML = '<div class="loader" style="margin-top:50px;"></div>'; // Loading Spinner

    if (window.innerWidth <= 768) document.getElementById('sidebar-left').classList.remove('open');

    // 1. MESSAGES LISTENER
    let isFirstLoad = true;
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    
    const unsubMsg = onSnapshot(qMsg, (snap) => {
        if(isFirstLoad) { msgDiv.innerHTML = ""; isFirstLoad = false; }
        
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const m = change.doc.data();
                const mId = change.doc.id;
                
                if (document.getElementById(`msg-${mId}`)) return; // Duplicate Guard

                const isMine = m.senderId === currentUser.uid;
                const isSystem = !m.senderName || m.type === 'system';
                const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

                const msgEl = document.createElement('div');
                msgEl.id = `msg-${mId}`;

                if (isSystem) {
                    msgEl.className = "system-msg";
                    msgEl.innerHTML = `<span>${m.content}</span>`;
                } else {
                    msgEl.className = `msg-container ${isMine ? 'mine' : ''}`;
                    msgEl.innerHTML = `
                        <div class="avatar-box">
                            <img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img">
                            <div class="status-dot offline" id="dot-${mId}"></div>
                        </div>
                        <div class="msg-content">
                            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px; font-size:12px;">
                                <strong style="margin-right:8px; cursor:pointer;">${m.senderName}</strong>
                                <span style="opacity:0.5; font-size:10px;">${time}</span>
                            </div>
                            <div>${m.content}</div>
                        </div>`;
                    
                    // Listener for this specific avatar status
                    const unsubStat = onSnapshot(doc(db, "users", m.senderId), (uSnap) => {
                        const dot = document.getElementById(`dot-${mId}`);
                        if(dot && uSnap.exists()) dot.className = `status-dot ${uSnap.data().status === 'online' ? 'online' : 'offline'}`;
                    });
                    activeListeners.push(unsubStat);
                }
                
                // Smart Scroll: Only scroll if user is near bottom or it's their message
                const isNearBottom = msgDiv.scrollHeight - msgDiv.scrollTop - msgDiv.clientHeight < 100;
                msgDiv.appendChild(msgEl);
                if (isNearBottom || isMine) msgDiv.scrollTop = msgDiv.scrollHeight;
            }
        });
    });
    activeListeners.push(unsubMsg);

    // 2. MEMBER LISTENER
    const unsubRoom = onSnapshot(doc(db, "conversations", id), (snap) => {
        const memberDiv = document.getElementById('member-list');
        if (!memberDiv || !snap.exists()) return;
        
        // We use docChanges on the conversation doc isn't enough, we need to map the array
        // So we clear and rebuild member list safely
        memberDiv.innerHTML = "";
        
        snap.data().members.forEach(uid => {
            const unsubMem = onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data(); if (!u) return;
                
                const existing = document.getElementById(`mem-${uid}`);
                if (existing) existing.remove();

                const row = document.createElement('div');
                row.id = `mem-${uid}`;
                row.style = "display:flex; align-items:center; margin-bottom:12px; font-size:14px;";
                row.innerHTML = `
                    <div class="avatar-box" style="width:28px; height:28px; margin:0 10px 0 0;">
                        <img src="https://ui-avatars.com/api/?name=${u.username}" class="avatar-img">
                        <div class="status-dot ${u.status === 'online' ? 'online' : 'offline'}"></div>
                    </div>
                    <span>${u.username}</span>`;
                memberDiv.appendChild(row);
            });
            activeListeners.push(unsubMem);
        });
    });
    activeListeners.push(unsubRoom);
}

// --- GLOBAL ACTIONS ---
window.handleSignup = async () => {
    try {
        const u = document.getElementById('username').value.toLowerCase().trim();
        const p = document.getElementById('password').value;
        if(!u || !p) return showToast("Please fill all fields", true);
        
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u, uid: res.user.uid, status: "online" });
    } catch(e) { showToast(e.message, true); }
};

window.handleLogin = async () => {
    try {
        const u = document.getElementById('username').value.toLowerCase().trim();
        const p = document.getElementById('password').value;
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch(e) { showToast("Login failed: " + e.message, true); }
};

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const txt = input.value;
    input.value = "";
    
    try {
        await addDoc(collection(db, "conversations", activeChatId, "messages"), {
            content: txt, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
        });
        await updateDoc(doc(db, "conversations", activeChatId), { lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid });
    } catch(e) { showToast("Failed to send", true); input.value = txt; }
};

// Handle Enter to send
document.getElementById('msg-input').addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
});

window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    if(!target) return;
    const snap = await getDoc(doc(db, "usernames", target));
    if(snap.exists()) { 
        selectedMembers.push(snap.data().uid); 
        showToast(`@${target} staged for invite!`);
        document.getElementById('search-username').value = "";
    } else { showToast("User not found", true); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value;
    if(!name) return showToast("Enter a room name", true);
    
    const docRef = await addDoc(collection(db, "conversations"), { 
        name, members: [...selectedMembers, currentUser.uid], lastMessageAt: serverTimestamp() 
    });
    selectedMembers = [];
    document.getElementById('group-name').value = "";
    openChat(docRef.id, name);
};

window.leaveCurrentGroup = async () => {
    if (!activeChatId || !confirm("Leave this channel?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.uid) });
    location.reload();
};

window.toggleSidebar = () => document.getElementById('sidebar-left').classList.toggle('open');
