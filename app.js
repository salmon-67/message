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

// --- AUTHENTICATION ---
window.handleSignup = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${user}@salmon.com`, pass);
        await setDoc(doc(db, "usernames", user), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: user, uid: res.user.uid });
    } catch (e) { alert(e.message); }
};

window.handleLogin = async () => {
    const user = document.getElementById('username').value.toLowerCase().trim();
    const pass = document.getElementById('password').value;
    try { await signInWithEmailAndPassword(auth, `${user}@salmon.com`, pass); } catch (e) { alert(e.message); }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        loadChatList();
    }
});

// --- ROOM CREATION ---
window.searchAndAdd = async () => {
    const target = document.getElementById('search-username').value.toLowerCase().trim();
    const snap = await getDoc(doc(db, "usernames", target));
    if (snap.exists()) {
        const uid = snap.data().uid;
        if (!selectedMembers.includes(uid)) {
            selectedMembers.push(uid);
            alert(`@${target} added to invite list!`);
            document.getElementById('search-username').value = "";
        }
    } else alert("User not found");
};

window.startGroupChat = async () => {
    const name = document.getElementById('group-name').value.trim();
    if(!name) return;
    const members = [...selectedMembers, currentUser.uid];
    const docRef = await addDoc(collection(db, "conversations"), { 
        name, 
        members, 
        lastMessageAt: serverTimestamp(), 
        lastMessageBy: currentUser.uid 
    });
    selectedMembers = [];
    document.getElementById('group-name').value = "";
};

// --- FIXED CHAT LIST (Client-Side Sorting) ---
function loadChatList() {
    // We remove the 'orderBy' from the server query to avoid Index Errors on iPad
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid));
    
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        
        // 1. Convert snapshot to an array so we can sort it manually
        let chats = [];
        snap.forEach(doc => {
            chats.push({ id: doc.id, ...doc.data() });
        });

        // 2. Sort the array: Most recent 'lastMessageAt' goes to the top
        chats.sort((a, b) => {
            const timeA = a.lastMessageAt?.toMillis() || 0;
            const timeB = b.lastMessageAt?.toMillis() || 0;
            return timeB - timeA;
        });

        // 3. Render the sorted list
        chats.forEach(async (data) => {
            const chatId = data.id;
            const btn = document.createElement('button');
            btn.className = `chat-item ${activeChatId === chatId ? 'active' : ''}`;
            btn.innerHTML = `<span># ${data.name}</span><div class="unread-dot"></div>`;
            btn.onclick = () => openChat(chatId, data.name);
            list.appendChild(btn);

            // Unread logic
            const statusSnap = await getDoc(doc(db, "users", currentUser.uid, "readStatus", chatId));
            const lastRead = statusSnap.exists() ? statusSnap.data().at?.toMillis() : 0;
            const lastMsg = data.lastMessageAt?.toMillis() || 0;
            
            if (lastMsg > lastRead && data.lastMessageBy !== currentUser.uid) {
                btn.classList.add('unread');
            }
        });
    });
}

async function openChat(id, name) {
    activeChatId = id;
    document.getElementById('current-chat-title').innerText = name;
    document.getElementById('sidebar-left').classList.remove('open');
    
    // Mark as read
    await setDoc(doc(db, "users", currentUser.uid, "readStatus", id), { at: serverTimestamp() }, { merge: true });

    // Messages Query (Index not required for simple sub-collection ordering)
    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(qMsg, (snap) => {
        const msgDiv = document.getElementById('messages');
        msgDiv.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const isMine = data.senderId === currentUser.uid;
            msgDiv.innerHTML += `
                <div class="msg-bubble ${isMine ? 'mine' : ''}">
                    <div class="msg-content">
                        <small style="display:block; font-size:10px; margin-bottom:4px; opacity:0.6;">@${data.senderName}</small>
                        ${data.content}
                    </div>
                </div>`;
        });
        msgDiv.scrollTop = msgDiv.scrollHeight;
    });
}

window.sendMessage = async () => {
    const input = document.getElementById('msg-input');
    if (!activeChatId || !input.value.trim()) return;
    const content = input.value;
    const senderName = auth.currentUser.email.split('@')[0];
    input.value = "";

    // 1. Add message
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content, senderId: currentUser.uid, senderName, timestamp: serverTimestamp()
    });

    // 2. Update parent room timestamp (This triggers the list to re-sort)
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastMessageAt: serverTimestamp(), 
        lastMessageBy: currentUser.uid
    });
};
