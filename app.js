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
let msgUnsub = null, memberUnsub = null, channelUnsub = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) { signOut(auth); return; }
        currentUser = { id: user.uid, ...userSnap.data() };
        
        document.getElementById('my-name').innerText = currentUser.username;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // Heartbeat for "Online" status
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 30000);
        
        await autoJoinAnnouncements();
        loadChannels();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- HELPER: LINKIFY ---
function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" style="color: #3b82f6; text-decoration: underline;">${url}</a>`);
}

// --- SIDEBAR LOGIC ---
function loadChannels() {
    if (channelUnsub) channelUnsub();
    if (!currentUser) return;

    // Admins see all, Users see joined
    const q = currentUser.admin
        ? query(collection(db, "conversations"))
        : query(collection(db, "conversations"), where("members", "array-contains", currentUser.id));
    
    channelUnsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        const docs = [];
        snap.forEach(d => docs.push({id: d.id, ...d.data()}));
        // Sort by last activity
        docs.sort((a, b) => (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0));

        list.innerHTML = ""; 
        docs.forEach(data => {
            const isSelected = activeChatId === data.id;
            const isUnread = !isSelected && (data.lastUpdated?.toMillis() || 0) > (lastReadMap[data.id] || 0);

            const btn = document.createElement('div');
            btn.className = `channel-btn ${isSelected ? 'active' : ''}`;
            
            // Unread Red Dot
            const dot = isUnread ? `<span style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-right:8px; box-shadow:0 0 5px #ef4444;"></span>` : "";
            
            btn.innerHTML = `${dot}# ${data.name}`;
            btn.onclick = () => openChat(data.id, data.name);
            list.appendChild(btn);
        });
    });
}

