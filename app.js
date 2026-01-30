import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let msgUnsub = null, memberUnsub = null, channelUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) { signOut(auth); return; }
        currentUser = { id: user.uid, ...userSnap.data() };
        document.getElementById('my-name').innerText = currentUser.username;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 30000);
        await autoJoinAnnouncements();
        loadChannels();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- HELPER: MAKE LINKS CLICKABLE ---
function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" style="color: #3b82f6; text-decoration: underline;">${url}</a>`;
    });
}

function loadChannels() {
    if (channelUnsub) channelUnsub();
    const q = currentUser?.admin 
        ? query(collection(db, "conversations"))
        : query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    
    channelUnsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        const docs = [];
        snap.forEach(d => docs.push({id: d.id, ...d.data()}));
        docs.sort((a, b) => (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0));

        list.innerHTML = ""; 
        docs.forEach(data => {
            const isSelected = activeChatId === data.id;
            const isUnread = !isSelected && (data.lastUpdated?.toMillis() || 0) > (lastReadMap[data.id] || 0);

            const btn = document.createElement('div');
            btn.className = `channel-btn ${isSelected ? 'active' : ''} ${isUnread ? 'unread' : ''}`;
            btn.innerText = `# ${data.name}`;
            btn.onclick = () => openChat(data.id, data.name);
            list.appendChild(btn);
        });
    });
}

function openChat(id, name) {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    
    activeChatId = id;
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';
    
    loadChannels();

    const leaveBtn = document.getElementById('btn-leave-chat');
    if (leaveBtn) {
        leaveBtn.style.display = (name === 'announcements' || currentUser.admin) ? 'none' : 'block';
        leaveBtn.onclick = async () => {
            if (confirm(`Leave #${name}?`)) {
                await updateDoc(doc(db, "conversations", id), { members: arrayRemove(currentUser.id) });
                closeCurrentChat();
            }
        };
    }

    const sidebar = document.getElementById('sidebar-right');
    sidebar.innerHTML = `
        <div class="header">MEMBERS</div>
        <div id="member-list" class="scroll-area"></div>
        <div id="static-add-ui" style="padding:15px; border-top:var(--border);">
            <input type="text" id="target-name" class="input-box" placeholder="Username" style="font-size:11px; margin-bottom:5px;">
            <button id="btn-add-member" class="btn btn-primary" style="font-size:11px; padding:6px;">Add Member</button>
        </div>
    `;

    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const data = docSnap.data();
        if (!data || !activeChatId) return;
        if (!currentUser.admin && data.members && !data.members.includes(currentUser.id)) {
            closeCurrentChat();
            return;
        }
        const listDiv = document.getElementById('member-list');
        const fragment = document.createDocumentFragment();
        const uniqueIds = [...new Set(data.members || [])];
        for (let uid of uniqueIds) {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
                const u = uSnap.data();
                const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 120000);
                const d = document.createElement('div');
                d.className = "member-item";
                d.innerHTML = `<div class="status-dot ${isOnline ? 'online' : ''}"></div><b>${u.username}</b>`;
                fragment.appendChild(d);
            }
        }
        if(listDiv) { listDiv.innerHTML = ""; listDiv.appendChild(fragment); }
    });

    // --- MESSAGE LISTENER (UPDATED WITH LINKS) ---
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); 
        box.innerHTML = ""; 
        snap.forEach(d => {
            const m = d.data();
            const mId = d.id;
            const div = document.createElement('div'); 
            
            if(m.senderId === "system") {
                div.style = "text-align:center; font-size:11px; color:#71717a; margin: 10px 0;";
                div.innerHTML = `<i>${m.content}</i>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const t = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
                const delBtnHtml = currentUser.admin ? `<span class="del-msg" style="cursor:pointer; color:red; margin-left:8px; font-weight:bold;">&times;</span>` : "";
                
                // Process content for links
                const safeContent = linkify(m.content);

                div.innerHTML = `
                    <div class="msg-meta">${m.senderName} • ${t} ${delBtnHtml}</div>
                    <div class="bubble">${safeContent}</div>
                `;

                if(currentUser.admin) {
                    div.querySelector('.del-msg').onclick = async () => {
                        if(confirm("Delete this message?")) {
                            await deleteDoc(doc(db, "conversations", id, "messages", mId));
                        }
                    };
                }
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

function closeCurrentChat() {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = null;
    document.getElementById('messages-box').innerHTML = "";
    document.getElementById('chat-title').innerText = "Select a channel";
    document.getElementById('input-area').style.display = 'none';
    loadChannels();
}

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-signin').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    try { await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p); } catch(e) {}
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    const validUser = /^[a-zA-Z0-9]+$/.test(u);
    if (!validUser || u.length < 3) { alert("Invalid username. Use 3+ letters/numbers only."); return; }
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, admin: false, lastSeen: serverTimestamp() });
    } catch(e) { alert("Registration failed."); }
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) { await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() }); }
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) { await updateDoc(doc(db, "conversations", snap.docs[0].id), { members: arrayUnion(currentUser.id) }); }
}
