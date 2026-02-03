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
let msgUnsub = null, memberUnsub = null, channelUnsub = null, dmUnsub = null;
let typingTimeout = null;
let lastReadMap = JSON.parse(localStorage.getItem('salmon_reads') || '{}');

// --- HELPER: BADGES & FORMATTING ---
function getBadges(user) {
    let badges = "";
    if (user.dev) badges += " 💻";
    if (user.admin) badges += " 🛠️";
    if (user.mod) badges += " 🛡️";
    if (user.salmon) badges += " 🐟";
    if (user.vip) badges += " 💎";
    if (user.verified) badges += " ✅";
    return badges;
}

function formatMessage(text) {
    // 1. Links
    let formatted = text.replace(/(https?:\/\/[^\s]+)/g, (url) => 
        `<a href="${url}" target="_blank" style="color: #3b82f6; text-decoration: underline;">${url}</a>`
    );
    // 2. Mentions (@username)
    formatted = formatted.replace(/@([a-z0-9]+)/gi, (match, username) => {
        return `<span style="background: #3b82f633; color: #60a5fa; padding: 0 4px; border-radius: 4px; font-weight: bold;">${match}</span>`;
    });
    return formatted;
}

// --- AUTH LISTENER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) { signOut(auth); return; }
        
        currentUser = { id: user.uid, ...userSnap.data() };
        
        // Auto-fix: Ensure lowercase username exists for searching
        if (!currentUser.username_lower) {
            updateDoc(doc(db, "users", currentUser.id), { username_lower: currentUser.username.toLowerCase() });
        }

        document.getElementById('my-name').innerHTML = `${currentUser.username} ${getBadges(currentUser)}`;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        
        // Heartbeat
        setInterval(() => updateDoc(doc(db, "users", currentUser.id), { lastSeen: serverTimestamp() }), 30000);
        
        await autoJoinAnnouncements();
        loadChannels();
        loadDMs();
    } else {
        currentUser = null;
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
});

// --- SIDEBAR: CHANNELS & DMs ---
function loadChannels() {
    if (channelUnsub) channelUnsub();
    
    // Query: Type is 'channel' OR missing (legacy), and user is member (unless admin)
    const q = currentUser.admin
        ? query(collection(db, "conversations"), where("type", "!=", "dm"))
        : query(collection(db, "conversations"), where("type", "!=", "dm"), where("members", "array-contains", currentUser.id));
    
    channelUnsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('channel-list');
        renderSidebarList(list, snap, false);
    });
}

function loadDMs() {
    if (dmUnsub) dmUnsub();
    
    const q = query(collection(db, "conversations"), where("type", "==", "dm"), where("members", "array-contains", currentUser.id));
    
    dmUnsub = onSnapshot(q, (snap) => {
        const list = document.getElementById('dm-list');
        // If DM list doesn't exist in HTML yet, create it dynamically
        if (!list) {
            const sidebar = document.getElementById('sidebar-left');
            const dmHeader = document.createElement('div');
            dmHeader.innerHTML = `<div style="padding: 15px 15px 5px; font-size: 11px; font-weight: bold; color: #71717a; display:flex; justify-content:space-between;"><span>DIRECT MESSAGES</span> <span id="btn-new-dm" style="cursor:pointer; font-size:14px;">+</span></div>`;
            sidebar.insertBefore(dmHeader, document.getElementById('my-user-bar'));
            
            const dmContainer = document.createElement('div');
            dmContainer.id = 'dm-list';
            dmContainer.className = 'scroll-area';
            dmContainer.style.flex = "1"; // Share space
            sidebar.insertBefore(dmContainer, document.getElementById('my-user-bar'));

            document.getElementById('btn-new-dm').onclick = createDM;
        }
        renderSidebarList(document.getElementById('dm-list'), snap, true);
    });
}

function renderSidebarList(container, snap, isDM) {
    if(!container) return;
    const docs = [];
    snap.forEach(d => docs.push({id: d.id, ...d.data()}));
    docs.sort((a, b) => (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0));

    container.innerHTML = "";
    docs.forEach(data => {
        const isSelected = activeChatId === data.id;
        const isUnread = !isSelected && (data.lastUpdated?.toMillis() || 0) > (lastReadMap[data.id] || 0);
        
        // Name logic: If DM, find the OTHER person's name
        let dispName = data.name;
        if (isDM && data.memberNames) {
            const otherName = data.memberNames.find(n => n !== currentUser.username);
            dispName = otherName || "Unknown";
        }

        const btn = document.createElement('div');
        btn.className = `channel-btn ${isSelected ? 'active' : ''}`;
        const dot = isUnread ? `<span style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-right:8px; box-shadow:0 0 5px #ef4444;"></span>` : "";
        
        btn.innerHTML = `${dot}${isDM ? '@' : '#'} ${dispName}`;
        btn.onclick = () => openChat(data.id, dispName, isDM);
        container.appendChild(btn);
    });
}

