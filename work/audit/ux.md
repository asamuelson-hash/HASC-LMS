# UX & Workflow Review — HASC LMS (area: `ux`, prefix `UX-`)

Build reviewed: `work/out.html` (= baseline). Line numbers refer to `work/template.html`.
Screenshots: `work/shots/ux/` (desk-* = 1400x900, phone-* = 390x844). Scripts: `work/scratch/ux/`.
Demo clock: the app uses the real clock (`todayDate()`), so on 2026-09-22 every one of the 77 seeded
sessions (Jun 17 – Sep 16 2026) is in the past. Several empty states below come from that, but the
screens should still handle it.

Findings are ordered by how much they affect real users. Where a finding is partly a functional bug,
it is included only because the UI leads a user to a wrong decision.

---

## UX-01 Staff portal never tells staff what they need to do (overdue and missing required training is hidden)
- **Portal/module:** Staff · My Trainings (L1926–2130), My Transcript (L2205–2240), My Certificates (L2132–2165); data in renderVals L15472–15490
- **Evidence (VERIFIED-RUNTIME):**
  - Melana Matatov (16796) is overdue on CPR and First Aid. Her landing tab, *My Trainings*, says only "No online trainings are assigned to you right now." (`desk-staff-trainings.png`). The overdue items show up only as small red pills in rows 6–7 of the Transcript table and cards 6–7 of Certificates. On a phone the Transcript *Status* column is off-screen to the right (`phone-staff-transcript.png`).
  - Shira Aboud (20691, new DSP) is **Missing** O1, O2, O3, PA, CPR and First Aid in the manager and admin matrices. In the staff portal she sees "No online trainings…", an *empty "Official Staff Training Transcript"* (table headers with no rows and no empty-state text, `desk-staffnew-transcript.png`), and "No certificates are on record yet." Nothing tells her that 6 required trainings are outstanding.
  - The data is already computed and then thrown away: `sCourses`, `sActions`, `sOverdue`, `sDue` and `sHeroLine` ("You have N overdue and N due-soon trainings…") at L15476–15490 are never passed to the template. A grep for `sActions`/`sHeroLine` finds only their definitions.
- **Expected:** The first thing a DSP sees is "You need: CPR (expired 7/24/26), First Aid (expired 10/31/23)", written in plain words, with the next step for each item ("Ask your manager to register you" or the registered session date).
- **Severity:** High. This is the main job of the staff portal. Staff who don't know about an expired credential can't act on it.
- **Root cause:** When the staff portal was cut down to "limited personal records" (comment at L15491), the action list went with the rest.
- **Fix:** Expose `sHeroLine`, `sActions`, `sOverdue` and `sDue` from renderVals. At the top of the `sTrainingsTab` block (L1926), render a "What you need to do" card. Each `sActions` item shows the full course name, the status in plain words ("Expired on…", "Never completed", "Due by…") and its registered session if there is one (from `sUpSessions`). Make this card the landing view, and rename the tab "My Training To-Do" or "Home". In the transcript, add an empty state ("No completed trainings on record yet") when `sTransRows` is empty.
- **Regression risk:** Low. Read-only display of data that already exists.
- **Test:** Log in as staff 20691 and as staff 16796. The landing screen lists 6 and 2 actions respectively, at 390px width, with no horizontal scrolling.

## UX-02 Manager Home and My Reports show "0 with overdue / 0 due soon" next to a grid full of red
- **Portal/module:** Manager · Home KPIs (L2255–2261), My Reports KPIs (L2366); computed at L15556–15558
- **Evidence (VERIFIED-RUNTIME):** Manager Nachman Chopp sees `388 TEAM MEMBERS · 0 WITH OVERDUE · 0 DUE SOON · 65% TEAM COMPLIANT` (`desk-manager-home.png`, `desk-manager-needs.png`). Directly below, the matrix shows many "✗ Missing" cells. Counting with `effStatus` over his authorized roster gives 519 staff with at least one red. The same card in Admin → Reports shows `1,187 WITH OVERDUE · 664 DUE SOON`.
  `mRed = team.filter(r=>Object.values(r.rec).includes('r'))`: this reads the raw imported `rec`. `mPct` (L15558) and the admin KPIs (`_agencyAgg`, L10289) use `effStatus`.
