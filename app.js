import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// --- AUTH ---
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

// --- SIDEBAR ---
function loadChannels() {
    if (channelUnsub) channelUnsub();
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.id), orderBy("lastUpdated", "desc"));
    
    channelUnsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = ""; 
        snap.forEach(d => {
            const data = d.data();
            const isSelected = activeChatId === d.id;
            const lastUpdated = data.lastUpdated?.toMillis() || 0;
            const lastViewed = lastReadMap[d.id] || 0;
            const isUnread = !isSelected && lastUpdated > lastViewed;

            const btn = document.createElement('div');
            btn.className = `channel-btn ${isSelected ? 'active' : ''} ${isUnread ? 'unread' : ''}`;
            btn.innerText = `# ${data.name}`;
            btn.onclick = () => openChat(d.id, data.name);
            list.appendChild(btn);
        });
    });
}

// --- OPEN CHAT ---
function openChat(id, name) {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    
    activeChatId = id;
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';
    
    loadChannels();

    const sidebar = document.getElementById('sidebar-right');
    sidebar.innerHTML = `
        <div class="header">MEMBERS</div>
        <div id="member-list" class="scroll-area"></div>
        <div id="static-add-ui" style="padding:15px; border-top:var(--border);">
            <input type="text" id="target-name" class="input-box" placeholder="Username" style="font-size:11px; margin-bottom:5px;">
            <button id="btn-add-member" class="btn btn-primary" style="font-size:11px; padding:6px;">Add Member</button>
            <div id="add-err" style="color:red; font-size:10px; margin-top:5px;"></div>
        </div>
    `;

    if(name === 'announcements') document.getElementById('static-add-ui').style.display = 'none';

    document.getElementById('btn-add-member').onclick = async () => {
        const val = document.getElementById('target-name').value.trim();
        if(!val) return;
        const qU = query(collection(db, "users"), where("username", "==", val), limit(1));
        const sU = await getDocs(qU);
        if(!sU.empty) {
            const newId = sU.docs[0].id;
            const newName = sU.docs[0].data().username;
            await updateDoc(doc(db, "conversations", id), { members: arrayUnion(newId), lastUpdated: serverTimestamp() });
            await addDoc(collection(db, "conversations", id, "messages"), {
                content: `${currentUser.username} added ${newName}`, senderId: "system", senderName: "System", timestamp: serverTimestamp()
            });
            document.getElementById('target-name').value = "";
            document.getElementById('add-err').innerText = "";
        } else { document.getElementById('add-err').innerText = "User not found"; }
    };

    // --- MEMBER LISTENER (DE-DUPLICATION FIX) ---
    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const memberListDiv = document.getElementById('member-list');
        if (!memberListDiv) return;

        const data = docSnap.data();
        if (!data || !data.members) return;

        const fragment = document.createDocumentFragment();
        const seenIds = new Set(); // TRACKS UNIQUE USERS

        // Get members array and filter for unique values just in case DB has duplicates
        const uniqueMembers = [...new Set(data.members)];

        for (let uid of uniqueMembers) {
            if (seenIds.has(uid)) continue; // Double-check logic
            seenIds.add(uid);

            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
                const u = uSnap.data();
                const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 120000);
                const item = document.createElement('div');
                item.className = "member-item";
                item.innerHTML = `<div class="status-dot ${isOnline ? 'online' : ''}"></div><b>${u.username}</b>`;
                fragment.appendChild(item);
            }
        }

        // Final UI swap
        memberListDiv.innerHTML = ""; 
        memberListDiv.appendChild(fragment);
    });

    // --- MESSAGES LISTENER ---
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); 
        box.innerHTML = ""; 
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div'); 
            if(m.senderId === "system") {
                div.style = "text-align:center; font-size:11px; color:#71717a; margin: 10px 0;";
                div.innerHTML = `<i>${m.content}</i>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const t = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
                div.innerHTML = `<div class="msg-meta">${m.senderName} • ${t}</div><div class="bubble">${m.content}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;

        if (activeChatId === id) {
            lastReadMap[id] = Date.now();
            localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
            loadChannels(); 
        }
    });
}

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;

    lastReadMap[activeChatId] = Date.now() + 5000;
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
    loadChannels();
};

document.getElementById('btn-signin').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try { await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p); } catch(e) { }
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, admin: false, verified: false, lastSeen: serverTimestamp() });
    } catch(e) { }
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