async function createDM() {
    const targetUser = prompt("Enter username for DM:");
    if (!targetUser) return;
    const lower = targetUser.toLowerCase();
    
    // Find user
    const q = query(collection(db, "users"), where("username", "in", [targetUser, lower]), limit(1));
    const snap = await getDocs(q);
    
    if (snap.empty) { alert("User not found!"); return; }
    
    const otherUser = snap.docs[0].data();
    const otherId = snap.docs[0].id;
    
    // Create DM
    await addDoc(collection(db, "conversations"), {
        type: "dm",
        members: [currentUser.id, otherId],
        memberNames: [currentUser.username, otherUser.username],
        lastUpdated: serverTimestamp()
    });
}


// --- MAIN CHAT LOGIC ---
function openChat(id, name, isDM) {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    
    activeChatId = id;
    lastReadMap[id] = Date.now();
    localStorage.setItem('salmon_reads', JSON.stringify(lastReadMap));
    
    // Refresh sidebars
    loadChannels(); 
    loadDMs();

    // 1. Header
    const titleArea = document.getElementById('chat-title');
    titleArea.innerHTML = `
        <div style="display:flex; flex-direction:column;">
            <div><span style="font-weight:bold;">${isDM?'@':'#'} ${name}</span> <span id="typing-indicator" style="font-size:11px; color:#3b82f6; margin-left:10px; font-weight:normal;"></span></div>
            <div id="pinned-bar" style="font-size:11px; color:#fbbf24; display:none; margin-top:4px; cursor:pointer;">📌 View Pinned Message</div>
        </div>
    `;

    // 2. Clear Chat (Admin Only)
    if (currentUser.admin) {
        const clearBtn = document.createElement('button');
        clearBtn.innerText = "Clear";
        clearBtn.className = "btn-mini-danger";
        clearBtn.style.marginLeft = "15px";
        clearBtn.onclick = async () => {
            if (confirm("Delete ALL messages?")) {
                const batch = writeBatch(db);
                const msgs = await getDocs(collection(db, "conversations", id, "messages"));
                msgs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                await systemMsg(id, `⚠️ Chat cleared by Admin.`);
            }
        };
        titleArea.appendChild(clearBtn);
    }

    // 3. UI Config
    document.getElementById('input-area').style.display = (name === 'announcements' && !currentUser.admin) ? 'none' : 'block';
    
    // Leave Button
    const leaveBtn = document.getElementById('btn-leave-chat');
    if (leaveBtn) {
        leaveBtn.style.display = (name === 'announcements' || isDM) ? 'none' : 'block';
        leaveBtn.onclick = async () => {
            if (confirm(`Leave #${name}?`)) {
                await systemMsg(id, `👋 ${currentUser.username} left.`);
                await updateDoc(doc(db, "conversations", id), { members: arrayRemove(currentUser.id) });
                closeCurrentChat();
            }
        };
    }

    // 4. Member List (Right Sidebar)
    setupRightSidebar(id, name, isDM);

    // 5. Message Listener & PINS & TYPING
    setupChatListeners(id);
}