- **Expected:** The same numbers, from the same source, in every portal.
- **Severity:** Critical (UX-driven). The headline number a manager uses to decide whether to act is a silent, wrong zero, and it tells them everything is fine.
- **Fix:** Compute `mRed` and `mDueSoon` with `effStatus` over `MATRIX_COLS` inside `_mgrMatrixView` (L10301), the same way `greenCells` is done. Better: have one `teamKpis(list)` helper that both the manager and admin views call.
- **Regression risk:** Low. Only a display count changes.
- **Test:** For the same location, Manager Home "With overdue" must equal Admin Reports "With overdue" filtered to that location.

## UX-03 Managers have no "who on my team is out of compliance" list; the admin-only Overdue Follow-up screen is the one they need
- **Portal/module:** Manager nav (L7350); Admin *Overdue Follow-up* (L5451 onward); Manager Home "Team training progress" (L2296)
- **Evidence (VERIFIED-RUNTIME):**
  - Admin → Overdue Follow-up (`desk-admin-followup.png`) is the best task screen in the product. It lists each staff member with overdue courses named, filters by location and course, and enrols the selected people into a session. Managers can't open it.
  - The manager has to scan a 388-row alphabetical color matrix (My Reports). It has no "only show staff with problems" filter and no sort by risk.
  - Most of Manager Home is taken up by "Team training progress": 388 rows that each read "No online training assigned" (`desk-manager-home.txt`). The Admin Dashboard has the same widget, with 300 rows.
- **Expected:** The manager's home answers "who needs what, and what do I do about it" in one list, with a one-tap path to Register.
- **Severity:** High
- **Fix:** Add `followup` to `NAV_BY_ROLE.manager`, scoped with `managerAuthorizedRoster`. For managers, replace "Enrol selected staff" with "Request registration", which uses the same path as `mRegSubmit`. On Manager Home, replace the "Team training progress" list with the top 10 staff with overdue items plus a "See all" link. Show the online-progress list only when `mOnline.length>0`. Add a "Show: All / Needs action only" toggle to the matrix and default it to *Needs action*.
- **Regression risk:** Medium. Role scoping must be preserved in the reused view.
- **Test:** As a manager, open Follow-up. Only staff at authorized locations appear. The count matches the fixed UX-02 KPI.

## UX-04 Register screen labels staff who need the course as "Optional refresh" and doesn't put them first
- **Portal/module:** Manager/Admin · Register (L2399–2467); `mRegStaff` L15601
- **Evidence (VERIFIED-RUNTIME):** I picked a CPR session. Every staff row, including Shira Aboud whose CPR is *Missing*, reads "DSP · Optional refresh". The list is all 388 staff in alphabetical order. `statusNote` checks the raw `r.rec[code]`, not `effStatus`.
- **Expected:** Staff who need this course (red, orange or yellow by `effStatus`) are labeled "Needs this training", listed first, and shown by default. Staff for whom the course is not required say "Not required for this role", not "Optional refresh".
- **Severity:** High. It pushes managers to register the wrong people, or to give up.
- **Fix:** In `mRegStaff`/`regBase` (L15598–15601), use `this.effStatus(r, code)`. Sort by need (r, o, y, then others). Add a "Show only staff who need this course" checkbox, on by default. Show the reason ("Expired 7/24/26", "Never completed").
- **Regression risk:** Low
- **Test:** Pick a CPR session. Aboud appears at the top with "Needs this training · Never completed".

