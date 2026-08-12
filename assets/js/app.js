/* ============================================================
   TASKHIVE — Application Shell, Theme, Central Sync Engine
   ============================================================ */
const TaskHiveApp = (function(){
  const state = { data:null, listeners:[], syncTimer:null, syncing:false };

  const NAV_ADMIN = [
    {href:'pages/dashboard.html', icon:'fa-gauge-high', label:'Dashboard'},
    {href:'pages/tasks.html', icon:'fa-list-check', label:'Task Review'},
    {href:'pages/members.html', icon:'fa-users', label:'Members'},
    {href:'pages/calendar.html', icon:'fa-calendar-days', label:'Calendar'},
    {href:'pages/meetings.html', icon:'fa-handshake', label:'Meetings'},
    {href:'pages/discussions.html', icon:'fa-comments', label:'Discussions'},
    {href:'pages/activity.html', icon:'fa-clock-rotate-left', label:'Activity Log'},
    {href:'pages/archive.html', icon:'fa-box-archive', label:'Archive'},
    {href:'pages/trash.html', icon:'fa-trash', label:'Trash'}
  ];
  const NAV_MEMBER = [
    {href:'pages/dashboard.html', icon:'fa-gauge-high', label:'Dashboard'},
    {href:'pages/tasks.html', icon:'fa-list-check', label:'My Tasks'},
    {href:'pages/calendar.html', icon:'fa-calendar-days', label:'Calendar'},
    {href:'pages/meetings.html', icon:'fa-handshake', label:'Meetings'},
    {href:'pages/discussions.html', icon:'fa-comments', label:'Discussions'},
    {href:'pages/notes.html', icon:'fa-note-sticky', label:'My Notes'}
  ];

  function esc(s){
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function initShell(activePage){
    const user = TaskHiveAuth.getUser();
    if (!user) return;
    const base = TaskHiveAuth.getBasePath();
    const nav = user.Role === 'Admin' ? NAV_ADMIN : NAV_MEMBER;
    const logoPath = base + 'TaskHiveLogo.png';

    const navHtml = nav.map(n => {
      const href = base + n.href;
      const isActive = activePage === n.href.split('/').pop().replace('.html','');
      return `<a href="${href}" class="${isActive?'active':''}"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span></a>`;
    }).join('');

    document.getElementById('th-sidebar').innerHTML = `
      <div class="brand">
        <img src="${logoPath}" alt="TaskHive" onerror="this.style.display='none'">
        <span>TaskHive</span>
      </div>
      <nav class="th-nav">${navHtml}</nav>
      <div class="user-box">
        <div class="name">${esc(user.DisplayName)}</div>
        <div class="role">${esc(user.Role)}</div>
        <button class="btn btn-outline-brut btn-sm logout-btn" id="th-logout-btn"><i class="fa-solid fa-arrow-right-from-bracket"></i> Logout</button>
      </div>`;

    document.getElementById('th-topbar').innerHTML = `
      <button class="th-hamburger btn btn-outline-brut btn-sm" id="th-hamburger"><i class="fa-solid fa-bars"></i></button>
      <div class="search-box">
        <input type="text" class="form-control form-control-sm" id="th-global-search" placeholder="Search tasks, members...">
      </div>
      <div class="spacer"></div>
      <button class="theme-toggle" id="th-theme-toggle" title="Toggle theme"><i class="fa-solid fa-moon"></i></button>
      <div class="dropdown">
        <button class="btn btn-outline-brut btn-sm position-relative" id="th-notif-btn" data-bs-toggle="dropdown">
          <i class="fa-solid fa-bell"></i>
          <span class="badge bg-danger rounded-pill position-absolute top-0 start-100 translate-middle d-none" id="th-notif-count">0</span>
        </button>
        <div class="dropdown-menu dropdown-menu-end p-2 th-notif-dropdown" id="th-notif-list">
          <div class="text-muted small p-2">No notifications</div>
        </div>
      </div>`;

    document.getElementById('th-logout-btn').onclick = () => TaskHiveAuth.logout();
    document.getElementById('th-hamburger').onclick = () => {
      document.getElementById('th-sidebar').classList.toggle('open');
      document.getElementById('th-overlay').classList.toggle('show');
    };
    document.getElementById('th-overlay').onclick = () => {
      document.getElementById('th-sidebar').classList.remove('open');
      document.getElementById('th-overlay').classList.remove('show');
    };

    initTheme();
    document.getElementById('th-global-search').addEventListener('input', e => onGlobalSearch(e.target.value));
  }

  function initTheme(){
    const saved = localStorage.getItem('th_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
    document.getElementById('th-theme-toggle').onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('th_theme', next);
      updateThemeIcon(next);
    };
  }
  function updateThemeIcon(theme){
    const btn = document.getElementById('th-theme-toggle');
    if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }

  function onGlobalSearch(query){
    query = query.trim().toLowerCase();
    document.dispatchEvent(new CustomEvent('th:search', {detail:{query}}));
  }

  /* ---------------- Toasts ---------------- */
  function ensureToastContainer(){
    let c = document.getElementById('th-toast-container');
    if (!c){
      c = document.createElement('div');
      c.id = 'th-toast-container';
      c.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      c.style.zIndex = 1080;
      document.body.appendChild(c);
    }
    return c;
  }
  function toast(message, type){
    type = type || 'success';
    const icons = {success:'fa-circle-check', error:'fa-circle-exclamation', warning:'fa-triangle-exclamation', info:'fa-circle-info'};
    const colors = {success:'var(--th-success)', error:'var(--th-danger)', warning:'var(--th-honey-dark)', info:'var(--th-blue)'};
    const c = ensureToastContainer();
    const el = document.createElement('div');
    el.className = 'toast-th p-3 mb-2 d-flex align-items-center gap-2';
    el.style.minWidth = '260px';
    el.innerHTML = `<i class="fa-solid ${icons[type]}" style="color:${colors[type]}"></i><span>${esc(message)}</span>`;
    c.appendChild(el);
    setTimeout(() => { el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(), 300); }, 3500);
  }

  /* ---------------- Central Sync Engine (every 2s) ----------------
     Each page passes its own page-specific sync action (syncTasks,
     syncDiscussions, syncCalendar, syncMeetings, syncMembers,
     syncDashboard) so the API only returns the datasets that page
     actually needs, instead of the old one-size-fits-all syncAll.
     The 2000ms interval and the single-in-flight-request guard
     (state.syncing) are unchanged - this keeps exactly one automatic
     sync cycle per page and prevents overlapping/duplicate requests.
     notifications and calendarEvents are included in every targeted
     action on the backend, so the notif bell and "today's events"
     reminder toast below keep working on every page exactly as
     before. action defaults to 'syncAll' for safety if a caller
     forgets to pass one. */
  function startSync(onData, action){
    action = action || 'syncAll';
    state.listeners.push(onData);
    if (state.syncTimer) return; // already running
    const tick = async () => {
      if (state.syncing) return;
      state.syncing = true;
      const res = await TaskHiveAPI.call(action, {});
      state.syncing = false;
      if (res.success){
        state.data = res.data;
        if (res.data.notifications) renderNotifDropdown(res.data.notifications);
        if (res.data.calendarEvents) checkEventReminders(res.data.calendarEvents);
        state.listeners.forEach(fn => { try{ fn(res.data); }catch(e){ console.error(e); } });
      }
    };
    tick();
    state.syncTimer = setInterval(tick, 2000);
  }

  /* ---------------- Global widgets sync (Activity/Archive/Trash/Notes) ----------------
     Those four pages run their own independent refresh loop for their own
     content (actionSyncActivity / listArchive / listTrash / listNotes) and
     never call TaskHiveApp.startSync, so they never get notifications or
     calendarEvents and the bell/reminder toast never fire there. This is a
     second, separate 2000ms interval that ONLY drives the bell + reminder
     toast via the syncGlobalWidgets endpoint - it never overlaps with
     startSync (a page uses one or the other, never both), so no data is
     ever polled twice for the same page. */
  function startGlobalWidgets(){
    if (state.globalWidgetsTimer) return; // already running
    const tick = async () => {
      if (state.globalWidgetsSyncing) return; // guard against overlapping requests if one tick runs long
      state.globalWidgetsSyncing = true;
      const res = await TaskHiveAPI.call('syncGlobalWidgets', {});
      state.globalWidgetsSyncing = false;
      if (res.success){
        if (res.data.notifications) renderNotifDropdown(res.data.notifications);
        if (res.data.calendarEvents) checkEventReminders(res.data.calendarEvents);
      }
    };
    tick();
    state.globalWidgetsTimer = setInterval(tick, 2000);
  }

  function renderNotifDropdown(notifications){
    const list = document.getElementById('th-notif-list');
    const countEl = document.getElementById('th-notif-count');
    if (!list) return;
    const unread = notifications.filter(n => n.IsRead !== true && n.IsRead !== 'TRUE');
    if (countEl){
      if (unread.length){ countEl.textContent = unread.length; countEl.classList.remove('d-none'); }
      else { countEl.classList.add('d-none'); }
    }
    if (!notifications.length){ list.innerHTML = '<div class="text-muted small p-2">No notifications</div>'; return; }
    list.innerHTML = `<div class="d-flex justify-content-between align-items-center px-2 pb-2 border-bottom mb-2">
        <strong>Notifications</strong>
        <button class="btn btn-sm btn-outline-brut" id="th-mark-all-read">Mark all read</button>
      </div>` + notifications.slice(0,20).map(n => `
      <div class="p-2 mb-1 rounded ${n.IsRead===true||n.IsRead==='TRUE'?'':'bg-warning-subtle'}" style="border-bottom:1px solid var(--surface-2);cursor:pointer;" data-id="${n.NotificationID}">
        <div class="small">${esc(n.Message)}</div>
        <div class="text-muted" style="font-size:.7rem;">${new Date(n.CreatedAt).toLocaleString()}</div>
      </div>`).join('');
    const markAllBtn = document.getElementById('th-mark-all-read');
    if (markAllBtn) markAllBtn.onclick = async (e) => { e.stopPropagation(); await TaskHiveAPI.call('markAllNotificationsRead', {}); };
    list.querySelectorAll('[data-id]').forEach(el => {
      el.onclick = async () => { await TaskHiveAPI.call('markNotificationRead', {notificationId: el.dataset.id}); };
    });
  }

  /* ---------------- Calendar event-day reminders ---------------- */
  function checkEventReminders(events){
    const todayStr = new Date().toISOString().slice(0,10);
    const shown = JSON.parse(localStorage.getItem('th_shown_reminders') || '{}');
    const todaysEvents = (events||[]).filter(ev => (ev.Date||'').slice(0,10) === todayStr);
    todaysEvents.forEach(ev => {
      const key = ev.EventID + '_' + todayStr;
      if (!shown[key]){
        toast('Today: ' + ev.Title, 'info');
        shown[key] = true;
      }
    });
    // prune old keys
    Object.keys(shown).forEach(k => { if (!k.endsWith(todayStr) && Object.keys(shown).length > 200) delete shown[k]; });
    localStorage.setItem('th_shown_reminders', JSON.stringify(shown));
  }

  function multilineToList(text){
    if (!text) return '<span class="text-muted">No description</span>';
    const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '<span class="text-muted">No description</span>';
    return '<ul class="mb-0 ps-3">' + lines.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>';
  }

  function statusBadgeClass(status){
    const map = {'Active':'active','Completed':'approved','Not Started':'notstarted','In Progress':'inprogress','Submitted':'submitted','Approved':'approved','Needs Revision':'needsrevision','On Hold':'pending','Scheduled':'pending'};
    return 'badge-status-' + (map[status]||'pending').replace(/\s/g,'').toLowerCase();
  }
  function priorityBadgeClass(p){ return 'badge-priority-' + (p||'medium').toLowerCase(); }

  return { initShell, esc, toast, startSync, startGlobalWidgets, multilineToList, statusBadgeClass, priorityBadgeClass, getState: () => state.data };
})();
