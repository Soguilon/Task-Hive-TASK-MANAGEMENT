(function(){
  TaskHiveAuth.requireAuth();
  TaskHiveApp.initShell('discussions');
  const user = TaskHiveAuth.getUser();
  let lastCount = 0;

  function isNearBottom(el){ return el.scrollHeight - el.scrollTop - el.clientHeight < 80; }

  function render(data){
    const container = document.getElementById('discussion-messages');
    const wasAtBottom = isNearBottom(container);
    const msgs = data.discussions;
    if (msgs.length === lastCount && container.dataset.rendered === '1') return; // avoid unnecessary DOM rebuild
    lastCount = msgs.length;
    container.dataset.rendered = '1';
    container.innerHTML = msgs.length ? msgs.map(m => `
      <div class="discussion-msg">
        <span class="sender">${TaskHiveApp.esc(m.SenderName)}</span> <span class="time">${new Date(m.CreatedAt).toLocaleString()}</span>
        <div>${TaskHiveApp.esc(m.Message)}</div>
      </div>`).join('') : '<div class="empty-state"><i class="fa-solid fa-comment-slash"></i>No messages yet. Start the conversation.</div>';
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
  }

  document.getElementById('discussion-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('discussion-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    const res = await TaskHiveAPI.call('sendDiscussion', {message: msg});
    if (!res.success) TaskHiveApp.toast(res.error || 'Message could not be sent.', 'error');
  });

  TaskHiveApp.startSync(render, 'syncDiscussions');
})();
