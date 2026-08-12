(function(){
  TaskHiveAuth.requireAuth();
  if (!TaskHiveAuth.isAdmin()){ window.location.href = 'dashboard.html'; return; }
  TaskHiveApp.initShell('trash');
  TaskHiveApp.startGlobalWidgets();

  let refreshing = false;
  async function refresh(){
    if (refreshing) return; // guard against overlapping requests if one tick runs long
    refreshing = true;
    const res = await TaskHiveAPI.call('listTrash', {});
    refreshing = false;
    if (!res.success) return;
    document.getElementById('trash-tbody').innerHTML = res.data.length ? res.data.map(t => {
      let snap = {}; try{ snap = JSON.parse(t.Snapshot); }catch(e){}
      const name = snap.ProjectName || snap.TaskTitle || t.RecordID;
      return `<tr><td>${TaskHiveApp.esc(t.RecordType)}</td><td>${TaskHiveApp.esc(name)}</td><td class="small">${TaskHiveApp.esc(t.TrashedBy)}</td><td class="small">${new Date(t.TrashedAt).toLocaleString()}</td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-honey restore-btn" data-id="${t.TrashID}"><i class="fa-solid fa-rotate-left"></i> Restore</button>
          <button class="btn btn-sm btn-danger perm-del-btn" data-id="${t.TrashID}"><i class="fa-solid fa-trash-can"></i> Delete Forever</button>
        </td></tr>`;
    }).join('') : '<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-trash"></i>Trash is empty.</div></td></tr>';

    document.querySelectorAll('.restore-btn').forEach(b => b.onclick = async () => {
      const r = await TaskHiveAPI.call('restoreFromTrash', {trashId:b.dataset.id});
      if (r.success){ TaskHiveApp.toast('Restored successfully.'); refresh(); } else TaskHiveApp.toast(r.error,'error');
    });
    document.querySelectorAll('.perm-del-btn').forEach(b => b.onclick = async () => {
      if (!confirm('Permanently delete this record? This cannot be undone.')) return;
      const r = await TaskHiveAPI.call('permanentlyDelete', {trashId:b.dataset.id});
      if (r.success){ TaskHiveApp.toast('Permanently deleted.'); refresh(); } else TaskHiveApp.toast(r.error,'error');
    });
  }
  refresh();
  setInterval(refresh, 5000);
})();
