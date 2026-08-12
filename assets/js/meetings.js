(function(){
  TaskHiveAuth.requireAuth();
  TaskHiveApp.initShell('meetings');
  const isAdmin = TaskHiveAuth.isAdmin();
  if (isAdmin) document.getElementById('new-meeting-btn').classList.remove('d-none');

  function populateParticipants(members){
    document.getElementById('mf-participants').innerHTML = members.map(m => `<option value="${m.UserID}">${TaskHiveApp.esc(m.DisplayName)}</option>`).join('');
  }

  document.getElementById('new-meeting-btn').onclick = () => {
    document.getElementById('meeting-form').reset();
    document.getElementById('mf-meeting-id').value = '';
    document.getElementById('mf-delete-btn').classList.add('d-none');
    document.getElementById('meeting-modal-title').textContent = 'New Meeting';
    new bootstrap.Modal(document.getElementById('meeting-modal')).show();
  };

  function openEdit(m){
    document.getElementById('meeting-form').reset();
    document.getElementById('mf-meeting-id').value = m.MeetingID;
    document.getElementById('mf-title').value = m.Title;
    document.getElementById('mf-desc').value = m.Description;
    document.getElementById('mf-date').value = (m.Date||'').slice(0,10);
    document.getElementById('mf-time').value = m.Time;
    document.getElementById('mf-status').value = m.Status;
    const parts = (m.Participants||'').split(',');
    [...document.getElementById('mf-participants').options].forEach(o => o.selected = parts.includes(o.value));
    document.getElementById('mf-delete-btn').classList.remove('d-none');
    document.getElementById('mf-delete-btn').onclick = async () => {
      if (!confirm('Delete this meeting?')) return;
      await TaskHiveAPI.call('deleteMeeting', {meetingId:m.MeetingID});
      TaskHiveApp.toast('Meeting deleted.');
      bootstrap.Modal.getInstance(document.getElementById('meeting-modal')).hide();
    };
    document.getElementById('meeting-modal-title').textContent = 'Edit Meeting';
    new bootstrap.Modal(document.getElementById('meeting-modal')).show();
  }

  document.getElementById('meeting-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('mf-meeting-id').value;
    const payload = {
      title: document.getElementById('mf-title').value.trim(),
      description: document.getElementById('mf-desc').value,
      date: document.getElementById('mf-date').value,
      time: document.getElementById('mf-time').value,
      status: document.getElementById('mf-status').value,
      participants: [...document.getElementById('mf-participants').selectedOptions].map(o=>o.value)
    };
    if (!payload.title || !payload.date) return TaskHiveApp.toast('Title and date are required.', 'error');
    let res;
    if (id){ payload.meetingId = id; res = await TaskHiveAPI.call('editMeeting', payload); }
    else res = await TaskHiveAPI.call('createMeeting', payload);
    if (res.success){ TaskHiveApp.toast('Meeting saved successfully.'); bootstrap.Modal.getInstance(document.getElementById('meeting-modal')).hide(); }
    else TaskHiveApp.toast(res.error || 'Unable to save meeting.', 'error');
  });

  function render(data){
    populateParticipants(data.members);
    const memberMap = {}; data.members.forEach(m => memberMap[m.UserID] = m.DisplayName);
    document.getElementById('meetings-list').innerHTML = data.meetings.length ? data.meetings.map(m => `
      <div class="col-md-6 col-xl-4"><div class="card h-100">
        <div class="d-flex justify-content-between"><h5>${TaskHiveApp.esc(m.Title)}</h5><span class="badge-th ${TaskHiveApp.statusBadgeClass(m.Status)}">${TaskHiveApp.esc(m.Status)}</span></div>
        <div class="small text-muted mb-2"><i class="fa-solid fa-calendar"></i> ${TaskHiveApp.esc((m.Date||'').slice(0,10))} ${m.Time?('at '+TaskHiveApp.esc(m.Time)):''}</div>
        <p class="small">${TaskHiveApp.esc(m.Description)}</p>
        <div class="small text-muted mb-2">${(m.Participants||'').split(',').filter(Boolean).map(id=>TaskHiveApp.esc(memberMap[id]||id)).join(', ') || 'No participants'}</div>
        ${isAdmin ? `<button class="btn btn-sm btn-honey mt-auto edit-meeting" data-id="${m.MeetingID}"><i class="fa-solid fa-pen"></i> Edit</button>` : ''}
      </div></div>`).join('') : '<div class="col-12"><div class="empty-state"><i class="fa-solid fa-handshake"></i>No meetings scheduled.</div></div>';

    document.querySelectorAll('.edit-meeting').forEach(b => b.onclick = () => openEdit(data.meetings.find(m=>m.MeetingID===b.dataset.id)));
  }

  TaskHiveApp.startSync(render, 'syncMeetings');
})();
