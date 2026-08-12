# TaskHive

A neo-brutalist project & task management app built with HTML5, CSS3, vanilla JavaScript, Bootstrap 5.3, and Font Awesome on the frontend, with Google Apps Script + Google Sheets as a serverless backend/database.

## 1. Features
- Admin/Member roles with backend-enforced authorization
- Projects & Tasks with unlimited links each (add during or after creation, edit/delete individually)
- Multiline descriptions rendered as bullet lists
- Task workflow: Not Started → In Progress → Submitted → Approved / Needs Revision
- Discussions, Notifications, Calendar (with event-day reminders), Meetings, Notes
- Activity Log, Archive, Trash
- Dark/Light mode, fully responsive, ~2s central auto-sync (no reloads, no state loss)
- No time tracking/attendance, no charts

## 2. Folder Structure
See project tree in the root — `pages/` holds each screen, `assets/js` holds one module per feature, `backend/Code.gs` is the entire Apps Script backend.

## 3. Google Sheets Setup
1. Create a new Google Sheet — this will be your database.
2. Open **Extensions → Apps Script**.
3. Delete the default `Code.gs` content and paste in the contents of `backend/Code.gs` from this project.

## 4. Database Initialization
In the Apps Script editor, select the `setupDatabase` function from the function dropdown and click **Run**. This creates every required sheet (Users, Projects, ProjectLinks, Tasks, TaskLinks, Discussions, Notifications, CalendarEvents, Meetings, Notes, ActivityLog, Archive, Trash) with headers, and seeds the initial Admin account.

## 5. Authorize the Script
The first run will prompt for authorization — approve the requested Google account permissions.

## 6. Deploy as Web App
1. Click **Deploy → New deployment**.
2. Select type **Web app**.
3. Execute as: **Me**. Who has access: **Anyone** (or "Anyone with the link", depending on your needs).
4. Click **Deploy** and copy the Web App URL.

## 7. Configure the API URL
Open `assets/js/api.js` and replace:
```js
const API_URL = 'PASTE_YOUR_DEPLOYED_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
```
with your deployed Web App URL.

## 8. Admin Credentials
- Username: `Sugoi`
- Password: `6401`

Change this password from the Members page after first login.

## 9. Logo & Favicon
Place `TaskHiveLogo.png` in the project root (referenced from `login.html` and the sidebar) and `TH.ico` in the project root (referenced as the favicon on every page).

## 10. Automatic Synchronization
A single central sync engine polls `syncAll` every ~2 seconds and diffs incoming data against what's rendered, so the UI updates in place — it never reloads the page, clears forms, or logs users out.

## 11. Multiple Project/Task Links
Projects and Tasks each support an unlimited number of links, addable during creation (via "+ Add Another Link") or afterward from the detail view. Every link has its own ID, title, description, URL, and independent Edit/Delete/Open actions.

## 12. Permissions
Enforced server-side in `Code.gs` via `requireAdmin()` and per-record ownership checks — never relies on hidden frontend buttons alone.

## 13. Calendar Reminder Behavior
When an event's date matches today, a one-time on-screen toast reminder appears per user per browser (tracked in `localStorage`) and does not reappear the next day.

## 14. Troubleshooting
- **"Unable to connect to the server"** — check that `API_URL` in `api.js` is correct and the deployment access is set appropriately.
- **Login fails** — confirm `setupDatabase()` was run at least once to seed the Admin account.
- **Changes don't appear for other users** — auto-sync runs every 2 seconds; confirm both users are on an active, unblocked network connection.
- **Links not saving** — the URL must start with `http://` or `https://`.