## UX-05 Executive-facing "Agency compliant 85%" overstates readiness; the KPIs on the same screen contradict each other
- **Portal/module:** Admin Dashboard KPIs (L3409–3415), values at L16732; Location Rankings (L2806–2818)
- **Evidence (VERIFIED-RUNTIME, `desk-admin-dash.png`):**
  - "85% AGENCY COMPLIANT" is a percentage of *cells*, with white/N/A cells counted as green. On the same data, Reports/Follow-up show **1,187 of 2,731 active staff (43%) have at least one overdue item**, so only about 57% of staff are fully compliant.
  - "77 UPCOMING SESSIONS" is `this.state.sessions.length`, meaning all sessions. The calendar on the same page says "0 upcoming sessions on the schedule", and Scheduled Sessions shows `Upcoming (0)`.
  - Different units for the same idea: Dashboard "Overdue items 2,217" (cells), Reports/Manager "With overdue" (staff).
  - Staff count 2,731 in the KPI, "2,734 staff match" in the widget next to it, and "roster currently holds 4,053" on Staff Records.
  - Location Rankings sorts best to worst. An executive needs the worst locations first. The "14 locations below 80%" card is not a link.
- **Expected:** Executives get "X% of staff fully compliant" and "N locations not audit-ready", and can click through to the worst ones.
- **Severity:** High (a misleading executive metric)
- **Fix:** Add a "Staff fully compliant" KPI (staff with no red ÷ active staff) and make it the primary figure. Rename the cell metric to "Requirements met". Set `aSessionCount` to the future-session count (the same filter as `aUpcoming`, without the 7-day cap), or relabel it "Sessions on file". Label the red KPI "Overdue items (courses)" or show staff. Use one active-roster source for every count. Default Rankings to worst-first and make the "below 80%" card filter the table.
- **Regression risk:** Low
- **Test:** The Dashboard, Reports and Follow-up numbers reconcile. Upcoming = 0 when all sessions are in the past.

## UX-06 Status vocabulary is inconsistent across portals (and within one screen)
- **Location:** Staff pill map L8036 ("Up to date / Due soon / Due very soon / Overdue / Compliant · not yet required / N/A"); `effStatusLabel` L10587 ("Compliant / Due soon / Missing / Expired / Not on record / Not required / On record"); L11081 ("Current / Expired / Missing / Not required"); matrix legend ("Compliant / Expiring soon (≤90 days) / Due very soon (≤30 days) / Expired / missing / Not taken / N/A"); matrix cells ("✓ date", "✓ OK", "! date", "✗ Missing", "N/A", "—", plain white date); Follow-up labels never-taken courses as "Overdue: O1, O2…"; `buildStaffCourses` info "Action needed". **VERIFIED-CODE/RUNTIME**
- **Impact:** The same state is "Overdue" to staff, "Missing" or "Expired / missing" to managers, and "Overdue" again in Follow-up, even when the course was never taken. White cells render as "N/A", "—", or a bare date (e.g. Adderley O1 "11/7/21", `desk-manager-needs.png`) with no explanation of the difference. Staff with limited English face 4+ synonyms.
- **Severity:** Medium
- **Fix:** Define one `STATUS_LABELS` table (e.g. *Current · Due soon · Due in 30 days · Expired · Never completed · Not required*) and use it in L8036, L10587, L11081, the legend, Follow-up and exports. Split red into "Expired" and "Never completed" everywhere, since they need different actions. Make "—" vs "N/A" mean one documented thing each, and put that in the legend.
- **Regression risk:** Low. Watch Excel legend sheet L9848 and any tests that match strings.

## UX-07 Course abbreviations with no expansion (O1, SDCH 1, ART, EPP, PA, SCIP, WC In-Pers, Diab. Pour…)
- **Location:** `SHORT_NAME` L7776; matrix headers L2379 / L4077 (no `title`); Follow-up list; admin session cards show the code chip (e.g. "O1").
- **Evidence:** Follow-up rows read "Overdue: O1, O2, O3, ART, PA, CPR, First Aid". This list is meant to be printed "for each coordinator". **VERIFIED-RUNTIME**
- **Severity:** Medium
- **Fix:** Add `title="{{ col.full }}"` and an `aria-label` to the matrix headers (pass `{short,full}` objects). Use full names in Follow-up text and printed lists, and in anything staff see. Add a "Course key" line under the matrix legend.

