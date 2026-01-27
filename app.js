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
        if(channelUnsub) channelUnsub();
    }
});

function loadChannels() {
    if (channelUnsub) channelUnsub();
    channelUnsub = onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.id)), (snap) => {
        const list = document.getElementById('channel-list');
        list.innerHTML = ""; 
        snap.forEach(d => {
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === d.id ? 'active' : ''}`;
            btn.innerText = `# ${d.data().name}`;
            btn.onclick = () => openChat(d.id, d.data().name);
            list.appendChild(btn);
        });
    });
}

function openChat(id, name) {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    activeChatId = id;
    document.getElementById('chat-title').innerText = `# ${name}`;
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';

    const leaveBtn = document.getElementById('btn-leave-chat');
    leaveBtn.style.display = (name === 'announcements') ? 'none' : 'block';
    leaveBtn.onclick = async () => {
        if(confirm("Leave group?")) {
            await updateDoc(doc(db, "conversations", id), { members: arrayRemove(currentUser.id) });
            activeChatId = null;
            document.getElementById('messages-box').innerHTML = "";
            document.getElementById('chat-title').innerText = "# Select Channel";
            leaveBtn.style.display = "none";
        }
    };

    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const list = document.getElementById('member-list');
        list.innerHTML = ""; // FIX: Wipes duplicates before rebuilding
        
        const mIds = docSnap.data()?.members || [];
        for (let uid of mIds) {
            const uDoc = await getDoc(doc(db, "users", uid));
            if (uDoc.exists()) {
                const u = uDoc.data();
                const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 120000);
                const d = document.createElement('div');
                d.className = "member-item";
                d.innerHTML = `
                    <div class="status-dot ${isOnline ? 'online' : ''}"></div>
                    <div style="flex:1; cursor:pointer;" onclick="navigator.clipboard.writeText('${u.username}'); alert('Copied: ${u.username}')">
                        <b>${u.username}</b> ${u.verified ? "✅" : ""}
                    </div>`;
                list.appendChild(d);
            }
        }

        if (name !== 'announcements' && currentUser.admin === true) {
            const addUI = document.createElement('div');
            addUI.style = "margin-top:15px; border-top: 1px solid #333; padding-top:10px;";
            addUI.innerHTML = `
                <input type="text" id="target-name" class="input-box" placeholder="Username" style="font-size:11px;">
                <button id="btn-add-member" class="btn btn-primary" style="font-size:11px; padding:6px;">Add Member</button>
                <div id="add-err" style="color:red; font-size:10px; margin-top:5px;"></div>`;
            list.appendChild(addUI);

            document.getElementById('btn-add-member').onclick = async () => {
                const nameIn = document.getElementById('target-name').value.trim();
                const err = document.getElementById('add-err');
                if (!nameIn) return;

                const qU = query(collection(db, "users"), where("username", "==", nameIn), limit(1));
                const snapU = await getDocs(qU);
                
                if (!snapU.empty) {
                    await updateDoc(doc(db, "conversations", id), { members: arrayUnion(snapU.docs[0].id) });
                    document.getElementById('target-name').value = "";
                    err.innerText = "";
                } else { err.innerText = "Not found"; }
            };
        }
    });

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); 
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div'); 
            div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
            const t = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
            div.innerHTML = `<div class="msg-meta">${m.senderName} • ${t}</div><div class="bubble">${m.content}</div>`;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
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
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try { await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p); } catch(e) { document.getElementById('login-error').innerText = "Login failed"; }
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, admin: false, verified: false, lastSeen: serverTimestamp() });
    } catch(e) { document.getElementById('login-error').innerText = "Register failed"; }
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
    else { await addDoc(collection(db, "conversations"), { name: "announcements", members: [currentUser.id], lastUpdated: serverTimestamp() }); }
}
