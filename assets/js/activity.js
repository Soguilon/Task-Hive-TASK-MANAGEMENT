(function(){
  TaskHiveAuth.requireAuth();
  if (!TaskHiveAuth.isAdmin()){ window.location.href = 'dashboard.html'; return; }
  TaskHiveApp.initShell('activity');
  TaskHiveApp.startGlobalWidgets();

  let refreshing = false;
  async function refresh(){
    if (refreshing) return; // guard against overlapping requests if one tick runs long
    refreshing = true;
    const res = await TaskHiveAPI.call('syncActivity', {});
    refreshing = false;
    if (!res.success) return;
    const memberMap = {}; (res.data.members||[]).forEach(m => memberMap[m.UserID] = m.DisplayName);
    const log = res.data.activity;
    document.getElementById('activity-tbody').innerHTML = log.length ? log.map(l => `
      <tr><td>${TaskHiveApp.esc(memberMap[l.UserID]||l.UserID)}</td><td><strong>${TaskHiveApp.esc(l.Action)}</strong></td><td class="small text-muted">${TaskHiveApp.esc(l.Details)}</td><td class="small">${new Date(l.CreatedAt).toLocaleString()}</td></tr>`).join('')
      : '<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i>No activity yet.</div></td></tr>';
  }
  refresh();
  setInterval(refresh, 2000);
})();
