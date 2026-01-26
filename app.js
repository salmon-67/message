// Add this inside your app.js to make the Members button work correctly
document.getElementById('btn-toggle-members').onclick = () => {
    const sr = document.getElementById('sidebar-right');
    if (sr.style.display === 'none' || sr.style.display === '') {
        sr.style.display = 'flex';
    } else {
        sr.style.display = 'none';
    }
};

// Ensure your openChat function updates the member list every time
async function openChat(id, name) {
    if (msgUnsub) msgUnsub();
    activeChatId = id;
    
    document.getElementById('welcome-view').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('chat-title').innerText = `# ${name}`;

    // Refresh member list for this specific channel
    const cSnap = await getDoc(doc(db, "conversations", id));
    const mList = document.getElementById('member-list'); 
    mList.innerHTML = "";
    
    if (cSnap.exists()) {
        for (const uid of cSnap.data().members) {
            const mDoc = await getDoc(doc(db, "users", uid));
            if (mDoc.exists()) {
                const mData = mDoc.data();
                mList.innerHTML += `
                    <div style="display:flex; align-items:center; padding:12px; gap:10px; border-bottom:1px solid var(--border);">
                        <div style="width:28px; height:28px; background:var(--bg-input); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">${mData.username[0].toUpperCase()}</div>
                        <span style="font-size:13px; font-weight:500;">${mData.username} ${mData.verified ? '⭐' : ''}</span>
                    </div>`;
            }
        }
    }
    // ... rest of your message loading logic ...
}
