(function(){
  TaskHiveAuth.requireAuth();
  if (!TaskHiveAuth.isAdmin()){ window.location.href = 'dashboard.html'; return; }
  TaskHiveApp.initShell('archive');
  TaskHiveApp.startGlobalWidgets();

  let refreshing = false;
  async function refresh(){
    if (refreshing) return; // guard against overlapping requests if one tick runs long
    refreshing = true;
    const res = await TaskHiveAPI.call('listArchive', {});
    refreshing = false;
    if (!res.success) return;
    document.getElementById('archive-tbody').innerHTML = res.data.length ? res.data.map(a => {
      let snap = {}; try{ snap = JSON.parse(a.Snapshot); }catch(e){}
      const name = snap.TaskTitle || snap.ProjectName || a.RecordID;
      return `<tr><td>${TaskHiveApp.esc(a.RecordType)}</td><td>${TaskHiveApp.esc(name)}</td><td class="small">${TaskHiveApp.esc(a.ArchivedBy)}</td><td class="small">${new Date(a.ArchivedAt).toLocaleString()}</td></tr>`;
    }).join('') : '<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-box-archive"></i>Archive is empty.</div></td></tr>';
  }
  refresh();
  setInterval(refresh, 5000);
})();