function setupRightSidebar(id, name, isDM) {
    const sidebar = document.getElementById('sidebar-right');
    if (isDM) {
        sidebar.innerHTML = `<div class="header">DM DETAILS</div><div style="padding:15px; color:#71717a; font-size:12px;">Private chat</div>`;
        return;
    }

    sidebar.innerHTML = `
        <div class="header">MEMBERS</div>
        <div id="member-list" class="scroll-area"></div>
        <div id="static-add-ui" style="padding:15px; border-top:var(--border);">
            <input type="text" id="target-name" class="input-box" placeholder="Add Username" style="font-size:11px; margin-bottom:5px;">
            <button id="btn-add-member" class="btn btn-primary" style="font-size:11px; padding:6px; width:100%;">Add</button>
        </div>
    `;
    
    // Hide Add UI for non-admins in announcements
    if (name === 'announcements' && !currentUser.admin) document.getElementById('static-add-ui').style.display = 'none';

    // Add Member Logic
    document.getElementById('btn-add-member').onclick = async () => {
        const val = document.getElementById('target-name').value.trim();
        if(!val) return;
        const q = query(collection(db, "users"), where("username", "in", [val, val.toLowerCase()]), limit(1));
        const snap = await getDocs(q);
        if(!snap.empty) {
            const u = snap.docs[0];
            await updateDoc(doc(db, "conversations", id), { members: arrayUnion(u.id) });
            await systemMsg(id, `👋 ${currentUser.username} added ${u.data().username}`);
            document.getElementById('target-name').value = "";
        } else {
            alert("User not found");
        }
    };

    // Member List Sync
    memberUnsub = onSnapshot(doc(db, "conversations", id), async (snap) => {
        const data = snap.data();
        if(!data) return;
        
        // Security Kick
        if (!currentUser.admin && !data.members.includes(currentUser.id)) { closeCurrentChat(); return; }

        // Render List
        const listDiv = document.getElementById('member-list');
        listDiv.innerHTML = "";
        const uniqueIds = [...new Set(data.members || [])];
        
        for (let uid of uniqueIds) {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
                const u = uSnap.data();
                const isOnline = u.lastSeen && (Date.now() - u.lastSeen.toMillis() < 120000);
                
                const d = document.createElement('div');
                d.className = "member-item";
                d.style.display = "flex"; d.style.justifyContent = "space-between";
                d.innerHTML = `<span><div class="status-dot ${isOnline ? 'online' : ''}"></div><b>${u.username}</b>${getBadges(u)}</span>`;
                
                // Admin Kick
                if (currentUser.admin && uid !== currentUser.id) {
                    const k = document.createElement('span');
                    k.innerHTML = "&times;";
                    k.style = "color:red; cursor:pointer; font-weight:bold;";
                    k.onclick = async () => {
                        if(confirm("Kick user?")) {
                            await updateDoc(doc(db, "conversations", id), { members: arrayRemove(uid) });
                            await systemMsg(id, `🚫 Admin kicked ${u.username}`);
                        }
                    };
                    d.appendChild(k);
                }
                listDiv.appendChild(d);
            }
        }
        
        // Handle Typing Indicator UI
        const typingDiv = document.getElementById('typing-indicator');
        if (data.typing) {
            const typers = [];
            for (const [uid, ts] of Object.entries(data.typing)) {
                if (uid !== currentUser.id && (Date.now() - ts.toMillis() < 3000)) {
                    // Fetch name from cache or list (simplified here: just say "Someone")
                    // Ideally you map UID to name from the loaded member list
                    typers.push("Someone"); 
                }
            }
            typingDiv.innerText = typers.length > 0 ? `${typers.length} typing...` : "";
        }
    });
}

function setupChatListeners(id) {
    // Listen to Messages
    msgUnsub = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp", "asc")), (snap) => {
        const box = document.getElementById('messages-box'); 
        box.innerHTML = ""; 
        let hasPins = false;

        snap.forEach(d => {
            const m = d.data();
            if (m.pinned) hasPins = true;

            const div = document.createElement('div'); 
            
            if (m.senderId === "system") {
                div.style = "text-align:center; font-size:11px; color:#71717a; margin:10px 0; font-style:italic;";
                div.innerHTML = m.content;
            } else {
                div.className = `msg-row ${m.senderId === currentUser.id ? 'me' : 'them'}`;
                
                // Badges
                let badges = "";
                if(m.senderFlags) badges = getBadges(m.senderFlags);

                // Tools: Delete (Admin), Edit (Owner), Pin (Admin)
                let tools = "";
                if (currentUser.admin || m.senderId === currentUser.id) {
                    if (currentUser.admin) tools += `<span class="tool-btn" data-act="del">🗑️</span>`;
                    if (currentUser.admin) tools += `<span class="tool-btn" data-act="pin">${m.pinned ? 'unpin' : '📌'}</span>`;
                    if (m.senderId === currentUser.id) tools += `<span class="tool-btn" data-act="edit">✏️</span>`;
                }

                // Edited tag
                const editedTag = m.edited ? `<span style="font-size:9px; color:#71717a;">(edited)</span>` : "";
                const pinnedStyle = m.pinned ? "border: 1px solid #fbbf24; background: #fbbf2411;" : "";

                div.innerHTML = `
                    <div class="msg-meta">${m.senderName}${badges} • ${tools}</div>
                    <div class="bubble" style="${pinnedStyle}">${formatMessage(m.content)} ${editedTag}</div>
                `;

                // Handle clicks
                const toolBtns = div.querySelectorAll('.tool-btn');
                toolBtns.forEach(btn => btn.onclick = async () => {
                    const action = btn.dataset.act;
                    if (action === 'del') {
                        if(confirm("Delete?")) {
                            await deleteDoc(d.ref); 
                            await systemMsg(id, `🗑️ Admin deleted msg from ${m.senderName}`);
                        }
                    }
                    if (action === 'pin') {
                        await updateDoc(d.ref, { pinned: !m.pinned });
                    }
                    if (action === 'edit') {
                        const newText = prompt("Edit message:", m.content);
                        if (newText && newText !== m.content) {
                            await updateDoc(d.ref, { content: newText, edited: true });
                        }
                    }
                });
            }
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;

        // Show/Hide Pin Bar
        const pinBar = document.getElementById('pinned-bar');
        if(pinBar) {
            pinBar.style.display = hasPins ? 'block' : 'none';
            pinBar.onclick = () => {
                // Scroll to first pinned message
                const firstPin = box.querySelector('div[style*="border: 1px solid"]');
                if(firstPin) firstPin.scrollIntoView({behavior: "smooth"});
            }
        }
    });
}

