(function(){
  TaskHiveAuth.requireAuth();
  TaskHiveApp.initShell('notes');
  TaskHiveApp.startGlobalWidgets();
  let notes = [];
  let searchQuery = '';

  let refreshing = false;
  async function refresh(){
    if (refreshing) return; // guard against overlapping requests if one tick runs long
    refreshing = true;
    const res = await TaskHiveAPI.call('listNotes', {});
    refreshing = false;
    if (res.success){ notes = res.data; render(); }
  }

  function render(){
    let list = notes;
    if (searchQuery) list = list.filter(n => (n.Title+n.Content).toLowerCase().includes(searchQuery));
    document.getElementById('notes-list').innerHTML = list.length ? list.map(n => `
      <div class="col-md-6 col-xl-4"><div class="card h-100">
        <h5>${TaskHiveApp.esc(n.Title)}</h5>
        <p class="small" style="white-space:pre-wrap;">${TaskHiveApp.esc(n.Content)}</p>
        <div class="text-muted small mt-auto mb-2">${new Date(n.UpdatedAt).toLocaleString()}</div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-honey edit-note" data-id="${n.NoteID}"><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="btn btn-sm btn-danger del-note" data-id="${n.NoteID}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div></div>`).join('') : '<div class="col-12"><div class="empty-state"><i class="fa-solid fa-note-sticky"></i>No notes yet.</div></div>';

    document.querySelectorAll('.edit-note').forEach(b => b.onclick = () => openEdit(notes.find(n=>n.NoteID===b.dataset.id)));
    document.querySelectorAll('.del-note').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this note?')) return;
      await TaskHiveAPI.call('deleteNote', {noteId:b.dataset.id});
      TaskHiveApp.toast('Note deleted.');
      refresh();
    });
  }

  document.getElementById('new-note-btn').onclick = () => {
    document.getElementById('note-form').reset();
    document.getElementById('nf-note-id').value = '';
    document.getElementById('nf-delete-btn').classList.add('d-none');
    document.getElementById('note-modal-title').textContent = 'New Note';
    new bootstrap.Modal(document.getElementById('note-modal')).show();
  };

  function openEdit(n){
    document.getElementById('nf-note-id').value = n.NoteID;
    document.getElementById('nf-title').value = n.Title;
    document.getElementById('nf-content').value = n.Content;
    document.getElementById('nf-delete-btn').classList.remove('d-none');
    document.getElementById('nf-delete-btn').onclick = async () => {
      if (!confirm('Delete this note?')) return;
      await TaskHiveAPI.call('deleteNote', {noteId:n.NoteID});
      TaskHiveApp.toast('Note deleted.');
      bootstrap.Modal.getInstance(document.getElementById('note-modal')).hide();
      refresh();
    };
    document.getElementById('note-modal-title').textContent = 'Edit Note';
    new bootstrap.Modal(document.getElementById('note-modal')).show();
  }

  document.getElementById('note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('nf-note-id').value;
    const payload = {title: document.getElementById('nf-title').value.trim(), content: document.getElementById('nf-content').value};
    if (!payload.title) return TaskHiveApp.toast('Title is required.', 'error');
    let res;
    if (id){ payload.noteId = id; res = await TaskHiveAPI.call('editNote', payload); }
    else res = await TaskHiveAPI.call('createNote', payload);
    if (res.success){ TaskHiveApp.toast('Note saved successfully.'); bootstrap.Modal.getInstance(document.getElementById('note-modal')).hide(); refresh(); }
    else TaskHiveApp.toast(res.error || 'Unable to save note.', 'error');
  });

  document.getElementById('notes-search').addEventListener('input', e => { searchQuery = e.target.value.trim().toLowerCase(); render(); });

  refresh();
  setInterval(refresh, 5000);
})();