## UX-08 Destructive or irreversible actions with no confirmation or reason
- **Location / evidence (VERIFIED-CODE):**
  - `denyReq` L14307. Admin "Deny" (L3562) sits right next to "Approve", is the same size, and has no confirm and no reason. The reason is hard-coded as 'Denied by Training Department', so the manager and staff never learn why.
  - `deleteSchedule` L9882 (button L4923) and `deleteReportTemplate` L9878 hard-delete with no confirm.
  - `denyExtCert` L11777 (external certificate uploaded by staff/manager) has no confirm and no reason.
  - By contrast, removing a roster member, voiding, archiving, and cancelling a session all confirm or ask for a reason.
- **Severity:** Medium
- **Fix:** Route these through the existing reason-modal pattern (the one used by Cancel session, L7103). Deny requests and deny ext-cert require a reason, which is stored and shown on the request card and in the notification. Deletes get a `window.confirm` naming the item. After deny, show an undo toast ("Undo" for 10 s).

## UX-09 Manager "Deny" button always fails
- **Location:** Manager Home "Requests to review" (L2330) and Requests tab (L2499) wire `onDeny:()=>this.denyReq(r.id)` (L15577). `denyReq` returns "Only administrators can deny registration requests." for managers (L14308). **VERIFIED-CODE**
- **Also:** Nothing creates `pendingMgr` requests any more ("Staff no longer self-register", L2322), so the "Requests to review" card on Manager Home is permanently empty and takes prime space.
- **Severity:** Medium (a dead end for managers)
- **Fix:** Add a manager-scoped `mgrDeclineReq` (status `denied`, reason required, `canViewStaffMember` check), or remove the Deny button. Hide the "Requests to review" card unless `mPendingReqs.length>0`.

## UX-10 Every message, errors included, is a 2.6-second toast with a green ✓
- **Location:** Toast template L7143–7148 (always shows "✓"); `toast()` L8256 (fixed 2600 ms); no `aria-live` anywhere in the file. About 158 `this.toast(...)` calls are validation or permission errors ("A reason is required to void a completion.", "Choose a session first.", "Administrator access is required."). **VERIFIED-CODE**
- **Impact:** Errors look like success and disappear before slower readers or ESL users finish them. On phones the toast covers the bottom action button (see every phone-*.png). Screen readers get nothing.
- **Severity:** Medium
- **Fix:** Change the signature to `toast(msg, kind='ok'|'error'|'info')`, with a red ✕ icon and longer duration (6 s plus a close button) for errors. Add `role="status" aria-live="polite"` (use `role="alert"` for errors). For form validation, show the message inline next to the field instead of a toast. On ≤760px, raise the toast above the sticky action area.

## UX-11 Phone layout: tall header, hidden tabs, hidden table columns
- **Evidence (VERIFIED-RUNTIME, phone-*.png):**
  - The header (logo, THEME toggle, name, location, Log out) takes about 235 of 844 px on every screen. The admin header also stacks the Staff/Manager/Instructor/Admin switcher.
  - Tab strips scroll sideways with the scrollbar hidden deliberately (`scrollbar-width:none`, L1700–1704). A staff user sees "My Trainings / My Upcoming Sessions / My Transcrip…" and never finds *My Certificates*. The admin portal has two rows of hidden-overflow chips.
  - Instructor Attendance: the *Result* (Pass/Fail) column starts at x=388 of 390 px, inside a table that scrolls sideways with no hint. "Certify & post completions" stays disabled ("Every present/late attendee also needs Pass or Fail"), and the instructor can't see the control it's waiting for.
  - Staff Transcript: the *Status* column (Overdue) is off-screen.
- **Severity:** High for staff and instructors (the phone-first users)
- **Fix:** At ≤760px, collapse theme and user details into the avatar menu so the header is about 64 px. For staff (4 tabs) and instructors (3 tabs), use a fixed bottom tab bar or wrapped chips instead of horizontal scroll. Where scrolling stays, show edge fades. Render instructor attendance rows as stacked cards on phones (name, then Present/Late/Absent, then Pass/Fail), or combine the two into one control ("Present ✓ Passed / Present ✗ Failed / Absent"), which also halves the taps. Render staff transcript rows as cards with status next to the course name.
- **Test:** At 390×844, every tab label is visible and Pass/Fail is visible without horizontal scrolling.

