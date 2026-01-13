import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let currentUser = null;
let activeChatId = null;
let selectedMembers = [];
let memberListeners = []; // Track to prevent duplicates/memory leaks

// --- CORE UTILS ---
window.toggleSidebar = () => {
    document.getElementById('sidebar-left').classList.toggle('open');
};

const stopOldListeners = () => {
    memberListeners.forEach(unsub => unsub());
    memberListeners = [];
};

// --- AUTH & PRESENCE ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // Mark online
        await setDoc(doc(db, "users", user.uid), { 
            status: "online", 
            lastSeen: serverTimestamp() 
        }, { merge: true });
        
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

// Update status to offline when closing tab
window.addEventListener('beforeunload', () => {
    if (currentUser) {
        setDoc(doc(db, "users", currentUser.uid), { status: "offline" }, { merge: true });
    }
});

// --- CHAT LIST (SIDEBAR) ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        let rooms = [];
        snap.forEach(d => rooms.push({ id: d.id, ...d.data() }));
        
        // Sort rooms by most recent activity
        rooms.sort((a,b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));

        rooms.forEach(data => {
            const item = document.createElement('div');
            item.className = `chat-item ${activeChatId === data.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${data.name}</span>`;
            item.onclick = () => openChat(data.id, data.name);
            list.appendChild(item);
        });
    });
}

// --- OPEN CHAT & REAL-TIME CONTENT ---
async function openChat(id, name) {
    if (activeChatId === id && document.getElementById('messages').innerHTML !== "") {
        if (window.innerWidth <= 768) window.toggleSidebar();
        return;
    }

    activeChatId = id;
    stopOldListeners(); // Kill old presence listeners to stop duplication
    
    document.getElementById('current-chat-title').innerText = name;
    document.getElementById('leave-btn-container').style.display = 'block';
    
    // Auto-minimise sidebar on mobile/iPad
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar-left').classList.remove('open');
    }

    // 1. Listen for Messages
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    const unsubMsg = onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMine = m.senderId === currentUser.uid;
            const time = m.timestamp ? new Date(m.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
            
            const msgHtml = `
                <div class="msg-bubble ${isMine ? 'mine' : ''}">
                    <div class="avatar-box">
                        <img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img">
                        <div class="status-dot offline" id="msgdot-${d.id}"></div>
                    </div>
                    <div class="msg-content">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:2px;">
                            <small style="font-weight:bold; font-size:11px;">@${m.senderName}</small>
                            <small style="font-size:9px; opacity:0.5;">${time}</small>
                        </div>
                        <div>${m.content}</div>
                    </div>
                </div>`;
            msgDiv.insertAdjacentHTML('beforeend', msgHtml);

            // Real-time status dot on message avatar
            const unsubDot = onSnapshot(doc(db, "users", m.senderId), (uSnap) => {
                const dot = document.getElementById(`msgdot-${d.id}`);
                if (dot && uSnap.exists()) {
                    dot.className = `status-dot ${uSnap.data().status === 'online' ? 'online' : 'offline'}`;
                }
            });
            memberListeners.push(unsubDot);
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });
    memberListeners.push(unsubMsg);

    // 2. Listen for Room Members (Right Sidebar)
    const unsubRoom = onSnapshot(doc(db, "conversations", id), (snap) => {
        const memberList = document.getElementById('member-list');
        if (!memberList) return;
        memberList.innerHTML = ""; 
        
        const uids = snap.data().members;
        uids.forEach(uid => {
            const unsubUser = onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data(); if (!u) return;
                
                // Remove old row if it exists to prevent duplication
                const oldRow = document.getElementById(`mem-row-${uid}`);
                if (oldRow) oldRow.remove();

                const row = document.createElement('div');
                row.id = `mem-row-${uid}`;
                row.style = "display:flex; align-items:center; gap:10px; margin-bottom:12px; font-size:13px;";
                row.innerHTML = `
                    <div class="avatar-box" style="width:24px; height:24px; margin:0;">
                        <img src="https://ui-avatars.com/api/?name=${u.username}" style="width:100%; border-radius:50%;">
                        <div class="status-dot ${u.status === 'online' ? 'online' : 'offline'}"></div>
                    </div>
                    <span style="color: ${u.status === 'online' ? '#fff' : '#888'}">${u.username}</span>`;
                memberList.appendChild(row);
            });
            memberListeners.push(unsubUser);
        });
    });
    memberListeners.push(unsubRoom);
}

// --- ACTIONS ---
window.handleSignup = async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u, uid: res.user.uid, status: "online" });
    } catch(e) { alert(e.message); }
};

window.handleLogin = async () => {
    const u = document.getElementById('username').value.toLowerCase().trim();
    const p = document.getElementById('password').value;
    try {
        await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p);
    } catch(e) { alert(e.message); }
};

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const text = input.value;
    input.value = "";
    
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text,
        senderId: currentUser.uid,
        senderName: currentUser.email.split('@')[0],
        timestamp: serverTimestamp()
    });
    
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastMessageAt: serverTimestamp(),
        lastMessageBy: currentUser.uid
    });
};

window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    if (!target) return;
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            alert(`Added @${target} to invite list`);
            document.getElementById('search-username').value = "";
        }
    } else { alert("User not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return;
    const docRef = await addDoc(collection(db, "conversations"), {
        name,
        members: [...selectedMembers, currentUser.uid],
        lastMessageAt: serverTimestamp(),
        lastMessageBy: currentUser.uid
    });
    selectedMembers = [];
    document.getElementById('group-name').value = "";
    openChat(docRef.id, name);
};

window.leaveCurrentGroup = async () => {
    if (!activeChatId || !confirm("Are you sure you want to leave this group?")) return;
    await updateDoc(doc(db, "conversations", activeChatId), {
        members: arrayRemove(currentUser.uid)
    });
    location.reload(); 
};
