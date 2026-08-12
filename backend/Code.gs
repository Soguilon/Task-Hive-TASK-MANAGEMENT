/************************************************************
 * TASKHIVE BACKEND — Google Apps Script
 * Sheets DB + REST-style API via doGet/doPost
 ************************************************************/

/* TASKHIVE7 -> TASKHIVE8 READ-OPTIMIZATION AUDIT (no functional changes)
   ------------------------------------------------------------
   Audited every getDataRange()/getValues()/getRange()/getLastRow()/
   sheetToObjects() call site in this file. Findings:

   - All data reads funnel through sheetToObjects(name), which is
     memoized per-request in __sheetCache (reset at the top of every
     handle() call). No sheet is read from twice within one request,
     regardless of how many helpers (findOneById, listMembers,
     verifyToken, updateRowById, deleteRowById, etc.) touch it.
   - getSheetByName() lookups are likewise deduped per-request via
     __sheetObjCache.
   - Every page already has a trimmed syncX endpoint returning only the
     datasets that page renders; todaysCalendarEvents() already filters
     CalendarEvents server-side for pages that only need today's rows.
   - The one raw getDataRange().getValues() outside sheetToObjects()
     (actionMarkAllRead) is intentional: it needs the raw row array to
     do a single bulk column write, and isn't preceded by another
     Notifications read in the same request, so it isn't a duplicate.

   Conclusion: there is no further sheet read to safely eliminate.
   Narrowing to fewer rows/columns per call would require either
   assuming row order/ID sequence (disallowed) or adding an index/
   second data structure (disallowed - no new DB). Both were rejected
   as unsafe or out of scope rather than implemented speculatively.
   No lines below this block were changed from TaskHive7. */

const SS = SpreadsheetApp.getActiveSpreadsheet();
const SHEETS = {
  Users: ['UserID','Username','Password','DisplayName','Role','Status','CreatedAt'],
  Tasks: ['TaskID','ProjectID','TaskTitle','Description','AssignedMemberID','Priority','Status','Deadline','Progress','CreatedBy','CreatedAt','UpdatedAt','IsArchived','IsTrashed'],
  TaskLinks: ['LinkID','TaskID','Title','Description','URL','CreatedBy','CreatedAt','UpdatedAt'],
  Discussions: ['DiscussionID','UserID','Message','CreatedAt','UpdatedAt'],
  Notifications: ['NotificationID','UserID','Message','IsRead','CreatedAt','Link'],
  CalendarEvents: ['EventID','Title','Description','Date','StartTime','EndTime','Participants','CreatedBy','CreatedAt','UpdatedAt'],
  Meetings: ['MeetingID','Title','Description','Date','Time','Participants','Status','CreatedBy','CreatedAt','UpdatedAt'],
  Notes: ['NoteID','UserID','Title','Content','CreatedAt','UpdatedAt'],
  ActivityLog: ['LogID','UserID','Action','Details','CreatedAt'],
  Archive: ['ArchiveID','RecordType','RecordID','Snapshot','ArchivedBy','ArchivedAt'],
  Trash: ['TrashID','RecordType','RecordID','Snapshot','TrashedBy','TrashedAt']
};

/* ---------------- Setup ---------------- */
function setupDatabase() {
  Object.keys(SHEETS).forEach(function(name){
    var sheet = SS.getSheetByName(name);
    if (!sheet) sheet = SS.insertSheet(name);
    var headers = SHEETS[name];
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });
  seedAdmin();
  return 'Database initialized';
}

function seedAdmin(){
  var sheet = SS.getSheetByName('Users');
  var data = sheet.getDataRange().getValues();
  for (var i=1;i<data.length;i++){ if (data[i][1] === 'Sugoi') return; }
  sheet.appendRow([newId('U'), 'Sugoi', hashPassword('6401'), 'Sugoi', 'Admin', 'Active', nowIso()]);
}

/* ---------------- Utilities ---------------- */
function newId(prefix){ return prefix + '_' + Utilities.getUuid().replace(/-/g,'').substring(0,12); }
function nowIso(){ return new Date().toISOString(); }
function hashPassword(pw){ return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw + 'TH_SALT_2026')); }

/* Per-request cache: several actions (notably syncAll) read the same sheet
   more than once in a single execution (e.g. Users is read by verifyToken,
   listDiscussions, and listMembers). getDataRange().getValues() is the
   expensive call in this architecture, so memoizing it FOR THE DURATION OF
   ONE REQUEST removes duplicate reads without introducing any staleness -
   the cache is explicitly wiped at the top of every handle() invocation
   (see below), so nothing ever survives between requests. */
var __sheetCache = {};