## UX-12 Instructor workflow: extra steps and the wrong default session
- **Location:** My Sessions cards (L2671–2688); Attendance (L2690–2727)
- **Evidence (VERIFIED-RUNTIME):** Sessions are listed newest first. All 5 are tagged amber "Past · not certified", including 4 with 0 enrolled that need nothing. The one needing action (Jun 17, 3 enrolled) is last. The Attendance tab opens straight to an arbitrary session with no switcher. "Mark all present" doesn't offer "…and pass all", so a class of 30 still takes 30 separate Pass taps.
- **Severity:** Medium
- **Fix:** Sort by "needs certification" first, then upcoming by date, then past. Show "Nothing to certify" (grey) for sessions with 0 enrolled. Add a session dropdown to the Attendance header. Add "Mark all present & passed", then let the instructor adjust exceptions.

## UX-13 Register page: an empty calendar with no guidance, and copy that says "on the left"
- **Location:** L2399–2465
- **Evidence (VERIFIED-RUNTIME, `desk-manager-register.png`):** With no future sessions, the page shows a full empty month grid, "0 upcoming sessions", and a disabled "Previous" button. Step 1 sits below the calendar. It never says "No sessions are scheduled yet — the Training Department publishes the calendar; check back or contact training@…". Step 2's placeholder says "Select a session on the left", which is wrong on phones where the panels stack.
- **Also:** A registration is a two-step manager → admin approval. The requests list shows "Pending admin" with no expected turnaround, and staff aren't told they are pending.
- **Severity:** Medium
- **Fix:** If `mRegSessions.length===0`, replace the calendar with an explanatory empty state. Put Step 1 (the session list, grouped by course, with seats left) above the calendar, or make the calendar optional. Change the copy to "Select a session above". Consider auto-approving when seats are available and the staff member needs the course, which removes an admin click per registration. Show pending requests on the staff member's *My Upcoming Sessions* as "Requested — awaiting approval".

## UX-14 Duplicate or overlapping screens and confusing tab names
- **Evidence (VERIFIED-CODE, NAV_BY_ROLE L7348–7353):**
  - Manager has 10 tabs. Online Progress, Course Progress, Video Training and the Home "Team training progress" widget all show online and video progress. Transcripts and Certificates are near-identical staff pickers. "My Reports" opens "Compliance Color Report", the manager's most important screen, labelled as if it were a report archive.
  - "Audit" appears as the second tab for managers and admins (Audit Packet Builder), while System Center has "Audit Trail & Packet", a second audit-packet tool.
  - Admin tabs: "Add Independent Session" actually records a completion. "Course Completions" is where you *void* completions. "Import training record" is lower-case. "Session Requests" (admin), "Requests" / "Training Requests" (manager), and "registration requests" in the copy all mean the same thing. "Enrol" and "Enroll" are both used.
  - The admin "Dashboard" and "Audit" chips appear in the second row beside whichever group is active, so they look like members of "Sessions" (`desk-admin-dash.png`).
- **Severity:** Medium
- **Fix:** Manager tabs become *Home · Team Compliance · Follow-up · Register · Requests · Online Training (merge Online Progress, Course Progress and Video Training into one screen with filters) · Records (Transcripts + Certificates as one picker with "Print transcript / Print certificates" actions) · Audit Packet*. Rename "Add Independent Session" to "Record a Completion" and "Course Completions" to "Review / Void Completions". Standardize on "Registration requests" and "Enroll". Put Dashboard and Audit in a separate "pinned" group visually distinct from the group tabs.

## UX-15 Vendor and infrastructure jargon shown to managers and staff-facing users
- **Location:** Video Training banner L5763–5773 (not gated by `vtIsAdmin`); Manager VT note L6055; Staff Records banner ("Local prototype… Supabase… RLS"); login footer ("DEMO AUTH ONLY… Supabase Auth + Row Level Security").
- **Evidence:** Managers see "Bunny Stream… Library ID and Stream API key… no Cloudflare Worker… Server-side validation: Not yet — client-side only in this prototype" and "Row Level Security scopes these rows" (`desk-manager-vtrain.png`). **VERIFIED-RUNTIME**
- **Severity:** Low–Medium (erodes trust and adds noise)
- **Fix:** Wrap L5770–5774 in `<sc-if value="{{ vtIsAdmin }}">`, and move it into Setup → Video Training settings. Remove the RLS sentence from the manager note. Keep prototype disclaimers in a single admin-only "Environment" panel.

