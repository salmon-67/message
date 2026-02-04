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

let userObj = null;
let activeId = null;
let isReg = false;
let unsubMsg = null;

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (u) => {
    if (u) {
        const snap = await getDoc(doc(db, "users", u.uid));
        userObj = { id: u.uid, ...snap.data() };
        document.getElementById('display-name').innerText = userObj.username;
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('app-layout').style.display = 'flex';
        syncSidebar();
    } else {
        document.getElementById('login-overlay').classList.remove('hidden');
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR ---
function syncSidebar() {
    const q = userObj.admin 
        ? query(collection(db, "conversations"), orderBy("name"))
        : query(collection(db, "conversations"), where("members", "array-contains", userObj.id));

    onSnapshot(q, (snap) => {
        const box = document.getElementById('channel-list');
        box.innerHTML = "";
        snap.forEach(d => {
            const div = document.createElement('div');
            div.className = `channel-btn ${activeId === d.id ? 'active' : ''}`;
            div.innerText = "# " + d.data().name;
            div.onclick = () => openChat(d.id, d.data().name);
            box.appendChild(div);
        });
    });
}

// --- CHAT SYSTEM & ANNOUNCEMENTS LOCK ---
async function openChat(id, name) {
    if (unsubMsg) unsubMsg();
    activeId = id;
    document.getElementById('chat-title').innerText = "# " + name;

    const isAnn = name.toLowerCase().includes("announcements");
    const isAdmin = userObj.admin === true;

    // Permissions logic
    document.getElementById('input-area').classList.toggle('hidden', isAnn && !isAdmin);
    document.getElementById('chat-actions').classList.remove('hidden');
    document.getElementById('open-search').classList.toggle('hidden', isAnn);
    document.getElementById('btn-leave').classList.toggle('hidden', isAnn);

    unsubMsg = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp")), (snap) => {
        const box = document.getElementById('messages-box');
        box.innerHTML = "";
        snap.forEach(d => {
            const m = d.data();
            const isMe = m.uid === userObj.id;
            const div = document.createElement('div');
            div.className = `msg ${isMe ? 'me' : 'them'}`;
            div.innerHTML = `<div><strong>${m.name}:</strong> ${m.text}</div>`;
            if (isAdmin) {
                const del = document.createElement('span');
                del.className = 'delete-btn'; del.innerText = ' [Delete]';
                del.onclick = () => deleteDoc(doc(db, "conversations", id, "messages", d.id));
                div.appendChild(del);
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}

// --- ADD MEMBER SEARCH (FIXED) ---
const searchInp = document.getElementById('search-input');
const resBox = document.getElementById('results');

searchInp.oninput = async (e) => {
    const term = e.target.value.trim().toLowerCase();
    resBox.innerHTML = "";
    if (term.length < 2) return;

    const q = query(collection(db, "users"), where("username_lower", ">=", term), where("username_lower", "<=", term + '\uf8ff'), limit(5));
    const snap = await getDocs(q);

    snap.forEach(uDoc => {
        if (uDoc.id === userObj.id) return;
        const u = uDoc.data();
        const item = document.createElement('div');
        item.className = 'result-item';
        // Using data attributes for stability
        item.innerHTML = `
            <span>${u.username}</span>
            <button class="btn btn-primary add-member-trigger" data-uid="${uDoc.id}">ADD</button>
        `;
        resBox.appendChild(item);
    });
};

// Handle the "Add" button click via Event Delegation
resBox.onclick = async (e) => {
    if (e.target.classList.contains('add-member-trigger')) {
        const targetUid = e.target.getAttribute('data-uid');
        await updateDoc(doc(db, "conversations", activeId), { 
            members: arrayUnion(targetUid) 
        });
        alert("User Added!");
        document.getElementById('search-modal').classList.add('hidden');
    }
};

// --- GENERAL UI HANDLERS ---
document.getElementById('btn-send').onclick = async () => {
    const inp = document.getElementById('msg-input');
    if (!inp.value.trim()) return;
    await addDoc(collection(db, "conversations", activeId, "messages"), {
        text: inp.value, uid: userObj.id, name: userObj.username, timestamp: serverTimestamp()
    });
    inp.value = "";
};

document.getElementById('btn-auth').onclick = async () => {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value;
    const email = `${u.toLowerCase()}@salmon.chat`;
    if (isReg) {
        const res = await createUserWithEmailAndPassword(auth, email, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, username_lower: u.toLowerCase(), admin: false });
    } else {
        await signInWithEmailAndPassword(auth, email, p);
    }
};

document.getElementById('open-search').onclick = () => document.getElementById('search-modal').classList.remove('hidden');
document.getElementById('close-search').onclick = () => document.getElementById('search-modal').classList.add('hidden');
document.getElementById('toggle-auth').onclick = () => {
    isReg = !isReg;
    document.getElementById('btn-auth').innerText = isReg ? "Register" : "Enter Chat";
};

document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (!n) return;
    await addDoc(collection(db, "conversations"), { name: n, members: [userObj.id] });
    document.getElementById('new-channel-name').value = "";
};

document.getElementById('btn-logout').onclick = () => signOut(auth);
document.getElementById('btn-leave').onclick = async () => {
    await updateDoc(doc(db, "conversations", activeId), { members: arrayRemove(userObj.id) });
    location.reload();
};
