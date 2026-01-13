import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

let currentUser = null;
let activeChatId = null;
let selectedMembers = [];

// --- PRESENCE LOGIC ---
const setPresence = async (status) => {
    if (auth.currentUser) {
        await setDoc(doc(db, "users", auth.currentUser.uid), { status }, { merge: true });
    }
};

window.addEventListener('beforeunload', () => setPresence("offline"));

// --- AUTHENTICATION ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    if (!user || !pass) return alert("Please fill all fields");
    try {
        const res = await createUserWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
        await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { 
            username: user, 
            uid: res.user.uid, 
            status: "online" 
        });
    } catch (e) { alert(e.message); }
};

window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try { 
        await signInWithEmailAndPassword(auth, `${user}@salmon.com`, pass); 
    } catch (e) { alert(e.message); }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        setPresence("online");
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- CHAT MANAGEMENT ---
window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    if (!target) return;
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            alert(`Added ${target} to the list!`);
        }
    } else { alert("User not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if(!name || selectedMembers.length === 0) return alert("Need a name and at least one friend!");
    
    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), { 
        name, 
        members, 
        lastMessageAt: serverTimestamp(),
        lastMessageBy: "" 
    });
    
    selectedMembers = [];
    document.getElementById('group-name').value = "";
    openChat(docRef.id, name);
};

// --- REAL-TIME CHAT LIST (Sorting & Unread) ---
function loadChatList() {
    const q = query(
        collection(db, "conversations"), 
        where("members", "array-contains", currentUser.uid), 
        orderBy("lastMessageAt", "desc")
    );

    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        
        snap.forEach(async (chatDoc) => {
            const data = chatDoc.data();
            const chatId = chatDoc.id;
            
            // Unread Logic: Compare last msg time vs last time user clicked this chat
            const statusSnap = await getDoc(doc(db, "users", currentUser.uid, "readStatus", chatId));
            const lastRead = statusSnap.exists() ? statusSnap.data().at?.toDate() : 0;
            const lastMsg = data.lastMessageAt?.toDate() || 0;
            const isUnread = lastMsg > lastRead && data.lastMessageBy !== currentUser.uid;

            const btn = document.createElement('button');
            btn.className = `chat-item ${activeChatId === chatId ? 'active' : ''} ${isUnread ? 'unread' : ''}`;
            btn.innerHTML = `<span># ${data.name}</span><div class="unread-dot"></div>`;
            btn.onclick = () => openChat(chatId, data.name);
            list.appendChild(btn);
        });
    });
}

// --- OPENING A CHAT ---
async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    
    // Auto-minimize sidebar on mobile
    if (document.getElementById('sidebar-left').classList.contains('open')) {
        document.getElementById('sidebar-left').classList.remove('open');
    }

    // Mark as Read in database
    await setDoc(doc(db, "users", currentUser.uid, "readStatus", id), { at: serverTimestamp() }, { merge: true });

    // Listen for Messages
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const isMine = data.senderId === currentUser.uid;
            const time = data.timestamp ? data.timestamp.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "just now";
            
            msgDiv.innerHTML += `
                <div class="message-bubble ${isMine ? 'mine' : ''}">
                    <div class="avatar-box">
                        <img class="avatar-img" src="https://ui-avatars.com/api/?name=${data.senderName}&background=random">
                    </div>
                    <div class="msg-content">
                        <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:3px;">
                            <small style="font-weight:bold; font-size:11px;">@${data.senderName}</small>
                            <span class="timestamp" style="font-size:9px; opacity:0.6;">${time}</span>
                        </div>
                        ${data.content}
                    </div>
                </div>`;
        });
        // Auto-scroll to bottom
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Sidebar Member List (Live Status)
    onSnapshot(doc(db, "conversations", id), (chatSnap) => {
        const members = chatSnap.data().members;
        const memberListDiv = document.getElementById('member-list');
        memberListDiv.innerHTML = "";
        
        members.forEach(mUid => {
            onSnapshot(doc(db, "users", mUid), (uSnap) => {
                const uData = uSnap.data();
                if(!uData) return;
                const memId = `mem-${mUid}`;
                
                // Refresh existing member row if status changes
                if (document.getElementById(memId)) document.getElementById(memId).remove();
                
                memberListDiv.innerHTML += `
                    <div class="user-row" id="${memId}" style="display:flex; align-items:center; margin-bottom:12px;">
                        <div class="avatar-box" style="width:24px; height:24px; margin:0 10px 0 0;">
                            <img class="avatar-img" src="https://ui-avatars.com/api/?name=${uData.username}&background=random">
                            <div class="status-dot ${uData.status === 'online' ? 'online' : 'offline'}"></div>
                        </div>
                        <span style="font-size:13px; font-weight:500;">${uData.username}</span>
                    </div>`;
            });
        });
    });
}

// --- SENDING MESSAGES ---
window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    
    const content = input.value;
    const senderName = auth.currentUser.email.split('@')[0];
    input.value = ""; // Clear input immediately for better UX

    // 1. Send the message
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content, 
        type: "text", 
        senderId: currentUser.uid, 
        senderName, 
        timestamp: serverTimestamp()
    });

    // 2. Update conversation for sorting and unread dots
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastMessageAt: serverTimestamp(), 
        lastMessageBy: currentUser.uid
    });
};