// --- MAIN CHAT LOGIC ---
function openChat(id, name) {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    
    activeChatId = id;
    // Mark as read
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    loadChannels(); // Refresh sidebar to remove red dot

    // 1. Setup Header
    const titleArea = document.getElementById('chat-title');
    titleArea.innerHTML = `<span style="font-weight:bold;"># ${name}</span> <span id="member-count" style="font-size:12px; color:#71717a; margin-left:10px;"></span>`;
    
    // Admin Clear Button
    if (currentUser.admin) {
        const clearBtn = document.createElement('button');
        clearBtn.innerText = "Clear Chat";
        clearBtn.className = "btn-admin-action"; // You can add CSS or use inline styles below
        clearBtn.style = "font-size: 10px; margin-left: 15px; padding: 2px 8px; color: #ef4444; border: 1px solid #ef4444; background: transparent; cursor: pointer; border-radius: 4px;";
        
        clearBtn.onclick = async () => {
            if (confirm("WARNING: This will delete ALL messages for everyone.")) {
                const msgs = await getDocs(collection(db, "conversations", id, "messages"));
                const batch = writeBatch(db);
                msgs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                
                await addDoc(collection(db, "conversations", id, "messages"), {
                    content: `⚠️ Admin ${currentUser.username} cleared the chat history.`,
                    senderId: "system", senderName: "System", timestamp: serverTimestamp()
                });
                await updateDoc(doc(db, "conversations", id), { lastUpdated: serverTimestamp() });
            }
        };
        titleArea.appendChild(clearBtn);
    }

    // 2. Setup Input Area permissions
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';
    
    // 3. Setup Leave Button
    const leaveBtn = document.getElementById('btn-leave-chat');
    if (leaveBtn) {
        leaveBtn.style.display = (name === 'announcements' || currentUser.admin) ? 'none' : 'block';
        leaveBtn.onclick = async () => {
            if (confirm(`Leave #${name}?`)) {
                await addDoc(collection(db, "conversations", id, "messages"), {
                    content: `👋 ${currentUser.username} left the group.`,
                    senderId: "system", senderName: "System", timestamp: serverTimestamp()
                });
                await updateDoc(doc(db, "conversations", id), { 
                    members: arrayRemove(currentUser.id),
                    lastUpdated: serverTimestamp()
                });
                closeCurrentChat();
            }
        };
    }

    // 4. Setup Sidebar (Members + Add)
    const sidebar = document.getElementById('sidebar-right');
    sidebar.innerHTML = `
        <div class="header">MEMBERS</div>
        <div id="member-list" class="scroll-area"></div>
        <div id="static-add-ui" style="padding:15px; border-top:var(--border);">
            <input type="text" id="target-name" class="input-box" placeholder="Username" style="font-size:11px; margin-bottom:5px;">
            <button id="btn-add-member" class="btn btn-primary" style="font-size:11px; padding:6px; width:100%;">Add Member</button>
            <div id="add-err" style="color:#ef4444; font-size:10px; margin-top:5px;"></div>
        </div>
    `;

    if(name === 'announcements' && !currentUser.admin) document.getElementById('static-add-ui').style.display = 'none';

    // Add Member Logic (Case Insensitive)
    document.getElementById('btn-add-member').onclick = async () => {
        const input = document.getElementById('target-name');
        const val = input.value.trim().toLowerCase();
        const errDiv = document.getElementById('add-err');
        
        if(!val) return;
        errDiv.innerText = "";

        const qU = query(collection(db, "users"), where("username", "==", val), limit(1));
        const sU = await getDocs(qU);
        
        if(!sU.empty) {
            const foundUserId = sU.docs[0].id;
            const foundUserName = sU.docs[0].data().username;
            
            // Check if already in group (optional optimization, but firestore handles arrayUnion safely)
            await updateDoc(doc(db, "conversations", id), { 
                members: arrayUnion(foundUserId), 
                lastUpdated: serverTimestamp() 
            });
            await addDoc(collection(db, "conversations", id, "messages"), {
                content: `👋 ${currentUser.username} added ${foundUserName}`, 
                senderId: "system", senderName: "System", timestamp: serverTimestamp()
            });
            input.value = "";
        } else {
            errDiv.innerText = "User not found";
        }
    };

    // 5. Member Listener (Real-time List + KICK Logic)
    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const data = docSnap.data();
        if (!data || !activeChatId || !currentUser) return;

        // Security: Kick if not member and not admin
        if (!currentUser.admin && data.members && !data.members.includes(currentUser.id)) {
            closeCurrentChat();
            return;
        }

        // Update Member Count
        const countSpan = document.getElementById('member-count');
        if(countSpan) countSpan.innerText = `(${data.members?.length || 0} online)`;

        // Render List
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
                d.style.display = "flex";
                d.style.justifyContent = "space-between";
                d.style.alignItems = "center";
                
                // Name & Status
                const infoSpan = document.createElement('span');
                infoSpan.innerHTML = `<div class="status-dot ${isOnline ? 'online' : ''}"></div><b>${u.username}</b>`;
                d.appendChild(infoSpan);

                // Admin Kick Button (Don't kick self)
                if (currentUser.admin && uid !== currentUser.id) {
                    const kickBtn = document.createElement('span');
                    kickBtn.innerHTML = "&times;";
                    kickBtn.title = "Remove User";
                    kickBtn.style = "color:#ef4444; cursor:pointer; font-weight:bold; font-size:16px; padding:0 5px;";
                    
                    kickBtn.onclick = async () => {
                        if(confirm(`Remove ${u.username} from this group?`)) {
                            await updateDoc(doc(db, "conversations", id), { 
                                members: arrayRemove(uid),
                                lastUpdated: serverTimestamp() 
                            });
                            await addDoc(collection(db, "conversations", id, "messages"), {
                                content: `🚫 Admin removed ${u.username} from the group.`,
                                senderId: "system", senderName: "System", timestamp: serverTimestamp()
                            });
                        }
                    };
                    d.appendChild(kickBtn);
                }

                fragment.appendChild(d);
            }
        }
        if(listDiv) { listDiv.innerHTML = ""; listDiv.appendChild(fragment); }
    });

    // 6. Message Listener (Display + Delete + System Msgs)
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); 
        box.innerHTML = ""; 
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div'); 
            
            // System Message Styling
            if(m.senderId === "system") {
                div.style = "text-align:center; font-size:11px; color:#71717a; margin: 15px 0; border-top: 1px solid #27272a; border-bottom: 1px solid #27272a; padding: 5px;";
                div.innerHTML = `<i>${m.content}</i>`;
            } else {
                // User Message Styling
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const t = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
                
                // Delete Button for Admins
                const delBtn = currentUser.admin ? `<span class="del-msg" style="cursor:pointer; color:#ef4444; margin-left:8px; font-weight:bold;" title="Delete Message">&times;</span>` : "";
                
                div.innerHTML = `
                    <div class="msg-meta">${m.senderName} • ${t} ${delBtn}</div>
                    <div class="bubble">${linkify(m.content)}</div>
                `;
                
                if(currentUser.admin) {
                    div.querySelector('.del-msg').onclick = async () => {
                        if(confirm("Delete this message?")) {
                            await deleteDoc(doc(db, "conversations", id, "messages", d.id));
                            // Notify chat
                            await addDoc(collection(db, "conversations", id, "messages"), {
                                content: `🗑️ Admin deleted a message from ${m.senderName}`,
                                senderId: "system", senderName: "System", timestamp: serverTimestamp()
                            });
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
    const sidebarRight = document.getElementById('sidebar-right');
    if (sidebarRight) sidebarRight.innerHTML = "";
    loadChannels();
}

// --- GLOBAL BUTTONS ---

document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, senderId: currentUser.id, senderName: currentUser.username, timestamp: serverTimestamp()
    });
    // Updating lastUpdated triggers the red dot for others
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

document.getElementById('btn-signin').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    try { await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p); } catch(e) { alert("Login failed"); }
};

document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    // Strict username: a-z 0-9 only
    const validUser = /^[a-z0-9]+$/.test(u); 
    if (!validUser || u.length < 3) { alert("Usernames must be lowercase letters/numbers only (3+ chars)"); return; }
    
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, admin: false, lastSeen: serverTimestamp() });
    } catch(e) { alert("Registration failed (User might exist)."); }
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
