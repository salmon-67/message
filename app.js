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

let currentUser = null;
let activeChatId = null;
let isAddingMode = "channel";
let isRegisterMode = false;
let msgUnsub = null, memberUnsub = null;

// --- AUTH HANDLERS ---
const authBtn = document.getElementById('btn-auth-main');
const authToggle = document.getElementById('btn-auth-toggle');

authToggle.onclick = () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-status').innerText = isRegisterMode ? "Create Account" : "Sign In";
    authBtn.innerText = isRegisterMode ? "Register" : "Sign In";
    authToggle.innerText = isRegisterMode ? "Already have an account? Sign In" : "No account? Register";
};

authBtn.onclick = async () => {
    const user = document.getElementById('login-user').value.trim().toLowerCase();
    const pass = document.getElementById('login-pass').value;
    if (!user || pass.length < 6) return alert("Username required & Password min 6 chars");
    const email = `${user}@salmon.chat`;

    try {
        if (isRegisterMode) {
            const res = await createUserWithEmailAndPassword(auth, email, pass);
            await setDoc(doc(db, "users", res.user.uid), { username: user, username_lower: user, admin: false, vip: false });
        } else {
            await signInWithEmailAndPassword(auth, email, pass);
        }
    } catch (e) { alert(e.message); }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        
        // UI Setup
        const rankIcon = currentUser.admin ? " 🛠️" : (currentUser.vip ? " ✨" : "");
        document.getElementById('my-name').innerText = currentUser.username + rankIcon;
        document.getElementById('btn-admin-dash').style.display = currentUser.admin ? 'block' : 'none';
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR & CHAT ---
function syncSidebar() {
    const q = currentUser.admin 
        ? query(collection(db, "conversations"), orderBy("lastUpdated", "desc"))
        : query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));

    onSnapshot(q, (snap) => {
        const cList = document.getElementById('channel-list'), dList = document.getElementById('dm-list');
        cList.innerHTML = ""; dList.innerHTML = "";
        snap.forEach(async d => {
            const data = d.data(), id = d.id;
            const btn = document.createElement('div');
            btn.className = `channel-btn ${activeChatId === id ? 'active' : ''}`;
            if (data.type === 'dm') {
                const other = data.members.find(uid => uid !== currentUser.id) || data.members[0];
                const uSnap = await getDoc(doc(db, "users", other));
                btn.innerText = "@ " + (uSnap.data()?.username || "Private DM");
                btn.onclick = () => openChat(id, uSnap.data()?.username, true);
                dList.appendChild(btn);
            } else {
                btn.innerText = "# " + data.name;
                btn.onclick = () => openChat(id, data.name, false);
                cList.appendChild(btn);
            }
        });
    });
}

async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub(); if (memberUnsub) memberUnsub();
    activeChatId = id;

    const isAnnounce = name?.toLowerCase().includes("announcement");
    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('btn-delete-channel').style.display = currentUser.admin ? 'block' : 'none';
    document.getElementById('btn-leave-room').style.display = (isDM || isAnnounce) ? 'none' : 'block';
    document.getElementById('header-add-user').style.display = (isDM || isAnnounce) ? 'none' : 'block';

    // Shadow Join Logic
    const roomRef = doc(db, "conversations", id);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.data().members.includes(currentUser.id)) {
        await updateDoc(roomRef, { members: arrayUnion(currentUser.id) });
        if (!currentUser.admin) {
            await addDoc(collection(db, "conversations", id, "messages"), { content: `${currentUser.username} joined.`, senderId: "system", timestamp: serverTimestamp() });
        }
    }

    memberUnsub = onSnapshot(roomRef, (snap) => {
        const list = document.getElementById('member-list'); list.innerHTML = "";
        (snap.data()?.members || []).forEach(async uid => {
            const u = (await getDoc(doc(db, "users", uid))).data();
            const div = document.createElement('div'); div.className = "member-item";
            const badge = u?.admin ? "🛠️" : (u?.vip ? "✨" : "");
            div.innerHTML = `<span>${badge} ${u?.username}</span>${currentUser.admin && uid !== currentUser.id ? `<button onclick="kickUser('${uid}')" style="color:var(--danger); background:none; border:none; cursor:pointer;">Kick</button>` : ''}`;
            list.appendChild(div);
        });
    });

    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), async (snap) => {
        const box = document.getElementById('messages-box'); box.innerHTML = "";
        for (const d of snap.docs) {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                const s = (await getDoc(doc(db, "users", m.senderId))).data();
                const badge = s?.admin ? "🛠️ " : (s?.vip ? "✨ " : "");
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const del = currentUser.admin ? `<span onclick="deleteMsg('${d.id}')" style="color:red; cursor:pointer; margin-left:8px;">×</span>` : "";
                div.innerHTML = `<div style="font-size:10px; color:var(--text-dim); margin-bottom:2px;">${badge}${s?.username}</div><div class="bubble">${m.content}${del}</div>`;
            }
            box.appendChild(div);
        }
        box.scrollTop = box.scrollHeight;
    });
}

