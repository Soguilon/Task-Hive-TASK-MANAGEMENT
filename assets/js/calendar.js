(function(){
  TaskHiveAuth.requireAuth();
  TaskHiveApp.initShell('calendar');
  const user = TaskHiveAuth.getUser();
  let viewDate = new Date();
  let latestData = null;
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  document.getElementById('cal-headers').innerHTML = DAY_NAMES.map(d => `<div class="fw-bold text-center small">${d}</div>`).join('');

  document.getElementById('cal-prev').onclick = () => { viewDate.setMonth(viewDate.getMonth()-1); renderCalendar(); };
  document.getElementById('cal-next').onclick = () => { viewDate.setMonth(viewDate.getMonth()+1); renderCalendar(); };
  document.getElementById('new-event-btn').onclick = () => openEventModal(null, todayStr());

  function todayStr(){ return new Date().toISOString().slice(0,10); }

  function populateParticipants(members){
    document.getElementById('ef-participants').innerHTML = members.map(m => `<option value="${m.UserID}">${TaskHiveApp.esc(m.DisplayName)}</option>`).join('');
  }

  function openEventModal(ev, dateStr){
    document.getElementById('event-form').reset();
    document.getElementById('ef-delete-btn').classList.toggle('d-none', !ev);
    if (ev){
      document.getElementById('event-modal-title').textContent = 'Edit Event';
      document.getElementById('ef-event-id').value = ev.EventID;
      document.getElementById('ef-title').value = ev.Title;
      document.getElementById('ef-desc').value = ev.Description;
      document.getElementById('ef-date').value = (ev.Date||'').slice(0,10);
      document.getElementById('ef-start').value = ev.StartTime;
      document.getElementById('ef-end').value = ev.EndTime;
      const parts = (ev.Participants||'').split(',');
      [...document.getElementById('ef-participants').options].forEach(o => o.selected = parts.includes(o.value));
      document.getElementById('ef-delete-btn').onclick = async () => {
        if (!confirm('Delete this event?')) return;
        await TaskHiveAPI.call('deleteCalendarEvent', {eventId: ev.EventID});
        TaskHiveApp.toast('Event deleted.');
        bootstrap.Modal.getInstance(document.getElementById('event-modal')).hide();
      };
    } else {
      document.getElementById('event-modal-title').textContent = 'New Event';
      document.getElementById('ef-event-id').value = '';
      document.getElementById('ef-date').value = dateStr || todayStr();
    }
    new bootstrap.Modal(document.getElementById('event-modal')).show();
  }

  document.getElementById('event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('ef-event-id').value;
    const payload = {
      title: document.getElementById('ef-title').value.trim(),
      description: document.getElementById('ef-desc').value,
      date: document.getElementById('ef-date').value,
      startTime: document.getElementById('ef-start').value,
      endTime: document.getElementById('ef-end').value,
      participants: [...document.getElementById('ef-participants').selectedOptions].map(o=>o.value)
    };
    if (!payload.title || !payload.date) return TaskHiveApp.toast('Title and date are required.', 'error');
    let res;
    if (id){ payload.eventId = id; res = await TaskHiveAPI.call('editCalendarEvent', payload); }
    else res = await TaskHiveAPI.call('createCalendarEvent', payload);
    if (res.success){ TaskHiveApp.toast('Event created successfully.'); bootstrap.Modal.getInstance(document.getElementById('event-modal')).hide(); }
    else TaskHiveApp.toast(res.error || 'Unable to save event.', 'error');
  });

  function renderCalendar(){
    if (!latestData) return;
    const year = viewDate.getFullYear(), month = viewDate.getMonth();
    document.getElementById('cal-title').textContent = viewDate.toLocaleString('default',{month:'long', year:'numeric'});
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const events = latestData.calendarEvents || [];
    const today = todayStr();
    let cells = [];
    for (let i=firstDay-1;i>=0;i--) cells.push({day: prevDays-i, other:true});
    for (let d=1; d<=daysInMonth; d++) cells.push({day:d, other:false, dateStr: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`});
    while (cells.length % 7 !== 0) cells.push({day: cells.length, other:true});

    document.getElementById('cal-grid').innerHTML = cells.map(c => {
      if (c.other) return `<div class="cal-day other-month"><div class="day-num">${c.day}</div></div>`;
      const dayEvents = events.filter(e => (e.Date||'').slice(0,10) === c.dateStr);
      const isToday = c.dateStr === today;
      return `<div class="cal-day ${isToday?'today':''}" data-date="${c.dateStr}">
        <div class="day-num">${c.day}</div>
        ${dayEvents.slice(0,3).map(e => `<span class="ev-dot" data-id="${e.EventID}" title="${TaskHiveApp.esc(e.Title)}">${TaskHiveApp.esc(e.Title)}</span>`).join('')}
      </div>`;
    }).join('');

    document.querySelectorAll('.cal-day[data-date]').forEach(el => {
      el.onclick = (ev) => {
        if (ev.target.classList.contains('ev-dot')) {
          const found = events.find(e => e.EventID === ev.target.dataset.id);
          openEventModal(found, el.dataset.date);
        } else {
          openEventModal(null, el.dataset.date);
        }
      };
    });
  }

  TaskHiveApp.startSync((data) => { latestData = data; populateParticipants(data.members); renderCalendar(); }, 'syncCalendar');
})();
