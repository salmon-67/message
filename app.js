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

// --- HELPER: GET BADGES STRING ---
function getBadges(user) {
    let badges = "";
    if (user.admin) badges += " 🛠️";
    if (user.salmon) badges += " 🐟";
    if (user.verified) badges += " 😎";
    return badges;
}

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) { signOut(auth); return; }
        
        currentUser = { id: user.uid, ...userSnap.data() };
        
        // Show badges next to my own name in the bottom left
        document.getElementById('my-name').innerText = `${currentUser.username} ${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 30000);
        
        await autoJoinAnnouncements();
        loadChannels();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" style="color: #3b82f6; text-decoration: underline;">${url}</a>`);
}

// --- SIDEBAR (CHANNELS) ---
function loadChannels() {
    if (channelUnsub) channelUnsub();
    if (!currentUser) return;

    const q = currentUser.admin
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
            btn.className = `channel-btn ${isSelected ? 'active' : ''}`;
            const dot = isUnread ? `<span style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-right:8px; box-shadow:0 0 5px #ef4444;"></span>` : "";
            
            btn.innerHTML = `${dot}# ${data.name}`;
            btn.onclick = () => openChat(data.id, data.name);
            list.appendChild(btn);
        });
    });
}

// --- MAIN CHAT ---
function openChat(id, name) {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    
    activeChatId = id;
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    loadChannels();

    const titleArea = document.getElementById('chat-title');
    titleArea.innerHTML = `<span style="font-weight:bold;"># ${name}</span> <span id="member-count" style="font-size:12px; color:#71717a; margin-left:10px;"></span>`;
    
    if (currentUser.admin) {
        const clearBtn = document.createElement('button');
        clearBtn.innerText = "Clear Chat";
        clearBtn.style = "font-size: 10px; margin-left: 15px; padding: 2px 8px; color: #ef4444; border: 1px solid #ef4444; background: transparent; cursor: pointer; border-radius: 4px;";
        clearBtn.onclick = async () => {
            if (confirm("WARNING: Delete ALL messages?")) {
                const msgs = await getDocs(collection(db, "conversations", id, "messages"));
                const batch = writeBatch(db);
                msgs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                
                await addDoc(collection(db, "conversations", id, "messages"), {
                    content: `⚠️ Admin ${currentUser.username} cleared chat history.`,
                    senderId: "system", senderName: "System", timestamp: serverTimestamp()
                });
                await updateDoc(doc(db, "conversations", id), { lastUpdated: serverTimestamp() });
            }
        };
        titleArea.appendChild(clearBtn);
    }

    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';
    
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

    document.getElementById('btn-add-member').onclick = async () => {
        const input = document.getElementById('target-name');
        const rawVal = input.value.trim();
        const lowerVal = rawVal.toLowerCase();
        const errDiv = document.getElementById('add-err');
        
        if(!rawVal) return;
        errDiv.innerText = "Searching...";

        const qU = query(collection(db, "users"), where("username", "in", [rawVal, lowerVal]), limit(1));
        const sU = await getDocs(qU);
        
        if(!sU.empty) {
            const foundUser = sU.docs[0];
            const foundUserId = foundUser.id;
            const foundUserName = foundUser.data().username;
            
            await updateDoc(doc(db, "conversations", id), { 
                members: arrayUnion(foundUserId), 
                lastUpdated: serverTimestamp() 
            });
            await addDoc(collection(db, "conversations", id, "messages"), {
                content: `👋 ${currentUser.username} added ${foundUserName}`, 
                senderId: "system", senderName: "System", timestamp: serverTimestamp()
            });
            
            input.value = "";
            errDiv.innerText = "";
        } else {
            errDiv.innerText = "User not found";
        }
    };

    // --- MEMBER LISTENER (WITH BADGES) ---
    memberUnsub = onSnapshot(doc(db, "conversations", id), async (docSnap) => {
        const data = docSnap.data();
        if (!data || !activeChatId || !currentUser) return;

        if (!currentUser.admin && data.members && !data.members.includes(currentUser.id)) {
            closeCurrentChat();
            return;
        }

        const countSpan = document.getElementById('member-count');
        if(countSpan) countSpan.innerText = `(${data.members?.length || 0} members)`;

        const listDiv = document.getElementById('member-list');
        const fragment = document.createDocumentFragment();
        const uniqueIds = [...new Set(data.members || [])];
        
        for (let uid of uniqueIds) {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
                const u = uSnap.data();
                const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 120000);
                
                // Get Badges for Sidebar
                const badgeString = getBadges(u);

                const d = document.createElement('div');
                d.className = "member-item";
                d.style.display = "flex";
                d.style.justifyContent = "space-between";
                d.style.alignItems = "center";
                
                const infoSpan = document.createElement('span');
                infoSpan.innerHTML = `<div class="status-dot ${isOnline ? 'online' : ''}"></div><b>${u.username}${badgeString}</b>`;
                d.appendChild(infoSpan);

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
                                content: `🚫 Admin removed ${u.username}.`,
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

    // --- MESSAGE LISTENER (WITH BADGES) ---
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); 
        box.innerHTML = ""; 
        snap.forEach(d => {
            const m = d.data();
            const div = document.createElement('div'); 
            
            if(m.senderId === "system") {
                div.style = "text-align:center; font-size:11px; color:#71717a; margin: 15px 0; border-top: 1px solid #27272a; border-bottom: 1px solid #27272a; padding: 5px;";
                div.innerHTML = `<i>${m.content}</i>`;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                const t = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "";
                const delBtn = currentUser.admin ? `<span class="del-msg" style="cursor:pointer; color:#ef4444; margin-left:8px; font-weight:bold;" title="Delete Message">&times;</span>` : "";
                
                // Get Badges from message data (for new messages) OR standard check
                // Note: Messages sent BEFORE this update won't have the badge flags stored, so they might look plain.
                let msgBadges = "";
                if(m.senderBadges) {
                     // If we stored badges string directly
                    msgBadges = m.senderBadges;
                } else if (m.senderFlags) {
                    // If we stored flags
                    msgBadges = getBadges(m.senderFlags);
                }

                div.innerHTML = `
                    <div class="msg-meta">${m.senderName}${msgBadges} • ${t} ${delBtn}</div>
                    <div class="bubble">${linkify(m.content)}</div>
                `;
                
                if(currentUser.admin) {
                    div.querySelector('.del-msg').onclick = async () => {
                        if(confirm("Delete this message?")) {
                            await deleteDoc(doc(db, "conversations", id, "messages", d.id));
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

// --- SEND MESSAGE (SAVES BADGES) ---
document.getElementById('btn-send').onclick = async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = "";
    
    // We save the badge status AT THE TIME OF SENDING
    // This allows badges to show up in the chat history correctly
    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, 
        senderId: currentUser.id, 
        senderName: currentUser.username, 
        senderFlags: {
            admin: currentUser.admin || false,
            salmon: currentUser.salmon || false,
            verified: currentUser.verified || false
        },
        timestamp: serverTimestamp()
    });
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
    const validUser = /^[a-z0-9]+$/.test(u); 
    if (!validUser || u.length < 3) { alert("Usernames must be 3+ characters (letters/numbers only)"); return; }
    
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        // Default new users: no admin, no salmon, no verified
        await setDoc(doc(db, "users", res.user.uid), { 
            username: u, 
            admin: false, 
            salmon: false, 
            verified: false,
            lastSeen: serverTimestamp() 
        });
    } catch(e) { alert("Registration failed (Username might be taken)."); }
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