async function systemMsg(chatId, text) {
    await addDoc(collection(db, "conversations", chatId, "messages"), {
        content: text, senderId: "system", senderName: "System", timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", chatId), { lastUpdated: serverTimestamp() });
}

function closeCurrentChat() {
    if (msgUnsub) msgUnsub(); 
    if (memberUnsub) memberUnsub();
    activeChatId = null;
    document.getElementById('messages-box').innerHTML = "";
    document.getElementById('chat-title').innerText = "Select a channel";
    document.getElementById('input-area').style.display = 'none';
}


// --- GLOBAL CONTROLS & COMMANDS ---

// Typing Indicator Input Logic
const msgInput = document.getElementById('msg-input');
msgInput.addEventListener('input', () => {
    if (!activeChatId) return;
    
    // Throttle database writes
    if (typingTimeout) clearTimeout(typingTimeout);
    
    // Update "typing" field in DB
    const path = `typing.${currentUser.id}`;
    updateDoc(doc(db, "conversations", activeChatId), { [path]: serverTimestamp() });

    typingTimeout = setTimeout(() => {
        // Stop typing indicator could be handled here if we tracked start/stop, 
        // but the listener filters out old timestamps automatically.
    }, 2000);
});

document.getElementById('btn-send').onclick = async () => {
    const text = msgInput.value.trim();
    if (!text || !activeChatId) return;
    msgInput.value = "";

    // --- COMMAND HANDLING (The "Add to already created users" fix) ---
    if (text.startsWith('/')) {
        handleCommand(text);
        return;
    }

    await addDoc(collection(db, "conversations", activeChatId, "messages"), {
        content: text, 
        senderId: currentUser.id, 
        senderName: currentUser.username, 
        senderFlags: {
            admin: currentUser.admin || false,
            salmon: currentUser.salmon || false,
            verified: currentUser.verified || false,
            mod: currentUser.mod || false,
            vip: currentUser.vip || false,
            dev: currentUser.dev || false
        },
        timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeChatId), { lastUpdated: serverTimestamp() });
};

async function handleCommand(text) {
    if (!currentUser.admin) { alert("Commands are for Admins only."); return; }
    
    const parts = text.split(' ');
    const cmd = parts[0]; // /promote
    const targetName = parts[1]; // alex
    const role = parts[2]; // vip

    if ((cmd === '/promote' || cmd === '/demote') && targetName && role) {
        const q = query(collection(db, "users"), where("username", "in", [targetName, targetName.toLowerCase()]), limit(1));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            await systemMsg(activeChatId, `⚠️ Command failed: User '${targetName}' not found.`);
            return;
        }

        const targetId = snap.docs[0].id;
        const val = (cmd === '/promote'); // true for promote, false for demote
        
        await updateDoc(doc(db, "users", targetId), { [role]: val });
        await systemMsg(activeChatId, `🛠️ Admin ${cmd}d ${targetName} regarding role '${role}'`);
    } else {
        alert("Invalid command.\nUse: /promote [username] [role]\nRoles: vip, mod, dev, admin, salmon, verified");
    }
}

// Login/Reg/Logout standard boilerplate
document.getElementById('btn-signin').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    try { await signInWithEmailAndPassword(auth, `${u}@salmon.com`, p); } catch(e) { alert("Login failed"); }
};
document.getElementById('btn-register').onclick = async () => {
    const u = document.getElementById('login-user').value.trim().toLowerCase();
    const p = document.getElementById('login-pass').value;
    if (!/^[a-z0-9]+$/.test(u) || u.length < 3) { alert("Invalid username"); return; }
    try {
        const res = await createUserWithEmailAndPassword(auth, `${u}@salmon.com`, p);
        await setDoc(doc(db, "users", res.user.uid), { username: u, username_lower: u, lastSeen: serverTimestamp() });
    } catch(e) { alert("Taken/Error"); }
};
document.getElementById('btn-create').onclick = async () => {
    const n = document.getElementById('new-channel-name').value.trim();
    if (n) await addDoc(collection(db, "conversations"), { name: n, type: 'channel', members: [currentUser.id], lastUpdated: serverTimestamp() });
};
document.getElementById('btn-logout').onclick = () => signOut(auth);

async function autoJoinAnnouncements() {
    const q = query(collection(db, "conversations"), where("name", "==", "announcements"), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) { await updateDoc(doc(db, "conversations", snap.docs[0].id), { members: arrayUnion(currentUser.id) }); }
}