## UX-16 Sign-in: contradictory instructions, no recovery path, unhelpful errors
- **Location:** Login form L1830–1845; labels L15400–15402 / L16187–16189; errors L8161–8166
- **Evidence (VERIFIED-RUNTIME, `phone-login-staff-err.png`):** The field says "Staff ID or email". The hint says the temporary password is your last name. The footer says "Use your HASC Center work email and password." (many DSPs have no work email). Submitting empty fields gives "Incorrect email or password." There's no "Forgot password / can't sign in" help anywhere (0 matches for "forgot"). Staff, the largest group, must first choose among 4 "portals".
- **Severity:** Medium
- **Fix:** Change the staff footer to "Sign in with your Staff ID (on your pay stub) or work email." Validate empty fields inline ("Enter your Staff ID"). Add a "Can't sign in?" link with who to contact. Longer term, use one sign-in that routes by role and make the portal cards secondary. (The weak last-name default password is a security issue for the security reviewer.)

## UX-17 Missing or misleading empty states
- Admin → Session Requests tab (L3549–3566) renders nothing under the description when there are no requests. The dashboard card has `aNoApprovals` (L3530) but the tab doesn't. **VERIFIED-RUNTIME**
- Manager → Requests: the description says it lists requests "you've submitted… and their status", but the empty state says "No pending registration requests requiring manager action", which describes a different list.
- Staff Transcript prints an "Official Staff Training Transcript" with no rows (see UX-01).
- Scheduled Sessions: past sessions with no attendance just say "Historical · Attended: No attendance recorded". Nothing flags "attendance never taken — needs follow-up" to admins.
- **Severity:** Low–Medium
- **Fix:** Add empty-state `sc-if`s with the next step. On past sessions with a roster but no attendance, show a red "Attendance not recorded" chip and a filter chip "Needs attendance (n)".

## UX-18 Location lists differ between screens and include junk entries
- **Evidence (VERIFIED-RUNTIME):** Audit Packet, Course Completions and Training Requirements dropdowns include "2102 Avenue I (Do not use)", both "New Ave S" and "New Avenue S", and truncated names like "Sunday/Holiday Program (14th Ave" and "E.36th 1st Floor (G/L Use ONLY". Dashboard and Reports lists hide some of these. The same person sees different location sets on different screens.
- **Severity:** Low
- **Fix:** Build every location picker from one helper (`locOptions`), which excludes archived and "Do not use" entries unless "Include archived" is checked. Surface the Location Directory merge tool (L8579) to clean up duplicates.

---

## Quick wins (a few lines each)
1. UX-02 `mRed`/`mDueSoon` via `effStatus` (L15556–15557).
2. UX-05 relabel or fix `aSessionCount` (L16732).
3. UX-01 expose `sHeroLine`/`sActions` (already computed) and render them on the staff landing screen.
4. UX-04 `statusNote` via `effStatus` and sort by need (L15601).
5. UX-15 gate the Bunny banner with `vtIsAdmin`.
6. UX-10 give error toasts a distinct icon and longer duration, plus `aria-live`.

## Areas not conclusively tested
- Online course and video player flow for staff (no assigned courses in seed data; Bunny offline).
- Admin Record Entry forms (Independent Session, External Certificate, Pourings, RN Courses) beyond reading their copy and screenshots.
- Dark theme contrast, keyboard-only navigation and screen-reader behavior beyond the `aria-live` grep.
- The end-to-end approval round-trip (manager request → admin approve → staff view). Only the submit step was driven. My test session reused an old `when` string, so the date mismatch in that capture came from my setup and is not a finding.
- Print and PDF output layouts (transcripts, certificates, audit packet).