// --- ADMIN DASHBOARD LOGIC ---
window.updateRank = async (uid, rank) => {
    const r = doc(db, "users", uid);
    if (rank === 'admin') await updateDoc(r, { admin: true, vip: false });
    else if (rank === 'vip') await updateDoc(r, { admin: false, vip: true });
    else await updateDoc(r, { admin: false, vip: false });
    alert("Rank updated!");
};

document.getElementById('admin-search-users').oninput = async (e) => {
    const val = e.target.value.toLowerCase();
    if (val.length < 2) return;
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(10)));
    const res = document.getElementById('admin-user-results'); res.innerHTML = "";
    snap.forEach(d => {
        const u = d.data();
        const div = document.createElement('div');
        div.style = "background:var(--bg-input); padding:10px; border-radius:10px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;";
        div.innerHTML = `<span>${u.username}</span><div>
            <button class="btn" style="width:auto; padding:5px; font-size:10px; background:var(--admin-purple);" onclick="updateRank('${d.id}', 'admin')">Admin</button>
            <button class="btn" style="width:auto; padding:5px; font-size:10px; background:orange;" onclick="updateRank('${d.id}', 'vip')">VIP</button>
            <button class="btn" style="width:auto; padding:5px; font-size:10px; background:gray;" onclick="updateRank('${d.id}', 'member')">Member</button>
        </div>`;
        res.appendChild(div);
    });
};

// --- GLOBAL ACTIONS ---
window.kickUser = async (uid) => { await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(uid) }); };
window.deleteMsg = async (mid) => { await deleteDoc(doc(db, "conversations", activeChatId, "messages", mid)); };

document.getElementById('btn-send').onclick = async () => {
    const v = document.getElementById('msg-input').value.trim(); if (!v) return;
    document.getElementById('msg-input').value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), { content: v, senderId: currentUser.id, timestamp: serverTimestamp() });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};

document.getElementById('btn-delete-channel').onclick = async () => {
    if (!confirm("Delete this room?")) return;
    const batch = writeBatch(db);
    const msgs = await getDocs(collection(db, "conversations", activeChatId, "messages"));
    msgs.forEach(m => batch.delete(m.ref));
    batch.delete(doc(db, "conversations", activeChatId));
    await batch.commit();
    location.reload();
};

const sInp = document.getElementById('search-user-input');
sInp.oninput = async () => {
    const v = sInp.value.toLowerCase(); if (v.length < 2) return;
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", v), where("username_lower", "<=", v + '\uf8ff'), limit(5)));
    const res = document.getElementById('search-results'); res.innerHTML = "";
    snap.forEach(d => {
        const div = document.createElement('div'); div.className = "search-item";
        div.innerHTML = `<span>${d.data().username}</span> <span>+</span>`;
        div.onclick = async () => {
            if (isAddingMode === "channel") await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
            else {
                const dmId = [currentUser.id, d.id].sort().join("_dm_");
                await setDoc(doc(db, "conversations", dmId), { type: "dm", members: [currentUser.id, d.id], lastUpdated: serverTimestamp() });
            }
            document.getElementById('search-modal').style.display = "none";
        };
        res.appendChild(div);
    });
};

document.getElementById('header-add-user').onclick = () => { isAddingMode="channel"; document.getElementById('search-modal').style.display="flex"; };
document.getElementById('open-dm-search').onclick = () => { isAddingMode="dm"; document.getElementById('search-modal').style.display="flex"; };
document.getElementById('close-search').onclick = () => document.getElementById('search-modal').style.display="none";
document.getElementById('btn-logout').onclick = () => signOut(auth);
document.getElementById('close-admin').onclick = () => document.getElementById('admin-overlay').style.display = 'none';
document.getElementById('btn-admin-dash').onclick = () => document.getElementById('admin-overlay').style.display = 'flex';
