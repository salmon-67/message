import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- PRESENCE SYSTEM ---
const updateStatus = async (status) => {
    if (currentUser) {
        await setDoc(doc(db, "users", currentUser.uid), { 
            status: status, 
            lastSeen: serverTimestamp() 
        }, { merge: true });
    }
};

// --- AUTHENTICATION ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
        await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: user, uid: res.user.uid, status: "online" });
    } catch (e) { alert(e.message); }
};

window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, `${user}@salmon.com`, pass); } catch (e) { alert(e.message); }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        updateStatus("online");
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

window.addEventListener('beforeunload', () => updateStatus("offline"));

// --- INVITES & ROOMS ---
window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    if (!target) return;
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            alert(`Ready to invite @${target}`);
            document.getElementById('search-username').value = "";
        }
    } else { alert("User not found"); }
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return;
    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), { 
        name, 
        members, 
        lastMessageAt: serverTimestamp(), 
        lastMessageBy: currentUser.uid 
    });
    selectedMembers = [];
    document.getElementById('group-name').value = "";
    openChat(docRef.id, name);
};

// --- REAL-TIME LISTENERS ---
function loadChatList() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        let rooms = [];
        snap.forEach(d => rooms.push({ id: d.id, ...d.data() }));

        // Client-side sort to fix iPad/Index issues
        rooms.sort((a,b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));

        rooms.forEach(async (data) => {
            const item = document.createElement('div');
            item.className = `chat-item ${activeChatId === data.id ? 'active' : ''}`;
            item.innerHTML = `<span># ${data.name}</span>`;
            item.onclick = () => openChat(data.id, data.name);
            
            // Unread check
            const rSnap = await getDoc(doc(db, "users", currentUser.uid, "readStatus", data.id));
            const lastRead = rSnap.exists() ? rSnap.data().at?.toMillis() : 0;
            if ((data.lastMessageAt?.toMillis() || 0) > lastRead && data.lastMessageBy !== currentUser.uid) {
                item.classList.add('unread');
            }
            list.appendChild(item);
        });
    });
}

async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    if (window.innerWidth < 768) document.getElementById('sidebar-left').classList.remove('open');
    
    // Mark as Read
    await setDoc(doc(db, "users", currentUser.uid, "readStatus", id), { at: serverTimestamp() }, { merge: true });

    // Listen for Messages
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMine = m.senderId === currentUser.uid;
            msgDiv.innerHTML += `
                <div class="msg-bubble ${isMine ? 'mine' : ''}">
                    <div class="avatar-box"><img src="https://ui-avatars.com/api/?name=${m.senderName}&background=random" class="avatar-img"></div>
                    <div class="msg-content">
                        <small style="display:block; font-size:10px; font-weight:bold; margin-bottom:3px;">@${m.senderName}</small>
                        ${m.content}
                    </div>
                </div>`;
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });

    // Listen for Online Members in THIS room
    onSnapshot(doc(db, "conversations", id), (snap) => {
        const members = snap.data().members;
        const memberList = document.getElementById('member-list');
        document.getElementById('member-count').innerText = members.length;
        memberList.innerHTML = "";
        
        members.forEach(uid => {
            onSnapshot(doc(db, "users", uid), (uSnap) => {
                const u = uSnap.data();
                if(!u) return;
                const rowId = `row-${uid}`;
                if(document.getElementById(rowId)) document.getElementById(rowId).remove();

                const row = document.createElement('div');
                row.id = rowId;
                row.style = "display:flex; align-items:center; margin-bottom:12px;";
                row.innerHTML = `
                    <div class="avatar-box" style="width:24px; height:24px; margin:0 10px 0 0;">
                        <img src="https://ui-avatars.com/api/?name=${u.username}" style="width:100%; border-radius:50%;">
                        <div class="status-dot ${u.status === 'online' ? 'online' : 'offline'}"></div>
                    </div>
                    <span style="font-size:13px; color:${u.status === 'online' ? '#fff' : '#888'}">${u.username}</span>
                `;
                memberList.appendChild(row);
            });
        });
    });
}

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const content = input.value;
    const senderName = auth.currentUser.email.split('@')[0];
    input.value = "";
    
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content, senderId: currentUser.uid, senderName, timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastMessageAt: serverTimestamp(), lastMessageBy: currentUser.uid
    });
};
