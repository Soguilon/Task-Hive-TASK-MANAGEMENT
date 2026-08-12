(function(){
  TaskHiveAuth.requireAuth();
  TaskHiveApp.initShell('tasks');
  const user = TaskHiveAuth.getUser();
  const isAdmin = user.Role === 'Admin';
  document.getElementById('page-title').textContent = isAdmin ? 'Task Review' : 'My Tasks';
  if (isAdmin) document.getElementById('new-task-btn').classList.remove('d-none');

  let linkCounter = 0, searchQuery = '', latestData = null;

  function addLinkRow(link){
    link = link || {title:'', description:'', url:''};
    linkCounter++;
    const div = document.createElement('div');
    div.className = 'card mb-2 p-2';
    div.dataset.linkRow = 'l' + linkCounter;
    div.innerHTML = `<div class="row g-2">
      <div class="col-md-4"><input class="form-control form-control-sm link-title" placeholder="Link Title" value="${TaskHiveApp.esc(link.title)}"></div>
      <div class="col-md-4"><input class="form-control form-control-sm link-desc" placeholder="Description" value="${TaskHiveApp.esc(link.description)}"></div>
      <div class="col-md-3"><input class="form-control form-control-sm link-url" placeholder="https://..." value="${TaskHiveApp.esc(link.url)}"></div>
      <div class="col-md-1"><button type="button" class="btn btn-outline-brut btn-sm w-100 remove-link"><i class="fa-solid fa-xmark"></i></button></div>
    </div>`;
    div.querySelector('.remove-link').onclick = () => div.remove();
    document.getElementById('tf-links-container').appendChild(div);
  }
  document.getElementById('tf-add-link').onclick = () => addLinkRow();
  function collectLinks(){
    return [...document.querySelectorAll('[data-link-row]')].map(row => ({
      title: row.querySelector('.link-title').value.trim(),
      description: row.querySelector('.link-desc').value.trim(),
      url: row.querySelector('.link-url').value.trim()
    })).filter(l => l.title || l.url);
  }

  function populateSelects(data){
    const sel = document.getElementById('tf-member');
    const current = sel.value; // preserve the Admin's current selection across sync re-renders
    sel.innerHTML = data.members.filter(m=>m.Role==='Member').map(m => `<option value="${m.UserID}">${TaskHiveApp.esc(m.DisplayName)}</option>`).join('');
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  }

  document.getElementById('new-task-btn').onclick = () => {
    document.getElementById('task-form').reset();
    document.getElementById('tf-task-id').value = '';
    document.getElementById('tf-links-container').innerHTML = '';
    document.getElementById('task-modal-title').textContent = 'New Task';
    document.getElementById('tf-submit-btn').textContent = 'Create Task';
    addLinkRow();
    new bootstrap.Modal(document.getElementById('task-modal')).show();
  };

  function openEditTask(t){
    document.getElementById('task-form').reset();
    document.getElementById('tf-task-id').value = t.TaskID;
    document.getElementById('tf-title').value = t.TaskTitle;
    document.getElementById('tf-member').value = t.AssignedMemberID;
    document.getElementById('tf-desc').value = t.Description;
    document.getElementById('tf-priority').value = t.Priority;
    document.getElementById('tf-deadline').value = (t.Deadline||'').slice(0,10);
    document.getElementById('tf-progress').value = t.Progress;
    document.getElementById('tf-links-container').innerHTML = '';
    document.getElementById('task-modal-title').textContent = 'Edit Task';
    document.getElementById('tf-submit-btn').textContent = 'Save Changes';
    new bootstrap.Modal(document.getElementById('task-modal')).show();
  }

  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('tf-task-id').value;
    const payload = {
      taskTitle: document.getElementById('tf-title').value.trim(),
      assignedMemberId: document.getElementById('tf-member').value,
      description: document.getElementById('tf-desc').value,
      priority: document.getElementById('tf-priority').value,
      deadline: document.getElementById('tf-deadline').value,
      progress: Number(document.getElementById('tf-progress').value)
    };
    let res;
    if (taskId){ payload.taskId = taskId; res = await TaskHiveAPI.call('editTask', payload); }
    else { payload.links = collectLinks(); res = await TaskHiveAPI.call('createTask', payload); }
    if (res.success){
      TaskHiveApp.toast(taskId ? 'Task updated successfully.' : 'Task created successfully.');
      bootstrap.Modal.getInstance(document.getElementById('task-modal')).hide();
    } else TaskHiveApp.toast(res.error || 'Unable to save task.', 'error');
  });

  function row(t, memberMap){
    return `<tr>
      <td><strong>${TaskHiveApp.esc(t.TaskTitle)}</strong></td>
      <td>${TaskHiveApp.esc(memberMap[t.AssignedMemberID]||'—')}</td>
      <td><span class="badge-th ${TaskHiveApp.priorityBadgeClass(t.Priority)}">${TaskHiveApp.esc(t.Priority)}</span></td>
      <td><span class="badge-th ${TaskHiveApp.statusBadgeClass(t.Status)}">${TaskHiveApp.esc(t.Status)}</span></td>
      <td style="min-width:100px"><div class="progress-th"><div class="bar" style="width:${t.Progress||0}%"></div></div></td>
      <td>${TaskHiveApp.esc((t.Deadline||'').slice(0,10)) || '—'}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-brut view-task" data-id="${t.TaskID}"><i class="fa-solid fa-eye"></i></button>
        ${isAdmin ? `<button class="btn btn-sm btn-honey edit-task" data-id="${t.TaskID}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-danger del-task" data-id="${t.TaskID}"><i class="fa-solid fa-trash"></i></button>` : ''}
      </td>
    </tr>`;
  }

  function render(data){
    latestData = data;
    populateSelects(data);
    const memberMap = {}; data.members.forEach(m => memberMap[m.UserID] = m.DisplayName);
    let tasks = data.tasks;
    if (searchQuery) tasks = tasks.filter(t => t.TaskTitle.toLowerCase().includes(searchQuery));
    document.getElementById('tasks-tbody').innerHTML = tasks.map(t => row(t, memberMap)).join('');
    document.getElementById('tasks-empty').classList.toggle('d-none', tasks.length>0);

    document.querySelectorAll('.edit-task').forEach(b => b.onclick = () => openEditTask(data.tasks.find(t=>t.TaskID===b.dataset.id)));
    document.querySelectorAll('.del-task').forEach(b => b.onclick = async () => {
      if (!confirm('Move this task to Trash?')) return;
      const res = await TaskHiveAPI.call('deleteTask', {taskId:b.dataset.id});
      if (res.success) TaskHiveApp.toast('Task moved to trash.'); else TaskHiveApp.toast(res.error,'error');
    });
    document.querySelectorAll('.view-task').forEach(b => b.onclick = () => openDetail(data.tasks.find(t=>t.TaskID===b.dataset.id), memberMap));
  }

  function openDetail(t, memberMap){
    if (!t) return;
    const links = t.Links || [];
    const mine = t.AssignedMemberID === user.UserID;
    const linksHtml = links.length ? links.map(l => `
      <div class="link-row">
        <div><div class="link-title">${TaskHiveApp.esc(l.Title)}</div><div class="link-desc">${TaskHiveApp.esc(l.Description)}</div></div>
        <div class="d-flex gap-1">
          <a href="${TaskHiveApp.esc(l.URL)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-brut"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          ${isAdmin ? `<button class="btn btn-sm btn-honey edit-link-btn" data-id="${l.LinkID}"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm btn-danger del-link-btn" data-id="${l.LinkID}"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      </div>`).join('') : '<div class="text-muted small">No links yet.</div>';

    let actionsHtml = '';
    if (isAdmin && t.Status === 'Submitted'){
      actionsHtml = `<button class="btn btn-success btn-sm" id="approve-btn"><i class="fa-solid fa-check"></i> Approve</button>
        <button class="btn btn-danger btn-sm" id="revise-btn"><i class="fa-solid fa-rotate-left"></i> Request Revision</button>`;
    } else if (!isAdmin && mine && ['Not Started','In Progress','Needs Revision'].includes(t.Status)){
      actionsHtml = `<button class="btn btn-primary btn-sm" id="progress-btn"><i class="fa-solid fa-play"></i> Mark In Progress</button>
        <button class="btn btn-honey btn-sm" id="submit-btn"><i class="fa-solid fa-paper-plane"></i> Submit for Review</button>`;
    }

    document.getElementById('task-detail-content').innerHTML = `
      <div class="modal-header"><h5 class="modal-title">${TaskHiveApp.esc(t.TaskTitle)}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <p><span class="badge-th ${TaskHiveApp.statusBadgeClass(t.Status)}">${TaskHiveApp.esc(t.Status)}</span>
        <span class="badge-th ${TaskHiveApp.priorityBadgeClass(t.Priority)}">${TaskHiveApp.esc(t.Priority)} priority</span>
        ${t.Deadline?('· Due '+TaskHiveApp.esc(t.Deadline.slice(0,10))):''}</p>
        <p class="small text-muted">Assigned to: ${TaskHiveApp.esc(memberMap[t.AssignedMemberID]||'—')}</p>
        <div class="progress-th mb-2"><div class="bar" style="width:${t.Progress||0}%"></div></div>
        <h6>Description</h6>${TaskHiveApp.multilineToList(t.Description)}
        <h6 class="mt-3">Links / Resources</h6>
        <div id="task-detail-links">${linksHtml}</div>
        ${isAdmin ? `<div class="mt-2"><div class="row g-2">
          <div class="col-md-4"><input class="form-control form-control-sm" id="new-tlink-title" placeholder="Link Title"></div>
          <div class="col-md-4"><input class="form-control form-control-sm" id="new-tlink-desc" placeholder="Description"></div>
          <div class="col-md-3"><input class="form-control form-control-sm" id="new-tlink-url" placeholder="https://..."></div>
          <div class="col-md-1"><button class="btn btn-sm btn-primary w-100" id="add-tdetail-link"><i class="fa-solid fa-plus"></i></button></div>
        </div></div>` : ''}
        <div class="d-flex gap-2 mt-3">${actionsHtml}</div>
      </div>`;

    document.querySelectorAll('.del-link-btn').forEach(b => b.onclick = async () => { await TaskHiveAPI.call('deleteTaskLink', {linkId:b.dataset.id}); TaskHiveApp.toast('Link deleted successfully.'); });
    document.querySelectorAll('.edit-link-btn').forEach(b => b.onclick = async () => {
      const link = links.find(l=>l.LinkID===b.dataset.id);
      const title = prompt('Link title', link.Title); if (title===null) return;
      const url = prompt('Link URL', link.URL); if (url===null) return;
      const res = await TaskHiveAPI.call('editTaskLink', {linkId:link.LinkID, title, url});
      if (res.success) TaskHiveApp.toast('Link updated successfully.'); else TaskHiveApp.toast(res.error,'error');
    });
    const addBtn = document.getElementById('add-tdetail-link');
    if (addBtn) addBtn.onclick = async () => {
      const title = document.getElementById('new-tlink-title').value.trim();
      const url = document.getElementById('new-tlink-url').value.trim();
      const description = document.getElementById('new-tlink-desc').value.trim();
      const res = await TaskHiveAPI.call('addTaskLink', {parentId:t.TaskID, title, description, url});
      if (res.success) TaskHiveApp.toast('Link added successfully.'); else TaskHiveApp.toast(res.error,'error');
    };
    const approveBtn = document.getElementById('approve-btn');
    if (approveBtn) approveBtn.onclick = async () => { const r = await TaskHiveAPI.call('approveTask',{taskId:t.TaskID}); if(r.success){TaskHiveApp.toast('Task approved.'); bootstrap.Modal.getInstance(document.getElementById('task-detail-modal')).hide();} };
    const reviseBtn = document.getElementById('revise-btn');
    if (reviseBtn) reviseBtn.onclick = async () => { const r = await TaskHiveAPI.call('requestRevision',{taskId:t.TaskID}); if(r.success){TaskHiveApp.toast('Revision requested.'); bootstrap.Modal.getInstance(document.getElementById('task-detail-modal')).hide();} };
    const progressBtn = document.getElementById('progress-btn');
    if (progressBtn) progressBtn.onclick = async () => { const r = await TaskHiveAPI.call('editTask',{taskId:t.TaskID, status:'In Progress'}); if(r.success) TaskHiveApp.toast('Task marked in progress.'); };
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) submitBtn.onclick = async () => { const r = await TaskHiveAPI.call('submitTask',{taskId:t.TaskID}); if(r.success){TaskHiveApp.toast('Task submitted for review.'); bootstrap.Modal.getInstance(document.getElementById('task-detail-modal')).hide();} };

    new bootstrap.Modal(document.getElementById('task-detail-modal')).show();
  }

  document.addEventListener('th:search', e => { searchQuery = e.detail.query; if (latestData) render(latestData); });
  TaskHiveApp.startSync(render, 'syncTasks');
})();
