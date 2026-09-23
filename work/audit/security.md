# Security & Permissions audit: HASC LMS (build 2026-09-22)

Area: `security` · Prefix `SEC-` · Auditor scratch: `work/scratch/security/*.mjs`. Every runtime script runs with the shared harness against `work/out.html`.

## 0. Architecture baseline (inherent, recorded once and not repeated per finding)
- **Everything is client-side.** HASCPolicy, `can()`, `go()` and every guard below run in the browser. Anyone with devtools can call `window.__hascLogic.setState({currentUser:{role:'admin',…}})` or any method. The code says this itself (template.html ~42-64, ~8066-8078). The findings below are cases where the **in-app layer breaks its own rules through normal UI use**, or where it holds defects that will carry into the Supabase port.
- **Data embedded and exposed before login.** Once the file loads, `window.HASC_DATA`, `HASC_ACTIVE_ROSTER_REFERENCE_20260809` (template.html line 33), `HASC_COMPLETION_REFERENCE_20260915` (line 38) and `__hascLogic.state` hold:
  - roster: 4,053 records with name, staff ID, position, location, hire date, manager ID, employment status and full training history
  - 71 manager/area-coordinator names, empIds, locations and emails, 16 of them personal addresses (hotmail/gmail etc.)
  - 13+ instructor names and emails
  - the whole audit log

  A runtime scan (p2.mjs) found **no SSN, DOB, home address or personal phone** (the only phone is the org's (718) 535-1937). All of this persists **unencrypted** in IndexedDB `hasc_lms_state_v3` and in localStorage. Anyone at the workstation can read it without signing in.
- **Credentials in source.** `LMSDataService.DEMO_AUTH` and `Component.PW` (template.html 8101) hold `hascadmin1 / hascmanager1 / hascinstr1 / staff123`. There is no rate limiting or lockout on any login.
- **Demo clock:** not examined in this area.

---

## SEC-01: Audit packet (with out-of-scope staff records) survives logout and is shown/printed to the next user. **High · VERIFIED-RUNTIME**
- Portal: Admin → Manager (a shared workstation). Location: `logout()` template.html 8200-8202; `applyRoleDefaults()` 8250-8254 (the `base` object has no `aud*` keys); `audPrintPacket()` / `audPrintOne()` / `audPreviewDoc()` 11144-11150.
- Current behaviour, reproduced through the **real "Log out" button** (leak.mjs):
  1. Admin generates an audit packet for 1010 Avenue K (Semel, Tafrizi, Zadok). These staff are outside manager Nachman Chopp's scope.
  2. The admin clicks Log out.
  3. The manager signs in with the login form.
  4. The state still holds `audPacket:true, audStaff:['2714','4310','20395'], audLoc:'1010 Avenue K'`.
  5. On the Manager "Audit" tab, all 3 names are rendered, and `audPrintPacket()` prints their transcripts (`res:[true,true,true]`).
- Expected: a sign-out clears all per-user working state. Printing or previewing re-checks scope.
- Root cause:
  - `logout()` resets only about 10 auth keys.
  - `applyRoleDefaults()` does not reset `audPacket`, `audStaff`, `audLoc`, `audReq`, `audCourses`, `audCustom`, `audCertCodes`, `audHealth`, `audAmapSubs` or `audOrientSubs`.
  - The print and preview functions trust the stored packet without checking it.
- Fix:
  - (a) In `logout()` and `signIn()`, reset **every non-data state key** to its constructor default. Keep a `USER_STATE_DEFAULTS` object built from the initial state at 7158ff, minus the data collections (roster, sessions, docs, locations, instructors, auditLog…). Setting that object replaces the hand-maintained list.
  - (b) Add the `aud*` keys to `applyRoleDefaults()` base.
  - (c) In `audPrintPacket()`, `audPrintOne()` and `audPreviewDoc()`, filter `pkt.employees` by `canViewStaffMember()`, and drop the packet when `pkt.by !== currentUser.name`.
- Regression risk: low. Check that switching the portal hop does not wipe a packet mid-task for the same admin.
- Test: rerun `leak.mjs`. Expect `audPacket:false` after the manager signs in and none of the names in the body or the print.

## SEC-02: Admin "portal hop" impersonates real people and misattributes the audit trail; hopping back always becomes Aryeh Samuelson. **High · VERIFIED-RUNTIME**
- Portal: header switcher (admin). Location: `switchRole()` template.html 8204; `auditEntry()` 9137.
- Current behaviour (hop.mjs):
  - Atara Dershowitz signs in as admin. `switchRole('manager')` makes the current user **Nachman Chopp / nchopp@hotmail.com**, a real manager. Any audit entry is then written as `"Nachman Chopp (manager)"`.
  - `switchRole('staff')` makes her **Melana Matatov, staffId 16796**, a real employee. Online-course progress, completions and certificates created during the hop are written to Melana's record.
  - `switchRole('admin')` returns her as **Aryeh Samuelson** (`ACCOUNTS.admin[0]`), not Atara. `HASCSession.principal()` agrees, so every later admin action (voids, overrides, imports) is attributed to the wrong director.
  - The hop itself is not audited.
- Positive result: a non-admin cannot hop. `switchRole()` refuses unless `can('access_all_portals')` or `hopAdmin`, and `hopAdmin` is set only in `signIn('admin')` and cleared on logout.
- Expected: hopping is an audited "view as" preview. The real actor stays attached, and returning restores the original admin.
- Root cause:
  - `switchRole()` builds a brand-new `currentUser` from `ACCOUNTS[r][0]` or `HASC_DATA.managers[0]`.
  - It does not keep the original admin identity.
- Fix:
  - On the first hop, store `hopOrigin = currentUser` in state. `switchRole('admin')` restores `hopOrigin`.
  - While hopped, stamp `auditEntry` with `user: hopOrigin.name` plus `actingAs: cu.name`. `logAudit('Portal hop', …)` on every switch.
  - Either use a clearly synthetic preview identity (e.g. "Preview Staff", staffId null) or block record-writing actions (course completion, registration, requests) while `hopOrigin` is set.
- Regression risk: medium. Staff-portal preview features need a staff record to render. Use read-only mode instead of a fake ID.
- Test: rerun hop.mjs. Expect `backToAdmin` to be "Atara Dershowitz", audit rows to carry the admin as actor, and no writes to 16796.

## SEC-03: Terminated/archived managers can still sign in to the Manager portal. **High · VERIFIED-RUNTIME**
- Location: `doLogin()` manager branch, template.html 8143 (`rk==='manager'`).
- Current behaviour (auth.mjs):
  - All 71 manager/AC emails sign in with the shared password.
  - **Rachel Darrison (empId 18535) is `employmentStatus:'inactive', archived:true` in the roster and still signs in** as Manager.
  - Naomi Goldzweig (empId 4137) is not in the roster at all, and also signs in.
  - Their authorized roster is empty, but they still get the session catalog, the Register tab (open-session details), Requests and Video Training.
  - The hard-coded `ACCOUNTS.instructor` entry also skips the `status==='active'` check at login. `instructorCanAccessSession` catches inactivity later, but sign-in still succeeds.
- Expected: login is refused when the linked employee record is inactive, archived or missing. The staff login already applies `isEmploymentActive()`.
- Fix: in the manager branch, look up `roster.find(r=>String(r.id)===String(f.empId))`. Refuse the login if it is missing, `!isEmploymentActive(r)` or `archived`. Apply the same check to the instructor record status for `ACCOUNTS.instructor`.
- Regression risk: low. Area coordinators whose empId is absent from the roster would be locked out, so list them first (currently only Goldzweig).
- Test: sign in as `Rachel Darrison`'s email with the manager password. Expect "account inactive".

## SEC-04: Staff authentication gives almost no protection: the last-name password works on any device indefinitely, and setup can be skipped. **High (partly inherent) · VERIFIED-RUNTIME**
- Location: `doLogin()` staff branch, template.html 8146-8165; `savePwSetup()` 8126-8136.
- Current behaviour:
  - Any active staff member can be signed into with **staff ID + last name**. Both values are embedded in the file and printed on attendance sheets and rosters. For example, ID 10618 with "Augustin" signed in (auth.mjs).
  - The chosen password is stored **only** as an unsalted SHA-256 in `localStorage['hasc_staff_pw:<id>']` of that one browser. On any other browser or device, or after site data is cleared, the last name works again. `lastAfterReset` confirmed this.
  - The setup modal is not enforced. Reloading the page drops `pwSetup`, and the staff member keeps using the last name (auth2.mjs, `after reload … ls: []`).
  - Error messages allow account enumeration and reveal password state. An unknown ID gives "No active staff member with that Staff ID". A known ID with no password set gives "First-time login: your temporary password is your last name". A known ID with a password set gives "Incorrect password."
- Expected: a per-user secret that is not public, stored where every device sees it, with enforced first-login change and generic errors.
- Inherent vs fixable:
  - Real fixes (Supabase Auth, invites) are architectural.
  - In-app fixes:
    - Return one generic error for every failure.
    - Keep the staff password hash in the synced operational store (`_opsSnapshot` / HASCStore) rather than a standalone localStorage key, so clearing one key does not revert it.
    - Salt the hash with the staff ID.
    - Re-show the setup modal at every last-name login until a hash exists. This already happens, but record `mustChangePw` so it cannot be skipped by reload.
    - Show no enumeration hint on the login screen.
- Regression risk: low. Test all three error paths.

## SEC-05: First-login password-setup state is not cleared on logout, so the next person can set another staff member's password. **Medium · VERIFIED-RUNTIME (method level); UI path currently blocked**
- Location: `logout()` template.html 8200-8202 does not clear `pwSetup`, `pwNew1`, `pwNew2` or `pwSetupErr`.
- Current behaviour (auth.mjs):
  1. After a first-time staff login, `logout()` leaves `pwSetup={staffId:'10618',…}`.
  2. The "Set your password" modal is then rendered **over the signed-out login screen** (screenshot `work/shots/sec_pwsetup.png`).
  3. `savePwSetup()` then stores `attacker1` for staff 10618. The victim's last name is refused, and `attacker1` signs in as them.
  4. `pwSetup` also stays set across later failed login attempts.
- Why this is Medium, not High: today the modal overlay (z-index 130) covers the header's Log out button. Playwright's click timed out, and no other UI path calls `logout()` except `HASCAuth` SIGNED_OUT. Any future idle-logout, header z-index change or Supabase sign-out event makes it exploitable.
- Fix: include the `pwSetup*` keys in the SEC-01 full reset. In `savePwSetup()`, also require `currentUser.staffId === pwSetup.staffId`.
- Test: sign in with the last name, call `logout()`, and assert `pwSetup==null` and no modal.

## SEC-06: Shared role passwords; the manager "hash" does not protect anything; instructor list shown before login. **Medium (inherent to demo, document for go-live) · VERIFIED-RUNTIME**
- Location: template.html 8080-8101; `LMSDataService.DEMO_AUTH`; `checkPassword()` 8110; `instrLoginOpts` 16196.
- Evidence:
  - The 3 admins share `hascadmin1`, the 71 managers share `hascmanager1`, and all instructors share `hascinstr1`.
  - `MGR_HASH` is just `sha256('hascmanager1')` (checked at runtime: true), whose plaintext sits next to it. The comment "plaintext never stored" (8081) is false.
  - Before any login, the instructor login shows a picker of all 13 active instructors with their emails. Together with the shared password, this means anyone can sign in as any instructor and mark attendance or submit completions for that instructor's sessions.
- Fix (in-app, before Supabase): remove the plaintext from `DEMO_AUTH.passwords.manager`, drop the pre-auth picker (use a typed email), and correct the misleading comments. Real fix: per-user credentials through Supabase Auth.

## SEC-07: SCORM player iframe is effectively unsandboxed (`allow-scripts allow-same-origin` + `srcdoc`). **Medium · VERIFIED-CODE**
- Location: SCORM launch modal, template.html ~8956 (`<iframe class="scorm-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads">`) and `frame.srcdoc=html` at ~8998.
- Impact:
  - A `srcdoc` frame inherits the parent's origin. With both flags set, package JavaScript can reach `parent.__hascLogic`.
  - It can read the whole roster and audit log, call `recordCompletion`, and change `localStorage` or IndexedDB. That includes rewriting `hasc_staff_pw:*` (SEC-04).
  - Any third-party SCORM package uploaded by an admin runs with full LMS privileges in every learner's browser.
- Fix:
  - Remove `allow-same-origin`, so the frame gets an opaque origin, and bridge the SCORM API with `postMessage` instead of direct `window.parent.API` access.
  - Alternatively, serve packages from a separate origin.
  - Assets that are currently blob URLs may need to be inlined as data URLs or passed across.
- Regression risk: medium. The SCORM runtime shim (`_scormApiShim`, 8928) must switch to a message channel. Test SCORM 1.2 and 2004 packages end to end.

## SEC-08: Training-update "asset URL" rendered into an `<iframe src>` without scheme validation for "note" updates. **Low · VERIFIED-CODE (exploit SUSPECTED)**
- Location: `vtPublishUpdate()` template.html 12855-12860 validates `https://` only when `kind==='slide'`. The staff view at 13781 sets `su.src = asset_data_url || asset_url` and `isFrame` for anything that is not an image. The template at line 1945 renders `<iframe sc-camel-src="{{ su.src }}">`.
- Impact: an admin-entered `javascript:` or `data:text/html` URL on a note update would load in a same-origin iframe for staff. This is admin-to-staff stored XSS, and it becomes relevant once data is shared through a backend.
- Fix: in `vtPublishUpdate()`, and again at render time, accept only `^https://` or a `data:(image/|application/pdf)` URL. Otherwise set `hasAsset=false`.

## SEC-09: Permission matrix is mostly decorative; import handlers have no action guard. **Low · VERIFIED-CODE**
- Location: `PERMISSIONS` template.html 8205-8215; `can()` 8217.
- Evidence:
  - Only 3 capabilities are ever checked in code: `access_all_portals`, `manage_users` and `override_training_records`.
  - All other authorization uses hard-coded `role==='admin'` checks. `recordCompletion`, `voidCompletion`, `applyCertResolution`, `saveInstructor` and `approveExtCert` do check the role.
  - `importCsvStaff()` (10127) and `importEmpeon()` (11572) have **no guard at all**. `import_staff` is never checked. This contradicts the comment at 8216: "action-layer guards … cannot bypass scope merely by invoking a hidden handler."
  - `HASCPolicy.registerMatrix` is called (11842), but its `canReadStaff()` is unused by the component.
- Fix: guard `importCsvStaff` and `importEmpeon` with `if(!this.can('import_staff')) return;`. Over time, replace role-string checks with `can(cap)` so the matrix and the future RLS policies match one to one.

## SEC-10: Third-party script loaded without Subresource Integrity in the same origin as all PII. **Low · VERIFIED-CODE**
- Location: template.html line 8, `<script src="https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js">`, a floating "latest" URL.
- Impact: a compromise of that CDN runs with full access to the embedded roster and state.
- Fix: pin a version, add `integrity=` and `crossorigin`, or lazy-load it only when a Bunny video plays.

---

## Checked and found sound (negative results)
- **XSS:** runtime fuzz (xss.mjs). An `<img onerror>` payload was placed in the staff name and position, session title, location and instructor, and course description (attendance-sheet description). The admin tabs (dash, records, sessions, attendance, attsheets, transcripts, certificates, reports, followup, auditpkt, approvals, voids, progress) and the instructor tabs were rendered. `printStaffCerts`, `printAllTranscripts`, `printAllCerts`, `printScheduledSessionAttendance` and `printComplianceColorReport` were run. The payload appeared escaped in every print (e.g. 8 escaped hits on the attendance sheet), and **0 elements were injected or executed**.
  - x-dc `{{ }}` bindings are text-escaped, and no raw-HTML binding exists.
  - The audit-packet builders and `documentHeaderHTML` escape all fields.
  - The uploaded-document viewer uses `textContent`.
- **CSV/formula injection:** all 5 CSV exports go through `_csvCell` (template.html 8296), which prefixes `= + - @ \t \r`. The notification queue (9523), completions (10669), import template (11337), reconciliation (11704) and course progress (16927) were checked. The XLSX writer uses `inlineStr`, so there are no formulas.
- **Tab routing:** there is no URL hash or query routing. `go('records')` as a manager sets `tab.manager='records'`, but every view flag is `role==='x'&&tab==='y'`, so nothing admin-only renders (`mgrRecordsVisible:false`). One gap: `go()` does not validate the tab against `NAV_BY_ROLE`. Harmless, but worth a whitelist.
- **Session persistence:** a reload always signs the user out (`currentUser:null`), and no auth token is stored. `logout()` clears HASCSession and `hopAdmin`.
- **Manager scope:** batch prints use `batchScope()`, which calls `managerAuthorizedRoster`. Certificate and transcript prints re-check `canViewStaffMember`.

## Areas not conclusively tested
- Manager and instructor mutation paths across scope (registering or requesting for out-of-scope staff IDs through handlers) were not fuzzed per handler.
- The notification email/SMS templates may render as HTML once a backend sends them. Values are not escaped for HTML email.
- The claim that the SCORM same-origin issue is exploitable (SEC-07) was not proven with a crafted package.
- The `javascript:` iframe payload for SEC-08 was not run.
- Audit-log tamper resistance (the client-editable `auditLog` array) is inherent and was not assessed further.
- The demo clock was not examined.
