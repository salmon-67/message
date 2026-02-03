import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, where, limit, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let activeChatName = "";
let msgUnsub = null, sidebarUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- RANK EMOJIS ---
const getBadges = (u) => {
    let b = "";
    if (u.dev) b += '<i class="badge" title="Developer">💻</i>';
    if (u.admin) b += '<i class="badge" title="Admin">🛠️</i>';
    if (u.salmon) b += '<i class="badge" title="Salmon Staff">🐟</i>';
    if (u.verified) b += '<i class="badge" title="Verified">✅</i>';
    if (u.vip) b += '<i class="badge" title="VIP">💎</i>';
    return b;
};

// --- AUTH & GLOBAL AUTO-JOIN ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (localStorage.getItem('salmon_status') === 'device_banned') { location.reload(); return; }
        
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };

        if (currentUser.banned) {
            localStorage.setItem('salmon_status', 'device_banned');
            signOut(auth); return;
        }

        // AUTO-JOIN GLOBAL CHAT
        const globalQ = query(collection(db, "conversations"), where("name", "==", "everyone"), limit(1));
        const gSnap = await getDocs(globalQ);
        if (!gSnap.empty) {
            await updateDoc(doc(db, "conversations", gSnap.docs[0].id), { members: arrayUnion(currentUser.id) });
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username}${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 15000);
        syncSidebar();
        loadAllMembers(); // Show everyone in the list
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- LOAD ALL MEMBERS (FIXED) ---
function loadAllMembers() {
    onSnapshot(collection(db, "users"), (snap) => {
        const mList = document.getElementById('member-list');
        mList.innerHTML = "";
        snap.forEach(uDoc => {
            const u = uDoc.data();
            const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 45000);
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `
                <span><span class="status-dot ${isOnline?'online':''}"></span> ${u.username}${getBadges(u)}</span>
                ${currentUser.admin && uDoc.id !== currentUser.id ? `<button onclick="banUser('${uDoc.id}', '${u.username}')" style="color:red; background:none; border:none; cursor:pointer; font-size:10px;">BAN</button>` : ''}
            `;
            mList.appendChild(div);
        });
    });
}

// --- MESSAGE EDITING ---
window.editMsg = async (mid) => {
    const newText = prompt("Edit message:");
    if (newText && activeChatId) {
        await updateDoc(doc(db, "conversations", activeChatId, "messages", mid), {
            content: newText + " (edited)",
            edited: true
        });
    }
};

// --- CHAT LOGIC ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    activeChatId = id; activeChatName = name.toLowerCase();
    syncSidebar();

    const isAdmin = currentUser.admin;
    const isEveryone = name === "everyone";
    
    document.getElementById('chat-title').innerHTML = `
        <span>${isEveryone ? '🌍' : (isDM ? '@' : '#')} ${name}</span>
        ${isAdmin ? `<button onclick="clearChat('${id}')" style="margin-left:10px; color:red; background:none; border:1px solid red; border-radius:4px; font-size:10px; cursor:pointer;">Clear</button>` : ''}
    `;

    document.getElementById('input-area').style.display = (activeChatName === "announcements" && !isAdmin) ? 'none' : 'block';

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const editBtn = isAdmin ? `<button onclick="editMsg('${d.id}')" style="background:none; border:none; color:gray; cursor:pointer; font-size:9px;">[Edit]</button>` : "";
                div.innerHTML = `
                    <div class="msg-meta">${m.senderName}${getBadges(m.senderFlags || {})} ${editBtn}</div>
                    <div class="bubble">${m.content}</div>
                `;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- ADMIN ACTIONS ---
window.banUser = async (uid, name) => {
    if (confirm(`Device Ban ${name}?`)) await updateDoc(doc(db, "users", uid), { banned: true });
};

window.clearChat = async (cid) => {
    if (!confirm("Wipe all messages?")) return;
    const snap = await getDocs(collection(db, "conversations", cid, "messages"));
    const batch = writeBatch(db);
    snap.forEach(d => batch.delete(d.ref));
    await batch.commit();
};

// --- SIDEBAR & BUTTONS ---
function syncSidebar() {
    onSnapshot(query(collection(db, "conversations"), where("members", "array-contains", currentUser.id)), async (snap) => {
        const cDiv = document.getElementById('channel-list'), dDiv = document.getElementById('dm-list');
        cDiv.innerHTML = ""; dDiv.innerHTML = "";
        for (const docSnap of snap.docs) {
            const data = docSnap.data(), btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === docSnap.id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(u => u !== currentUser.id);
                const u = (await getDoc(doc(db, "users", other))).data();
                btn.innerHTML = `@ ${u?.username}`;
                btn.onclick = () => openChat(docSnap.id, u?.username, true);
                dDiv.appendChild(btn);
            } else {
                btn.innerHTML = `${data.name==='everyone'?'🌍 ':'# '}${data.name}`;
                btn.onclick = () => openChat(docSnap.id, data.name, false);
                cDiv.appendChild(btn);
            }
        }
    });
}

document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input'), txt = inp.value.trim();
    if (!txt || !activeChatId) return;
    inp.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: txt, senderId: currentUser.id, senderName: currentUser.username,
        senderFlags: { admin:!!currentUser.admin, dev:!!currentUser.dev, salmon:!!currentUser.salmon, verified:!!currentUser.verified },
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-signin').onclick = () => signInWithEmailAndPassword(auth, `${document.getElementById('login-user').value.toLowerCase()}@salmon.com`, document.getElementById('login-pass').value);
document.getElementById('btn-register').onclick = () => {
    const u = document.getElementById('login-user').value.toLowerCase(), p = document.getElementById('login-pass').value;
    createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p).then(r => setDoc(doc(db, "users", r.user.uid), { username: u, username_lower: u, admin:false }));
};
document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim().toLowerCase();
    if (n) await addDoc(collection(db, "conversations"), { name: n, members: [currentUser.id], lastUpdated: serverTimestamp() });
};
document.getElementById('btn-logout').onclick = () => signOut(auth);
