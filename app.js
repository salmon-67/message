import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove, where, limit, getDocs, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"; // Standard imports

// ... (Keep your firebaseConfig and app/auth/db initialization here)

let currentUser = null;
let activeChatId = null;
let isAddingMode = "channel"; 
let msgUnsub = null, memberUnsub = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        currentUser = { id: user.uid, ...snap.data() };
        document.getElementById('my-name').innerText = currentUser.username + (currentUser.admin ? " 🛠️" : "");
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR: ADMINS SEE EVERYTHING ---
async function syncSidebar() {
    // If admin, query ALL. If user, query where they are a member.
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
                // Find the other user (or show both if admin is spying)
                const otherId = data.members.find(uid => uid !== currentUser.id) || data.members[0];
                const uSnap = await getDoc(doc(db, "users", otherId));
                btn.innerText = "@ " + (uSnap.data()?.username || "Private DM");
                btn.onclick = () => openChat(id, uSnap.data()?.username || "DM", true);
                dList.appendChild(btn);
            } else {
                btn.innerText = "# " + data.name;
                btn.onclick = () => openChat(id, data.name, false);
                cList.appendChild(btn);
            }
        });
    });
}

// --- OPEN CHAT & MEMBER ACTIONS ---
async function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id;

    const isAnnounce = name.toLowerCase().includes("announcement");
    document.getElementById('chat-title').innerText = (isDM ? "@ " : "# ") + name;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-actions').style.display = 'flex';
    document.getElementById('header-add-user').style.display = (isDM || isAnnounce) ? 'none' : 'block';
    document.getElementById('btn-delete-channel').style.display = currentUser.admin ? 'block' : 'none';
    document.getElementById('btn-leave-room').style.display = isDM ? 'none' : 'block';

    // Member List Sync
    memberUnsub = onSnapshot(doc(db, "conversations", id), (snap) => {
        const mList = document.getElementById('member-list');
        mList.innerHTML = "";
        const members = snap.data()?.members || [];
        
        members.forEach(async (uid) => {
            const uSnap = await getDoc(doc(db, "users", uid));
            const uData = uSnap.data();
            const div = document.createElement('div');
            div.className = "member-item";
            div.innerHTML = `
                <span>${uData?.username || "User"}</span>
                ${currentUser.admin && uid !== currentUser.id ? `<button class="btn-danger" onclick="kickUser('${uid}')">Kick</button>` : ''}
            `;
            mList.appendChild(div);
        });
    });

    // Message Sync
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div');
            if (m.senderId === "system") {
                div.className = "system-msg"; div.innerHTML = `<span>${m.content}</span>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const delBtn = currentUser.admin ? `<span onclick="deleteMsg('${d.id}')" style="cursor:pointer; color:red; margin-left:8px;">×</span>` : "";
                div.innerHTML = `<div class="bubble">${m.content}${delBtn}</div>`;
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- SEARCH & ACTIONS ---
window.kickUser = async (uid) => {
    if (confirm("Kick this user?")) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(uid) });
        await addDoc(collection(db, "conversations", activeChatId, "messages"), {
            content: `User was kicked by admin.`, senderId: "system", timestamp: serverTimestamp()
        });
    }
};

document.getElementById('btn-leave-room').onclick = async () => {
    if (confirm("Leave this room?")) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayRemove(currentUser.id) });
        activeChatId = null;
        location.reload(); 
    }
};

// Fixed Search Logic
const searchInput = document.getElementById('search-user-input');
searchInput.oninput = async () => {
    const val = searchInput.value.toLowerCase();
    if (val.length < 2) return;
    const snap = await getDocs(query(collection(db, "users"), where("username_lower", ">=", val), where("username_lower", "<=", val + '\uf8ff'), limit(5)));
    
    const results = document.getElementById('search-results');
    results.innerHTML = "";
    snap.forEach(d => {
        const u = d.data();
        const div = document.createElement('div');
        div.className = "search-item";
        div.innerHTML = `<span>${u.username}</span>`;
        div.onclick = async () => {
            if (isAddingMode === "channel") {
                await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(d.id) });
            } else {
                const dmId = [currentUser.id, d.id].sort().join("_dm_");
                await setDoc(doc(db, "conversations", dmId), { type: "dm", members: [currentUser.id, d.id], lastUpdated: serverTimestamp() });
            }
            document.getElementById('search-modal').style.display = "none";
        };
        results.appendChild(div);
    });
};

document.getElementById('header-add-user').onclick = () => { isAddingMode = "channel"; document.getElementById('search-modal').style.display = "flex"; };
document.getElementById('open-dm-search').onclick = () => { isAddingMode = "dm"; document.getElementById('search-modal').style.display = "flex"; };
document.getElementById('close-search').onclick = () => { document.getElementById('search-modal').style.display = "none"; };
