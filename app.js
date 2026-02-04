// --- Safe message rendering, timestamps, Enter/Shift+Enter behavior ---
// Helper: escape + create message node
function renderMessage(container, d, userObj, isAdmin) {
    const m = d.data();
    const isMe = m.uid === userObj.id;

    const msgWrap = document.createElement('div');
    msgWrap.className = `msg ${isMe ? 'me' : 'them'}`;

    // Avatar (initials)
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = (m.name || 'U').split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase();
    msgWrap.appendChild(avatar);

    // Content block
    const content = document.createElement('div');
    content.className = 'msg-content';

    const header = document.createElement('div');
    header.className = 'msg-header';

    const nameEl = document.createElement('strong');
    nameEl.textContent = m.name || 'Unknown';
    header.appendChild(nameEl);

    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    // Show relative time when available, fallback to formatted string
    if (m.timestamp && m.timestamp.toMillis) {
        const ts = m.timestamp.toDate();
        timeEl.textContent = formatTime(ts);
    } else {
        timeEl.textContent = '';
    }
    header.appendChild(timeEl);

    content.appendChild(header);

    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    // Use textContent to prevent XSS
    textEl.textContent = m.text || '';
    content.appendChild(textEl);

    // Admin delete action
    if (isAdmin) {
        const del = document.createElement('button');
        del.className = 'delete-btn';
        del.textContent = 'Delete';
        del.onclick = async () => {
            if (!confirm('Delete this message?')) return;
            await deleteDoc(doc(db, "conversations", d.ref.parent.parent.id, "messages", d.id));
        };
        content.appendChild(del);
    }

    msgWrap.appendChild(content);
    container.appendChild(msgWrap);
}

// Format timestamp helper
function formatTime(date) {
    // return relative time for recent messages + time for day
    const now = Date.now();
    const diff = Math.floor((now - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

// Replace message render code inside your onSnapshot handler with:
unsubMsg = onSnapshot(query(collection(db, "conversations", id, "messages"), orderBy("timestamp")), (snap) => {
    const box = document.getElementById('messages-box');
    box.innerHTML = "";
    snap.forEach(d => {
        renderMessage(box, d, userObj, isAdmin);
    });
    box.scrollTop = box.scrollHeight;
});

// Send handler: Enter to send, Shift+Enter newline
const msgInput = document.getElementById('msg-input');
msgInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = msgInput.value.trim();
        if (!val) return;
        await addDoc(collection(db, "conversations", activeId, "messages"), {
            text: val, uid: userObj.id, name: userObj.username, timestamp: serverTimestamp()
        });
        msgInput.value = "";
    }
});
// Keep old click send handler as backup
document.getElementById('btn-send').onclick = async () => {
    const val = msgInput.value.trim();
    if (!val) return;
    await addDoc(collection(db, "conversations", activeId, "messages"), {
        text: val, uid: userObj.id, name: userObj.username, timestamp: serverTimestamp()
    });
    msgInput.value = "";
};
