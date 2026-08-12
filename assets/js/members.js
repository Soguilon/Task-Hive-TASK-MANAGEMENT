(function(){
  TaskHiveAuth.requireAuth();
  if (!TaskHiveAuth.isAdmin()){ window.location.href = 'dashboard.html'; return; }
  TaskHiveApp.initShell('members');

  document.getElementById('new-member-btn').onclick = () => {
    document.getElementById('member-form').reset();
    document.getElementById('mf-user-id').value = '';
    document.getElementById('member-modal-title').textContent = 'Add Member';
    document.getElementById('mf-password').required = true;
    document.getElementById('mf-pass-note').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('member-modal')).show();
  };

  function openEdit(m){
    document.getElementById('member-form').reset();
    document.getElementById('mf-user-id').value = m.UserID;
    document.getElementById('mf-display-name').value = m.DisplayName;
    document.getElementById('mf-username').value = m.Username;
    document.getElementById('mf-role').value = m.Role;
    document.getElementById('mf-password').required = false;
    document.getElementById('mf-pass-note').classList.remove('d-none');
    document.getElementById('member-modal-title').textContent = 'Edit Member';
    new bootstrap.Modal(document.getElementById('member-modal')).show();
  }

  document.getElementById('member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('mf-user-id').value;
    const payload = {
      displayName: document.getElementById('mf-display-name').value.trim(),
      username: document.getElementById('mf-username').value.trim(),
      password: document.getElementById('mf-password').value,
      role: document.getElementById('mf-role').value
    };
    let res;
    if (userId){ payload.userId = userId; res = await TaskHiveAPI.call('editMember', payload); }
    else res = await TaskHiveAPI.call('addMember', payload);
    if (res.success){ TaskHiveApp.toast('Member saved successfully.'); bootstrap.Modal.getInstance(document.getElementById('member-modal')).hide(); }
    else TaskHiveApp.toast(res.error || 'Unable to save member.', 'error');
  });

  function render(data){
    document.getElementById('members-tbody').innerHTML = data.members.map(m => `
      <tr>
        <td>${TaskHiveApp.esc(m.DisplayName)}</td>
        <td>${TaskHiveApp.esc(m.Username)}</td>
        <td><span class="badge-th badge-status-notstarted">${TaskHiveApp.esc(m.Role)}</span></td>
        <td><span class="badge-th ${m.Status==='Active'?'badge-status-active':'badge-status-needsrevision'}">${TaskHiveApp.esc(m.Status)}</span></td>
        <td class="text-nowrap">
          <button class="btn btn-sm btn-honey edit-m" data-id="${m.UserID}"><i class="fa-solid fa-pen"></i></button>
          ${m.Status==='Active' ? `<button class="btn btn-sm btn-outline-brut deactivate-m" data-id="${m.UserID}"><i class="fa-solid fa-user-slash"></i></button>`
            : `<button class="btn btn-sm btn-outline-brut reactivate-m" data-id="${m.UserID}"><i class="fa-solid fa-user-check"></i></button>`}
          <button class="btn btn-sm btn-danger remove-m" data-id="${m.UserID}"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join('');

    document.querySelectorAll('.edit-m').forEach(b => b.onclick = () => openEdit(data.members.find(m=>m.UserID===b.dataset.id)));
    document.querySelectorAll('.deactivate-m').forEach(b => b.onclick = async () => { await TaskHiveAPI.call('deactivateMember',{userId:b.dataset.id}); TaskHiveApp.toast('Member deactivated.'); });
    document.querySelectorAll('.reactivate-m').forEach(b => b.onclick = async () => { await TaskHiveAPI.call('reactivateMember',{userId:b.dataset.id}); TaskHiveApp.toast('Member reactivated.'); });
    document.querySelectorAll('.remove-m').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this member permanently?')) return;
      await TaskHiveAPI.call('removeMember',{userId:b.dataset.id}); TaskHiveApp.toast('Member removed.');
    });
  }

  TaskHiveApp.startSync(render, 'syncMembers');
})();
