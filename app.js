import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
let msgUnsub = null;
let memberUnsub = null;

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const name = user.email.split('@')[0];
        document.getElementById('user-display-name').innerText = name;
        document.getElementById('user-badge').innerText = name[0].toUpperCase();
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        autoLoadChannels();
    } else {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('app-container').style.display = 'none';
    }
});

document.getElementById('btn-login').onclick = () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    if (!u || !p) return;
    signInWithEmailAndPassword(auth, `${u}@salmon.com`, p).catch(() => alert("Login failed"));
};

document.getElementById('btn-signup').onclick = async () => {
    const u = document.getElementById('username').value.trim().toLowerCase();
    const p = document.getElementById('password').value;
    if (!u || p.length < 6) return alert("Username required & Password min 6 characters");
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "usernames", u), { uid: res.user.uid });
        await setDoc(doc(db, "users", res.user.uid), { username: u });
    } catch (e) { alert("Signup error"); }
};

// --- SIDEBAR: AUTO-LOAD & SORTED ---
function autoLoadChannels() {
    const q = query(collection(db, "conversations"), where("members", "array-contains", currentUser.uid), orderBy("lastUpdated", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('chat-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const data = d.data();
            const lastRead = data.readStatus?.[currentUser.uid] || 0;
            const lastUpdated = data.lastUpdated?.toMillis() || 0;
            const isUnread = lastUpdated > lastRead && activeChatId !== d.id;
            
            const item = document.createElement('div');
            item.className = `channel-item ${activeChatId === d.id ? 'active' : ''}`;
            item.innerHTML = `
                <div style="font-weight:600; color:${isUnread ? 'var(--discord-red)' : 'inherit'};">
                    # ${data.name} ${isUnread ? '<span class="unread-dot"></span>' : ''}
                </div>
                <div style="font-size:11px; opacity:0.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${data.lastMsg || "No messages yet"}
                </div>
            `;
            item.onclick = () => openChat(d.id, data.name);
            list.appendChild(item);
        });
    });
}

// --- MAIN CHAT: MESSAGES & DATE DIVIDERS ---
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    if (memberUnsub) memberUnsub();
    activeChatId = id;
    
    await updateDoc(doc(db, "conversations", id), { [`readStatus.${currentUser.uid}`]: Date.now() });

    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('btn-leave-chat').style.display = 'block';
    document.getElementById('chat-title').innerText = `# ${name}`;

    const qMsg = query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc"));
    msgUnsub = onSnapshot(qMsg, (snap) => {
        const box = document.getElementById('messages');
        box.innerHTML = "";
        let lastDateString = null;

        snap.forEach(d => {
            const m = d.data();
            if (!m.timestamp) return;
            const date = m.timestamp.toDate();
            const dateString = date.toLocaleDateString();

            // Date Divider
            if (dateString !== lastDateString) {
                const divDate = document.createElement('div');
                divDate.className = 'date-divider';
                const today = new Date().toLocaleDateString();
                if (dateString === today) divDate.innerText = "Today";
                else divDate.innerText = date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
                box.appendChild(divDate);
                lastDateString = dateString;
            }

            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const div = document.createElement('div');
            div.className = 'msg-container';
            div.innerHTML = `
                <div><span class="msg-sender">${m.senderName}</span><span class="msg-time">${timeStr}</span></div>
                <span class="msg-content">${m.content}</span>
            `;
            box.appendChild(div);
        });
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    });

    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const list = document.getElementById('member-list');
        list.innerHTML = "";
        const ids = docSnap.data()?.members || [];
        for (const uid of ids) {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
                const div = document.createElement('div');
                div.style = "padding:4px 0; font-size:13px; display:flex; align-items:center; gap:8px;";
                div.innerHTML = `<div style="width:6px; height:6px; background:var(--discord-green); border-radius:50%"></div> ${userSnap.data().username}`;
                list.appendChild(div);
            }
        }
    });
}

// --- ACTIONS ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !activeChatId) return;
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content, senderId: currentUser.uid, senderName: currentUser.email.split('@')[0], timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), {
        lastUpdated: serverTimestamp(), lastMsg: content, [`readStatus.${currentUser.uid}`]: Date.now()
    });
    input.value = "";
};

document.getElementById('btn-create-channel').onclick = async () => {
    const n = document.getElementById('group-name').value.trim();
    if (n) {
        await addDoc(collection(db, "conversations"), { 
            name: n, members: [currentUser.uid], lastUpdated: serverTimestamp(), lastMsg: "Channel created" 
        });
        document.getElementById('group-name').value = "";
    }
};

document.getElementById('btn-add-user').onclick = async () => {
    const name = document.getElementById('add-user-input').value.toLowerCase().trim();
    if (!name || !activeChatId) return;
    const snap = await getDoc(doc(db, "usernames", name));
    if (snap.exists()) {
        await updateDoc(doc(db, "conversations", activeChatId), { members: arrayUnion(snap.data().uid) });
        document.getElementById('add-user-input').value = "";
    } else { alert("User not found"); }
};

document.getElementById('btn-logout').onclick = () => signOut(auth).then(() => location.reload());
document.getElementById('btn-toggle-menu').onclick = () => document.getElementById('sidebar-left').classList.toggle('open');
document.getElementById('msg-input').onkeypress = (e) => { if(e.key==='Enter') document.getElementById('btn-send').click(); };
