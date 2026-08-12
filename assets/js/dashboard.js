(function(){
  TaskHiveAuth.requireAuth();
  TaskHiveApp.initShell('dashboard');
  const user = TaskHiveAuth.getUser();
  const isAdmin = user.Role === 'Admin';
  document.getElementById('task-panel-title').textContent = isAdmin ? 'Tasks Overview' : 'Assigned Tasks';

  function render(data){
    const tasks = data.tasks;
    if (isAdmin){
      const stats = [
        {label:'Total Tasks', num: tasks.length, icon:'fa-list-check'},
        {label:'Pending Tasks', num: tasks.filter(t=>t.Status!=='Approved').length, icon:'fa-hourglass-half'},
        {label:'Overdue Tasks', num: tasks.filter(t=>t.Deadline && new Date(t.Deadline) < new Date() && t.Status!=='Approved').length, icon:'fa-triangle-exclamation'},
        {label:'Total Members', num: data.members.length, icon:'fa-users'},
        {label:'Completed Tasks', num: tasks.filter(t=>t.Status==='Approved').length, icon:'fa-check-double'}
      ];
      document.getElementById('stat-cards').innerHTML = stats.map(s => `
        <div class="col-6 col-lg-3"><div class="stat-card"><i class="fa-solid ${s.icon} mb-1"></i><div class="num">${s.num}</div><div class="label">${s.label}</div></div></div>`).join('');
    } else {
      const upcoming = (data.calendarEvents||[]).filter(e=>new Date(e.Date) >= new Date(new Date().toDateString())).sort((a,b)=>new Date(a.Date)-new Date(b.Date)).slice(0,3);
      const stats = [
        {label:'Assigned Tasks', num: tasks.length, icon:'fa-list-check'},
        {label:'Pending Tasks', num: tasks.filter(t=>t.Status!=='Approved').length, icon:'fa-hourglass-half'},
        {label:'Upcoming Events', num: upcoming.length, icon:'fa-calendar-days'}
      ];
      document.getElementById('stat-cards').innerHTML = stats.map(s => `
        <div class="col-6 col-lg-3"><div class="stat-card"><i class="fa-solid ${s.icon} mb-1"></i><div class="num">${s.num}</div><div class="label">${s.label}</div></div></div>`).join('');
    }

    document.getElementById('dash-tasks').innerHTML = tasks.length ? tasks.slice(0,5).map(t => `
      <div class="mb-2 pb-2 border-bottom d-flex justify-content-between align-items-center">
        <div><strong>${TaskHiveApp.esc(t.TaskTitle)}</strong><div class="text-muted small">${TaskHiveApp.esc(t.Deadline||'No deadline')}</div></div>
        <span class="badge-th ${TaskHiveApp.statusBadgeClass(t.Status)}">${TaskHiveApp.esc(t.Status)}</span>
      </div>`).join('') : '<div class="empty-state"><i class="fa-solid fa-inbox"></i>No tasks yet.</div>';

    document.getElementById('dash-discussions').innerHTML = data.discussions.length ? data.discussions.slice(-4).reverse().map(d => `
      <div class="discussion-msg"><span class="sender">${TaskHiveApp.esc(d.SenderName)}</span> <span class="time">${new Date(d.CreatedAt).toLocaleString()}</span><div>${TaskHiveApp.esc(d.Message)}</div></div>`).join('') : '<div class="empty-state"><i class="fa-solid fa-comment-slash"></i>No messages yet.</div>';

    document.getElementById('dash-notifs').innerHTML = data.notifications.length ? data.notifications.slice(0,5).map(n => `
      <div class="mb-2 pb-2 border-bottom small">${TaskHiveApp.esc(n.Message)}<div class="text-muted" style="font-size:.7rem">${new Date(n.CreatedAt).toLocaleString()}</div></div>`).join('') : '<div class="empty-state"><i class="fa-solid fa-bell-slash"></i>No notifications.</div>';
  }

  TaskHiveApp.startSync(render, 'syncDashboard');
})();