/* Per-request cache of the actual Sheet objects too (not just their data).
   getSheetByName(name) was previously called separately inside
   sheetToObjects/appendRow/updateRowById/deleteRowById/actionMarkAllRead,
   so a single request touching e.g. Tasks multiple times (findOneById then
   updateRowById then logActivity->appendRow on a different sheet) still did
   several redundant getSheetByName('Tasks') lookups. This mirrors __sheetCache's
   lifecycle exactly - wiped at the top of every handle() call - so it can
   never leak a stale Sheet reference between requests. */
var __sheetObjCache = {};
function getSheetObj(name){
  if (!__sheetObjCache[name]) __sheetObjCache[name] = SS.getSheetByName(name);
  return __sheetObjCache[name];
}

function sheetToObjects(name){
  if (Object.prototype.hasOwnProperty.call(__sheetCache, name)) return __sheetCache[name];
  var sheet = getSheetObj(name);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var out = [];
  for (var i=1;i<values.length;i++){
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    headers.forEach(function(h,idx){ obj[h] = row[idx]; });
    obj._row = i+1;
    out.push(obj);
  }
  __sheetCache[name] = out;
  return out;
}

function appendRow(name, obj){
  var sheet = getSheetObj(name);
  var headers = SHEETS[name];
  var row = headers.map(function(h){ return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  delete __sheetCache[name]; // keep cache correct if this sheet is re-read later in the same request
  return obj;
}

/* updateRowById/deleteRowById used to always do their own fresh
   getDataRange().getValues() scan to find the target row, even though
   almost every call site does findOneById(...) (which populates
   __sheetCache via sheetToObjects) immediately beforehand on the same
   sheet - e.g. actionEditTask, actionApproveTask, actionEditMember, etc.
   That was a second full-table Sheets read for no reason. Both functions
   now go through sheetToObjects(name) - the same per-request cache
   everything else already uses - and reuse the _row index it already
   stores on every object, instead of re-reading the sheet. If nothing
   has cached this sheet yet this request, sheetToObjects() does exactly
   the one read it would have done anyway, so this is never worse than
   before, only sometimes better. */
function updateRowById(name, idField, idValue, patch){
  var sheet = getSheetObj(name);
  var headers = SHEETS[name];
  var rows = sheetToObjects(name);
  for (var i=0;i<rows.length;i++){
    if (rows[i][idField] === idValue){
      var rowNum = rows[i]._row;
      var current = rows[i];
      var rowValues = headers.map(function(h){ return patch[h] !== undefined ? patch[h] : current[h]; });
      sheet.getRange(rowNum, 1, 1, headers.length).setValues([rowValues]);
      delete __sheetCache[name]; // keep cache correct if this sheet is re-read later in the same request
      return true;
    }
  }
  return false;
}

function deleteRowById(name, idField, idValue){
  var sheet = getSheetObj(name);
  var rows = sheetToObjects(name);
  for (var i=0;i<rows.length;i++){
    if (rows[i][idField] === idValue){
      sheet.deleteRow(rows[i]._row);
      delete __sheetCache[name]; // keep cache correct if this sheet is re-read later in the same request
      return true;
    }
  }
  return false;
}

function findOneById(name, idField, idValue){
  var rows = sheetToObjects(name);
  for (var i=0;i<rows.length;i++){ if (rows[i][idField] === idValue) return rows[i]; }
  return null;
}

function logActivity(userId, action, details){
  appendRow('ActivityLog', {LogID:newId('LOG'), UserID:userId, Action:action, Details:details||'', CreatedAt:nowIso()});
}

function pushNotification(userId, message, link){
  appendRow('Notifications', {NotificationID:newId('N'), UserID:userId, Message:message, IsRead:false, CreatedAt:nowIso(), Link:link||''});
}

function moveToArchive(type, id, snapshot, by){
  appendRow('Archive', {ArchiveID:newId('ARC'), RecordType:type, RecordID:id, Snapshot:JSON.stringify(snapshot), ArchivedBy:by, ArchivedAt:nowIso()});
}
function moveToTrash(type, id, snapshot, by){
  appendRow('Trash', {TrashID:newId('TRS'), RecordType:type, RecordID:id, Snapshot:JSON.stringify(snapshot), TrashedBy:by, TrashedAt:nowIso()});
}

/* Simple session token: base64(userId:role:randomSecretCheck) validated against Users sheet */
function makeToken(user){
  return Utilities.base64Encode(JSON.stringify({u:user.UserID, r:user.Role, t: nowIso()}));
}
function verifyToken(token){
  try{
    var data = JSON.parse(Utilities.base64Decode(token, Utilities.Charset.UTF_8).map ? '' : '');
  }catch(e){}
  try{
    var json = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    var obj = JSON.parse(json);
    var user = findOneById('Users','UserID', obj.u);
    if (!user || user.Status !== 'Active') return null;
    return user;
  }catch(e){ return null; }
}

function safeStr(s){
  if (s === undefined || s === null) return '';
  return String(s).replace(/[<>&"'`]/g, function(c){
    return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c];
  });
}

function validUrl(url){
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}

/* ---------------- Entry points ---------------- */
function doGet(e){
  return handle(e);
}
function doPost(e){
  return handle(e);
}

function handle(e){
  __sheetCache = {}; // hard reset every request - guarantees no data can ever survive between separate API calls
  __sheetObjCache = {}; // same guarantee for the cached Sheet object references
  var out;
  try{
    var params = {};
    if (e.postData && e.postData.contents){
      params = JSON.parse(e.postData.contents);
    } else if (e.parameter){
      params = e.parameter;
    }
    var action = params.action;
    var token = params.token;
    var user = null;
    if (action !== 'login'){
      user = verifyToken(token);
      if (!user) return respond({success:false, error:'Unauthorized. Please log in again.'});
    }
    out = routeAction(action, params, user);
  }catch(err){
    out = {success:false, error: 'Server error: ' + err.message};
  }
  return respond(out);
}

function respond(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- Router ---------------- */
function routeAction(action, p, user){
  var lock = LockService.getScriptLock();
  switch(action){
    case 'login': return actionLogin(p);
    case 'logout': return actionLogout(user);
    case 'syncAll': return actionSyncAll(user);
    case 'syncDashboard': return actionSyncDashboard(user);
    case 'syncTasks': return actionSyncTasks(user);
    case 'syncDiscussions': return actionSyncDiscussions(user);
    case 'syncCalendar': return actionSyncCalendar(user);
    case 'syncMeetings': return actionSyncMeetings(user);
    case 'syncMembers': return actionSyncMembersPage(user);
    case 'syncNotifications': return actionSyncNotifications(user);
    case 'syncCalendarReminder': return actionSyncCalendarReminder(user);
    case 'syncGlobalWidgets': return actionSyncGlobalWidgets(user);

    case 'listMembers': return {success:true, data: listMembers()};
    case 'addMember': requireAdmin(user); return actionAddMember(p, user);
    case 'editMember': requireAdmin(user); return actionEditMember(p, user);
    case 'deactivateMember': requireAdmin(user); return actionSetMemberStatus(p, user, 'Inactive');
    case 'reactivateMember': requireAdmin(user); return actionSetMemberStatus(p, user, 'Active');
    case 'removeMember': requireAdmin(user); return actionRemoveMember(p, user);

    case 'createTask': requireAdmin(user); lock.waitLock(15000); try{ return actionCreateTask(p, user);}finally{lock.releaseLock();}
    case 'editTask': return actionEditTask(p, user);
    case 'deleteTask': requireAdmin(user); return actionDeleteTask(p, user);
    case 'listTasks': return {success:true, data: listTasksFor(user)};
    case 'submitTask': return actionSubmitTask(p, user);
    case 'approveTask': requireAdmin(user); return actionApproveTask(p, user);
    case 'requestRevision': requireAdmin(user); return actionRequestRevision(p, user);
    case 'addTaskLink': requireAdmin(user); return actionAddLink('TaskLinks','TaskID', p, user);
    case 'editTaskLink': requireAdmin(user); return actionEditLink('TaskLinks', p, user);
    case 'deleteTaskLink': requireAdmin(user); return actionDeleteLink('TaskLinks', p, user);

    case 'listDiscussions': return {success:true, data: listDiscussions()};
    case 'sendDiscussion': return actionSendDiscussion(p, user);

    case 'listNotifications': return {success:true, data: listNotificationsFor(user)};
    case 'markNotificationRead': return actionMarkRead(p, user);
    case 'markAllNotificationsRead': return actionMarkAllRead(user);

    case 'listCalendarEvents': return {success:true, data: listCalendarEvents()};
    case 'createCalendarEvent': return actionCreateEvent(p, user);
    case 'editCalendarEvent': return actionEditEvent(p, user);
    case 'deleteCalendarEvent': return actionDeleteEvent(p, user);

    case 'listMeetings': return {success:true, data: sheetToObjects('Meetings')};
    case 'createMeeting': requireAdmin(user); return actionCreateMeeting(p, user);
    case 'editMeeting': requireAdmin(user); return actionEditMeeting(p, user);
    case 'deleteMeeting': requireAdmin(user); return actionDeleteMeeting(p, user);

    case 'listNotes': return {success:true, data: listNotesFor(user)};
    case 'createNote': return actionCreateNote(p, user);
    case 'editNote': return actionEditNote(p, user);
    case 'deleteNote': return actionDeleteNote(p, user);

    case 'listActivity': return {success:true, data: sheetToObjects('ActivityLog').reverse()};
    case 'syncActivity': return actionSyncActivity();
    case 'listArchive': return {success:true, data: sheetToObjects('Archive').reverse()};
    case 'listTrash': return {success:true, data: sheetToObjects('Trash').reverse()};
    case 'restoreFromTrash': requireAdmin(user); return actionRestoreFromTrash(p, user);
    case 'permanentlyDelete': requireAdmin(user); return actionPermanentDelete(p, user);

    default: return {success:false, error:'Unknown action: ' + action};
  }
}

function requireAdmin(user){
  if (!user || user.Role !== 'Admin') throw new Error('Forbidden: Admin permission required.');
}

/* ---------------- Auth ---------------- */
function actionLogin(p){
  var users = sheetToObjects('Users');
  var hashed = hashPassword(p.password || '');
  for (var i=0;i<users.length;i++){
    if (users[i].Username === p.username && users[i].Password === hashed){
      if (users[i].Status !== 'Active') return {success:false, error:'Account is deactivated.'};
      var token = makeToken(users[i]);
      logActivity(users[i].UserID, users[i].Role + ' logged in', 'Successful login');
      return {success:true, data:{token:token, user:{UserID:users[i].UserID, Username:users[i].Username, DisplayName:users[i].DisplayName, Role:users[i].Role}}};
    }
  }
  return {success:false, error:'Invalid username or password.'};
}

function actionLogout(user){
  logActivity(user.UserID, user.Role + ' logged out', 'Successful logout');
  return {success:true};
}

/* ---------------- Sync ---------------- */
/* actionSyncAll is kept as the original, unmodified full-payload sync.
   It is retained as a fallback per the migration plan below and is no
   longer called by any page's frontend JS (verified by search across
   assets/js/*.js) - every page now uses one of the page-specific
   syncX actions below, each of which returns only the datasets that
   page's rendering code (and the shared notification bell / calendar
   reminder toast, which run on every page that starts the sync loop)
   actually reads. TaskHiveApp.startSync's tick() always feeds
   res.data.notifications / res.data.calendarEvents into the global
   notif dropdown and the "today's events" reminder toast, regardless of
   which page is active - omitting them entirely from a page's payload
   would silently break the bell/reminders on that page, so every action
   below still includes both fields, but each is now as cheap as
   possible for that page:
     - notifications is already filtered to the authenticated user
       (listNotificationsFor), so it was never the expensive part.
     - calendarEvents is the one that used to cost real payload/parse
       time on pages that don't render a calendar - Tasks, Discussions,
       Members and Meetings now send todaysCalendarEvents() (just the
       rows matching today, usually 0-3 records) instead of the entire
       CalendarEvents table, since checkEventReminders() on the client
       only ever looks at today's rows anyway. Dashboard keeps the full
       table because its member view computes an "upcoming events"
       stat over more than just today, and Calendar keeps the full
       table because that's the page's actual content. See
       actionSyncNotifications / actionSyncCalendarReminder further
       down for these two concerns pulled out as standalone endpoints. */
function actionSyncAll(user){
  return {success:true, data:{
    tasks: listTasksFor(user),
    discussions: listDiscussions(),
    notifications: listNotificationsFor(user),
    calendarEvents: listCalendarEvents(),
    meetings: sheetToObjects('Meetings'),
    members: listMembers(),
    serverTime: nowIso()
  }};
}

function actionSyncDashboard(user){
  // dashboard.js reads tasks, members, discussions, notifications and
  // calendarEvents (upcoming-events stat for members) - only meetings
  // is unused, so that's the one dataset this trims versus syncAll.
  return {success:true, data:{
    tasks: listTasksFor(user),
    members: listMembers(),
    discussions: listDiscussions(),
    notifications: listNotificationsFor(user),
    calendarEvents: listCalendarEvents(),
    serverTime: nowIso()
  }};
}

function actionSyncTasks(user){
  // tasks.js reads data.tasks and data.members (assignee dropdown +
  // name lookup). discussions and meetings are never touched. This page
  // never renders a calendar, so calendarEvents here is ONLY for the
  // global reminder toast in app.js - trimmed to today's rows instead of
  // the full CalendarEvents table (see todaysCalendarEvents()).
  return {success:true, data:{
    tasks: listTasksFor(user),
    members: listMembers(),
    notifications: listNotificationsFor(user),
    calendarEvents: todaysCalendarEvents(),
    serverTime: nowIso()
  }};
}

function actionSyncDiscussions(user){
  // discussions.js only reads data.discussions (SenderName is already
  // resolved server-side inside listDiscussions()). tasks/meetings/
  // members are never touched by this page. calendarEvents is trimmed to
  // today's rows for the same reason as actionSyncTasks above.
  return {success:true, data:{
    discussions: listDiscussions(),
    notifications: listNotificationsFor(user),
    calendarEvents: todaysCalendarEvents(),
    serverTime: nowIso()
  }};
}

function actionSyncCalendar(user){
  // calendar.js reads data.calendarEvents and data.members (event
  // participant dropdown). tasks/discussions/meetings are unused.
  return {success:true, data:{
    calendarEvents: listCalendarEvents(),
    members: listMembers(),
    notifications: listNotificationsFor(user),
    serverTime: nowIso()
  }};
}

function actionSyncMeetings(user){
  // meetings.js reads data.meetings and data.members (participant
  // names/dropdown). tasks/discussions are unused. calendarEvents is
  // trimmed to today's rows - this page never reads it, it's only here
  // for the global reminder toast.
  return {success:true, data:{
    meetings: sheetToObjects('Meetings'),
    members: listMembers(),
    notifications: listNotificationsFor(user),
    calendarEvents: todaysCalendarEvents(),
    serverTime: nowIso()
  }};
}

function actionSyncMembersPage(user){
  // members.js only reads data.members. tasks/discussions/meetings
  // are unused. calendarEvents is trimmed to today's rows - see above.
  return {success:true, data:{
    members: listMembers(),
    notifications: listNotificationsFor(user),
    calendarEvents: todaysCalendarEvents(),
    serverTime: nowIso()
  }};
}

/* Standalone lightweight actions. Not currently wired into any page's
   central 2s tick (every page above already gets a cheap, user-filtered
   notifications list and a trimmed calendarEvents list inline, at no
   extra request cost), but exposed here as real, callable, minimal
   endpoints per the notifications/calendar-reminder separation requested
   - and available for any future page/widget that wants just one of
   these without pulling in page-specific data. */
function actionSyncNotifications(user){
  // Only this user's notifications (already filtered server-side by the
  // authenticated identity from verifyToken - never by a client-supplied
  // user id). No tasks/discussions/calendar/meetings/members included.
  return {success:true, data:{
    notifications: listNotificationsFor(user),
    serverTime: nowIso()
  }};
}
function actionSyncCalendarReminder(user){
  // Only today's calendar events - not the whole CalendarEvents table.
  return {success:true, data:{
    calendarEvents: todaysCalendarEvents(),
    serverTime: nowIso()
  }};
}

/* Activity/Archive/Trash/Notes have their own page-specific refresh loops
   (actionSyncActivity, listArchive, listTrash, listNotes) that intentionally
   do NOT include notifications/calendarEvents, since none of those four
   pages read them. But that also means those four pages never call any of
   the syncX actions that TaskHiveApp.startSync uses to feed the global
   notification bell and "today's events" reminder toast - so on TaskHive4
   as shipped, the bell simply sits at "No notifications" and never updates
   on Activity/Archive/Trash/Notes until the user navigates to a page that
   does carry that data. This single combined action is the fix: it just
   calls the two already-existing lightweight endpoints above and merges
   their output, so those four pages can drive the bell/reminder toast with
   one extra request per tick, without duplicating or resizing anything
   those pages already fetch for their own content. */
function actionSyncGlobalWidgets(user){
  var n = actionSyncNotifications(user);
  var c = actionSyncCalendarReminder(user);
  return {success:true, data:{
    notifications: n.data.notifications,
    calendarEvents: c.data.calendarEvents,
    serverTime: nowIso()
  }};
}

/* ---------------- Members ---------------- */
function listMembers(){
  return sheetToObjects('Users').map(function(u){ return {UserID:u.UserID, Username:u.Username, DisplayName:u.DisplayName, Role:u.Role, Status:u.Status, CreatedAt:u.CreatedAt}; });
}
function actionAddMember(p, user){
  if (!p.username || !p.displayName || !p.password) return {success:false, error:'Username, display name, and password are required.'};
  var existing = sheetToObjects('Users').filter(function(u){ return u.Username === p.username; });
  if (existing.length) return {success:false, error:'Username already exists.'};
  var obj = {UserID:newId('U'), Username:safeStr(p.username), Password:hashPassword(p.password), DisplayName:safeStr(p.displayName), Role: p.role === 'Admin' ? 'Admin':'Member', Status:'Active', CreatedAt:nowIso()};
  appendRow('Users', obj);
  logActivity(user.UserID, 'Member added', obj.DisplayName);
  return {success:true, data:obj};
}
function actionEditMember(p, user){
  var patch = {};
  if (p.displayName) patch.DisplayName = safeStr(p.displayName);
  if (p.role) patch.Role = p.role;
  if (p.password) patch.Password = hashPassword(p.password);
  updateRowById('Users','UserID', p.userId, patch);
  logActivity(user.UserID, 'Member updated', p.userId);
  return {success:true};
}
function actionSetMemberStatus(p, user, status){
  updateRowById('Users','UserID', p.userId, {Status:status});
  logActivity(user.UserID, 'Member ' + status.toLowerCase(), p.userId);
  return {success:true};
}
function actionRemoveMember(p, user){
  deleteRowById('Users','UserID', p.userId);
  logActivity(user.UserID, 'Member removed', p.userId);
  return {success:true};
}

/* Generic link handlers for Task links (also used historically by Projects) */
function actionAddLink(sheetName, parentField, p, user){
  if (!p.title || !validUrl(p.url)) return {success:false, error:'A valid title and URL (http/https) are required.'};
  var obj = {LinkID:newId('L'), Title:safeStr(p.title), Description:safeStr(p.description||''), URL:p.url, CreatedBy:user.UserID, CreatedAt:nowIso(), UpdatedAt:nowIso()};
  obj[parentField] = p.parentId;
  appendRow(sheetName, obj);
  logActivity(user.UserID, (sheetName==='ProjectLinks'?'Project':'Task') + ' link added', p.title);
  return {success:true, data:obj};
}
function actionEditLink(sheetName, p, user){
  var patch = {UpdatedAt: nowIso()};
  if (p.title) patch.Title = safeStr(p.title);
  if (p.description !== undefined) patch.Description = safeStr(p.description);
  if (p.url){ if (!validUrl(p.url)) return {success:false, error:'Invalid URL.'}; patch.URL = p.url; }
  updateRowById(sheetName, 'LinkID', p.linkId, patch);
  logActivity(user.UserID, (sheetName==='ProjectLinks'?'Project':'Task') + ' link edited', p.linkId);
  return {success:true};
}
function actionDeleteLink(sheetName, p, user){
  deleteRowById(sheetName, 'LinkID', p.linkId);
  logActivity(user.UserID, (sheetName==='ProjectLinks'?'Project':'Task') + ' link deleted', p.linkId);
  return {success:true};
}

/* ---------------- Tasks ---------------- */
function listTasksFor(user){
  var all = sheetToObjects('Tasks').filter(function(t){ return t.IsTrashed !== true && t.IsTrashed !== 'TRUE'; });
  var links = sheetToObjects('TaskLinks');
  var linksByTask = {};
  links.forEach(function(l){ (linksByTask[l.TaskID] || (linksByTask[l.TaskID] = [])).push(l); });
  all.forEach(function(t){ t.Links = linksByTask[t.TaskID] || []; });
  if (user.Role === 'Admin') return all;
  return all.filter(function(t){ return t.AssignedMemberID === user.UserID && t.IsArchived !== true && t.IsArchived !== 'TRUE'; });
}

function actionCreateTask(p, user){
  if (!p.taskTitle || !p.assignedMemberId) return {success:false, error:'Title and assigned member are required.'};
  var id = newId('T');
  var obj = {
    TaskID:id, TaskTitle:safeStr(p.taskTitle), Description:p.description||'',
    AssignedMemberID:p.assignedMemberId, Priority:p.priority||'Medium', Status:'Not Started', Deadline:p.deadline||'',
    Progress:0, CreatedBy:user.UserID, CreatedAt:nowIso(), UpdatedAt:nowIso(), IsArchived:false, IsTrashed:false
  };
  appendRow('Tasks', obj);
  (p.links||[]).forEach(function(l){
    if (!l.title || !validUrl(l.url)) return;
    appendRow('TaskLinks', {LinkID:newId('TL'), TaskID:id, Title:safeStr(l.title), Description:safeStr(l.description||''), URL:l.url, CreatedBy:user.UserID, CreatedAt:nowIso(), UpdatedAt:nowIso()});
  });
  logActivity(user.UserID, 'Task created', obj.TaskTitle);
  pushNotification(p.assignedMemberId, 'New task assigned: ' + obj.TaskTitle, id);
  return {success:true, data:obj};
}

function actionEditTask(p, user){
  var task = findOneById('Tasks','TaskID', p.taskId);
  if (!task) return {success:false, error:'Task not found.'};
  var patch = {UpdatedAt: nowIso()};
  if (user.Role === 'Admin'){
    if (p.taskTitle) patch.TaskTitle = safeStr(p.taskTitle);
    if (p.description !== undefined) patch.Description = p.description;
    if (p.assignedMemberId) patch.AssignedMemberID = p.assignedMemberId;
    if (p.priority) patch.Priority = p.priority;
    if (p.deadline !== undefined) patch.Deadline = p.deadline;
    if (p.status) patch.Status = p.status;
    if (p.progress !== undefined) patch.Progress = p.progress;
  } else {
    if (task.AssignedMemberID !== user.UserID) return {success:false, error:'Forbidden.'};
    if (p.progress !== undefined) patch.Progress = p.progress;
    if (p.status && ['Not Started','In Progress'].indexOf(p.status) !== -1) patch.Status = p.status;
  }
  updateRowById('Tasks','TaskID', p.taskId, patch);
  logActivity(user.UserID, 'Task updated', task.TaskTitle);
  return {success:true};
}

function actionDeleteTask(p, user){
  var task = findOneById('Tasks','TaskID', p.taskId);
  if (!task) return {success:false, error:'Task not found.'};
  moveToTrash('Task', p.taskId, task, user.UserID);
  deleteRowById('Tasks','TaskID', p.taskId);
  logActivity(user.UserID, 'Task deleted', task.TaskTitle);
  return {success:true};
}

function actionSubmitTask(p, user){
  var task = findOneById('Tasks','TaskID', p.taskId);
  if (!task || task.AssignedMemberID !== user.UserID) return {success:false, error:'Forbidden.'};
  updateRowById('Tasks','TaskID', p.taskId, {Status:'Submitted', UpdatedAt:nowIso()});
  logActivity(user.UserID, 'Task submitted', task.TaskTitle);
  var admins = sheetToObjects('Users').filter(function(u){ return u.Role === 'Admin'; });
  admins.forEach(function(a){ pushNotification(a.UserID, task.TaskTitle + ' was submitted for review.', task.TaskID); });
  return {success:true};
}
function actionApproveTask(p, user){
  var task = findOneById('Tasks','TaskID', p.taskId);
  if (!task) return {success:false, error:'Task not found.'};
  updateRowById('Tasks','TaskID', p.taskId, {Status:'Approved', Progress:100, UpdatedAt:nowIso()});
  logActivity(user.UserID, 'Task approved', task.TaskTitle);
  pushNotification(task.AssignedMemberID, 'Your task was approved: ' + task.TaskTitle, task.TaskID);
  return {success:true};
}
function actionRequestRevision(p, user){
  var task = findOneById('Tasks','TaskID', p.taskId);
  if (!task) return {success:false, error:'Task not found.'};
  updateRowById('Tasks','TaskID', p.taskId, {Status:'Needs Revision', UpdatedAt:nowIso()});
  logActivity(user.UserID, 'Revision requested', task.TaskTitle);
  pushNotification(task.AssignedMemberID, 'Revision requested for: ' + task.TaskTitle, task.TaskID);
  return {success:true};
}

/* ---------------- Discussions ---------------- */
function listDiscussions(){
  var msgs = sheetToObjects('Discussions');
  var users = sheetToObjects('Users');
  var map = {}; users.forEach(function(u){ map[u.UserID] = u.DisplayName; });
  return msgs.map(function(m){ return {DiscussionID:m.DiscussionID, UserID:m.UserID, SenderName: map[m.UserID] || 'Unknown', Message:m.Message, CreatedAt:m.CreatedAt}; });
}
function actionSendDiscussion(p, user){
  if (!p.message || !p.message.trim()) return {success:false, error:'Message cannot be empty.'};
  var obj = {DiscussionID:newId('D'), UserID:user.UserID, Message:safeStr(p.message), CreatedAt:nowIso(), UpdatedAt:nowIso()};
  appendRow('Discussions', obj);
  logActivity(user.UserID, 'Discussion message sent', '');
  return {success:true, data:obj};
}

/* ---------------- Notifications ---------------- */
function listNotificationsFor(user){
  return sheetToObjects('Notifications').filter(function(n){ return n.UserID === user.UserID; }).reverse();
}
function actionMarkRead(p, user){ updateRowById('Notifications','NotificationID', p.notificationId, {IsRead:true}); return {success:true}; }
function actionMarkAllRead(user){
  var sheet = getSheetObj('Notifications');
  var values = sheet.getDataRange().getValues();
  var headers = SHEETS.Notifications;
  var uIdx = headers.indexOf('UserID'), rIdx = headers.indexOf('IsRead');
  var col = [];
  var changed = false;
  for (var i=1;i<values.length;i++){
    var mine = values[i][uIdx] === user.UserID;
    if (mine && values[i][rIdx] !== true) changed = true;
    col.push([mine ? true : values[i][rIdx]]);
  }
  if (changed) sheet.getRange(2, rIdx+1, col.length, 1).setValues(col);
  delete __sheetCache.Notifications; // keep cache correct if this sheet is re-read later in the same request
  return {success:true};
}

/* ---------------- Calendar ---------------- */
function listCalendarEvents(){ return sheetToObjects('CalendarEvents'); }
/* Lightweight variant for the global "today's events" reminder toast that
   runs on every page. Filters server-side to just today's rows instead of
   shipping the whole CalendarEvents table to pages that don't render a
   calendar (Tasks/Discussions/Members/Meetings). The Sheets read itself is
   unchanged (still one getDataRange() call, memoized via __sheetCache like
   every other read in this file) - the savings is in response size and
   client-side JSON work, not in the number of Sheets calls. */
function todaysCalendarEvents(){
  var today = nowIso().slice(0,10);
  return sheetToObjects('CalendarEvents').filter(function(e){ return (e.Date||'').slice(0,10) === today; });
}
function actionCreateEvent(p, user){
  if (!p.title || !p.date) return {success:false, error:'Title and date are required.'};
  var obj = {EventID:newId('EV'), Title:safeStr(p.title), Description:p.description||'', Date:p.date, StartTime:p.startTime||'', EndTime:p.endTime||'', Participants:(p.participants||[]).join(','), CreatedBy:user.UserID, CreatedAt:nowIso(), UpdatedAt:nowIso()};
  appendRow('CalendarEvents', obj);
  logActivity(user.UserID, 'Event created', obj.Title);
  (p.participants||[]).forEach(function(m){ pushNotification(m, 'New calendar event: ' + obj.Title, obj.EventID); });
  return {success:true, data:obj};
}
function actionEditEvent(p, user){
  var patch = {UpdatedAt:nowIso()};
  ['title','description','date','startTime','endTime'].forEach(function(k){
    if (p[k] !== undefined){ var field = k.charAt(0).toUpperCase()+k.slice(1); patch[field] = k==='title'?safeStr(p[k]):p[k]; }
  });
  if (p.participants) patch.Participants = p.participants.join(',');
  updateRowById('CalendarEvents','EventID', p.eventId, patch);
  logActivity(user.UserID, 'Event updated', p.eventId);
  return {success:true};
}
function actionDeleteEvent(p, user){
  deleteRowById('CalendarEvents','EventID', p.eventId);
  logActivity(user.UserID, 'Event deleted', p.eventId);
  return {success:true};
}

/* ---------------- Meetings ---------------- */
function actionCreateMeeting(p, user){
  if (!p.title || !p.date) return {success:false, error:'Title and date are required.'};
  var obj = {MeetingID:newId('M'), Title:safeStr(p.title), Description:p.description||'', Date:p.date, Time:p.time||'', Participants:(p.participants||[]).join(','), Status:p.status||'Scheduled', CreatedBy:user.UserID, CreatedAt:nowIso(), UpdatedAt:nowIso()};
  appendRow('Meetings', obj);
  logActivity(user.UserID, 'Meeting created', obj.Title);
  return {success:true, data:obj};
}
function actionEditMeeting(p, user){
  var patch = {UpdatedAt:nowIso()};
  ['title','description','date','time','status'].forEach(function(k){
    if (p[k] !== undefined){ var field = k.charAt(0).toUpperCase()+k.slice(1); patch[field] = k==='title'?safeStr(p[k]):p[k]; }
  });
  if (p.participants) patch.Participants = p.participants.join(',');
  updateRowById('Meetings','MeetingID', p.meetingId, patch);
  logActivity(user.UserID, 'Meeting updated', p.meetingId);
  return {success:true};
}
function actionDeleteMeeting(p, user){
  deleteRowById('Meetings','MeetingID', p.meetingId);
  logActivity(user.UserID, 'Meeting deleted', p.meetingId);
  return {success:true};
}

/* ---------------- Notes ---------------- */
function listNotesFor(user){
  return sheetToObjects('Notes').filter(function(n){ return n.UserID === user.UserID; }).reverse();
}
function actionCreateNote(p, user){
  if (!p.title) return {success:false, error:'Title is required.'};
  var obj = {NoteID:newId('NT'), UserID:user.UserID, Title:safeStr(p.title), Content:p.content||'', CreatedAt:nowIso(), UpdatedAt:nowIso()};
  appendRow('Notes', obj);
  return {success:true, data:obj};
}
function actionEditNote(p, user){
  var note = findOneById('Notes','NoteID', p.noteId);
  if (!note || note.UserID !== user.UserID) return {success:false, error:'Forbidden.'};
  var patch = {UpdatedAt:nowIso()};
  if (p.title) patch.Title = safeStr(p.title);
  if (p.content !== undefined) patch.Content = p.content;
  updateRowById('Notes','NoteID', p.noteId, patch);
  return {success:true};
}
function actionDeleteNote(p, user){
  var note = findOneById('Notes','NoteID', p.noteId);
  if (!note || note.UserID !== user.UserID) return {success:false, error:'Forbidden.'};
  deleteRowById('Notes','NoteID', p.noteId);
  return {success:true};
}

/* ---------------- Activity ----------------
   activity.js previously fired listActivity and listMembers as two
   separate concurrent requests every 2s. Both are cheap sheet reads
   and are always needed together (the log needs the member map to
   turn UserID into a display name), so they're combined into one
   backend call/round trip here. */
function actionSyncActivity(){
  return {success:true, data:{
    activity: sheetToObjects('ActivityLog').reverse(),
    members: listMembers()
  }};
}

/* ---------------- Archive / Trash ---------------- */
function actionRestoreFromTrash(p, user){
  var rec = findOneById('Trash','TrashID', p.trashId);
  if (!rec) return {success:false, error:'Not found.'};
  var snapshot = JSON.parse(rec.Snapshot);
  var sheetName = rec.RecordType === 'Project' ? 'Projects' : 'Tasks';
  if (sheetName === 'Projects') snapshot.IsTrashed = false; else snapshot.IsTrashed = false;
  appendRow(sheetName, snapshot);
  deleteRowById('Trash','TrashID', p.trashId);
  logActivity(user.UserID, rec.RecordType + ' restored from trash', rec.RecordID);
  return {success:true};
}
function actionPermanentDelete(p, user){
  deleteRowById('Trash','TrashID', p.trashId);
  logActivity(user.UserID, 'Permanently deleted', p.trashId);
  return {success:true};
}
