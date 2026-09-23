# Scheduling / Calendar / Registration / Attendance audit (SCH-)

Build: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html` (read via `work/template.html`).
Harness scripts: `work/scratch/scheduling/` (`h.mjs` is a harness variant that adds a `timezoneId` option; `gen.mjs` + `runcal.mjs` + `cases*.mjs` build synthetic HASC-style calendar PDFs with pdf-lib and run them through the real `importOfficialCalendarFile` using a local PDF.js 2.16.105; `chain.mjs`, `t2.mjs`–`t5.mjs` cover the operational flows).

**Clock:** there is no fixed demo clock. `todayDate()` (7965) and `clockNow()` (9153) both return `new Date()`, which is the browser clock. **Timezone matters.** The stock harness runs in UTC, and that hides SCH-01. The New York tests used `timezoneId:'America/New_York'`, where the agency operates.

**End-to-end chain (VERIFIED-RUNTIME, `chain.mjs`, NY timezone).** I added a CPR In-Person session for today, 12:00–1:00 AM, with capacity 2 and instructor Sara Schwedelson. Admin `registerStaff` enrolled staff 20691, and the request status became `enrolled`. As the instructor, I opened the session, ran Mark all present, set Pass and certified. The results:
- One completion was stored: `{course:'CPR', complianceCode:'CPR', date:'9/22/26', completedAt, sessionId, source:'In-person session', certGenerated:true}`.
- The staff member's CPR went from `r` to `g`, dt 9/22/26, expiring 9/22/28. The transcript row shows the certificate as `generated`.
- The request status became `completed`, and the session became `certified/locked`.
- Certifying a second time is refused, and no duplicate completion is created.
- An admin correction to absent writes a void: CPR goes to `r` and the request to `no_show`. Correcting back restores `g`. Everything survives a reload.

The main path works. The defects are at the edges, listed below.

---

## SCH-01 — ISO-dated sessions (every calendar-imported session) move one day earlier in US time zones: registration closes early, certification unlocks before class, and editing shifts the date
- **Portal:** Admin (Scheduled Sessions, Register, Attendance), Instructor, reminders · `sessionDateObj` 7966, `isUpcomingSession` 7967, `parseSessionStart/End` 9162/9171, `startEditSession` 8599, and `publishOfficialCalendar` 15205 (writes `date:x.iso`).
- **Current:** `publishOfficialCalendar` stores `date:'2026-12-01'`. `new Date('2026-12-01')` is parsed as UTC midnight, which is the previous evening in New York. Runtime results in America/New_York (`t2.mjs`):
  - `sessionDateObj({date:'2026-12-01'})` returns **Mon Nov 30**, and `parseSessionStart` returns Nov 30 9:00 AM. Reminders and the calendar grid therefore use the wrong day.
  - A session dated today in ISO form gives `isUpcomingSession` = **false**, so registration closes a day early.
  - A session dated **tomorrow** (ISO) was **certified today**, before the class happened. It posted a completion dated `9/22/26` for a 9/23 class.
  - `startEditSession` on the 12-01 session prefilled `nsDate='2026-11-30'`. Saving with only the capacity changed rewrote the session to **"Mon, Nov 30, 2026"**, and because the date string changed, the edit path sends a *session_rescheduled* notice to the roster and managers.
- **Expected:** Date-only values are parsed as local dates in every time zone.
- **Severity:** Critical: completions are posted with wrong dates and before the class takes place, sessions move silently, and false reschedule notices go out. **VERIFIED-RUNTIME.**
- **Root cause:** ECMAScript parses `YYYY-MM-DD` as UTC. Seeded and manual sessions use `"Wed, Jun 17, 2026"`, which parses as local time, so only imported sessions are affected.
- **Fix:** Add one `parseSessionDate(s)` helper. If the value matches `/^\d{4}-\d{2}-\d{2}$/`, return `new Date(y,m-1,d)`; otherwise use the current path. Use it in `sessionDateObj`, `parseSessionStart`, `startEditSession` and `_calendarSessionMatch`. Also make `publishOfficialCalendar` store `date:x.dateLabel` (the same format `addSession` uses), and migrate existing ISO dates on load.
- **Regression risk:** Low–medium; all day comparisons go through this helper.
- **Test:** Run `t2.mjs` section B with `TZ=America/New_York`. Expect Dec 1, today counted as upcoming, the tomorrow session not certifiable, and an unchanged date after an edit.

## SCH-02 — Calendar month/year detection takes the first month name in Jan→Dec order, not the calendar's own header; a December PDF that mentions "January 2027" is imported as January on shifted dates
- **Portal:** Admin › Upload Calendars · `_calendarDetectMonthYear` 15030, `importOfficialCalendarFile` 15124.
- **Current:** The detector loops over months January→December and returns the first one that matches anywhere in the page text plus the filename. I tested a December 2026 PDF with the header "December 2026" and the footer "Registration for January 2027 classes opens December 15." It was detected as **January 2027**. Then:
  - All 15 in-grid sessions were re-dated into January (the Dec 1 cell became Jan 1, and so on).
  - 3 were dropped silently.
  - No error was shown. The review screen only displays the heading "January 2027".
  - With a single session, the same PDF instead failed with a misleading "no configured training sessions" error.
  (`cases1.mjs` and `cases2.mjs`)
- **Expected:** The title or header month wins. The month should be taken from the largest or topmost text, or from the first match by *position*, and it should be checked against the grid (the weekday of day 1). A conflict with the filename should be flagged.
- **Severity:** High: a whole month can be published on the wrong dates. **VERIFIED-RUNTIME.**
- **Fix:** In `_calendarDetectMonthYear`, collect every match with its string index and choose the earliest. Better, limit detection to text above the weekday header row (y < headerY). Also check that the first date row's weekday layout matches `new Date(year,month-1,1).getDay()`, and throw if it does not.
- **Test:** Run the second case in `cases2.mjs`. Expect December 2026 with 18 sessions.

## SCH-03 — Times like "7 - 9 PM" are imported as 7–9 **AM** (trailing AM/PM is cut off by the token reader)
- **Portal:** Upload Calendars · `_calendarParseCell` 14856 together with `_calendarPdfLines` 14680 and `_calendarParseTime` 14590.
- **Current:** `_calendarPdfLines` splits every text run into one-word tokens. The forward-reading loop stops as soon as `timeRx` matches, and `"7 - 9"` already matches before the `"PM"` token is read. The AM/PM heuristic then prefers the earliest start that fits.
  - Results: "7 - 9 PM" → 7:00–9:00 AM, "7:30 - 9:30 PM" → 7:30–9:30 AM, "8 - 10 PM" → 8–10 AM.
  - "6 - 9 PM" happens to come out right, but it is labelled "AM/PM assumed" even though PM was printed.
  - The draft review allows no per-row editing, so the only options are approving the wrong times or rejecting the whole month. (`cases3.mjs`)
- **Severity:** High: sessions are published at the wrong time, which also shifts reminders and the certify gate. **VERIFIED-RUNTIME.**
- **Fix:** In `_calendarParseCell`, after `tm` is found, read one more token if it matches `/^(AM|PM)\.?$/i`, and include it before `_calendarParseTime`. Equivalently, match `timeRx` against the joined cell text plus the following 2 tokens.
- **Test:** Run `cases3.mjs`. Expect PM for all evening rows, with no "assumed" flag.

## SCH-04 — Location printed after the time is never read; every such session gets the course's default location
- **Portal:** Upload Calendars · `_calendarParseCell` 14856 and `_calendarExtractWhere` 14632.
- **Current:** `full` only contains the tokens up to the time, so a location line after the time is never seen. Examples:
  - "Orientation 1 / 9 - 12 / At East 14th St" → **Zoom**.
  - "CPR In Person / 9 - 12 / Via Zoom" → **East 14th Street**.
  - "First Aid / 9 - 11:30 / At 120 Ave M" → Zoom.
  - Even the same line, "9 - 11:30 Via 120 Ave M" → Zoom.
  - The location is only picked up when it is printed *before* the time. (`cases1.mjs` and `cases2.mjs`: every "SCIP … At 120 Ave M" came out as East 14th Street.)
- **Severity:** High: people are sent to the wrong site, and Zoom links are included or dropped wrongly. **VERIFIED-RUNTIME.**
- **Fix:** After the time is found, keep reading the following tokens until the next course title or the end of the cell, and pass that text to `_calendarExtractWhere`. Flag any session whose location came from the default.
- **Test:** Run the first case in `cases2.mjs`. Expect East 14th, Zoom, 120 Avenue M, 120 Avenue M and East 14th.

## SCH-05 — Late certification overwrites a newer completion date (compliance date goes backwards and the change is saved)
- **Portal:** Instructor/Admin › Attendance › Finalize · `certify` 14442, specifically `rosterState=...dt:{...r.dt,[code]:dshort}`.
- **Current:** Staff 19780 had CPR dt 7/27/26, expiring 7/27/28. Certifying a 6/17/26 CPR session they attended set dt to **6/17/26**, expiring 6/17/28 (`t2.mjs` A). `roster` is part of `_opsSnapshot` (12085), so the older date is saved. `applyCompletionsToRoster` would have kept the newer date.
- **Severity:** High: expiration dates end up wrong, and staff show as expired earlier than they are. **VERIFIED-RUNTIME** (in-session); persistence VERIFIED-CODE.
- **Fix:** Replace the direct `rosterState` map with `this.applyCompletionsToRoster(this.applyVoidsToRoster(this.state.roster,docs),docs)`, as `correctCertifiedAttendance` already does. That path only ever moves a date forward and also applies `COMPLETION_SATISFIES`.
- **Test:** Run `t2.mjs` A. The date should stay 7/27/26, and the 6/17 completion should still appear on the transcript.

## SCH-06 — Re-uploading a month's calendar resurrects cancelled classes and overwrites admin edits (capacity, instructor, status)
- **Portal:** Upload Calendars › Approve · `publishOfficialCalendar` 15205.
- **Current:** `t3.mjs` published November, then made admin changes, then re-uploaded:
  - (a) An FA class that the admin had **cancelled** came back as a new `Scheduled`, `registrationOpen:true` session. `cancelledSessions` is never consulted.
  - (b) SCIP capacity 12 → reset to 10, and instructor "Sara Schwedelson" → replaced with the default "Yevgeniy Tseytin, Maria Ghenzeli". The assigned instructor loses access to the session.
  - (c) Capacity is overwritten without the "capacity < enrolled" check that `addSession` enforces, so over-capacity sessions can be created.
  - (d) If the revised PDF moves a class time (4–7 → 5–8), a **second** session is created. The 6 registrants stay on the old session, which is only flagged. No reschedule or notice is sent.
  - (e) `status:'Scheduled'` is also written onto matched sessions that are certified or in progress.
- **Severity:** High (the cancelled-class resurrection and the stranded registrants). **VERIFIED-RUNTIME.**
- **Fix:**
  - When a session matches, update only the fields that come from the PDF (title, date, when, where), and only while the session is untouched. Keep `capacity`, `instructor` and `status` if they have been edited or the session has a roster, or show the differences for approval.
  - Skip any `x.sessionKey` that matches a `cancelledSessions` entry, and list those rows in the review.
  - For a moved time on a session with a roster, offer "move registrants" through the existing reschedule/notify path.
- **Test:** Run `t3.mjs`. Expect capacity 12, Sara kept, no FA session revived, and a prompt to move the CPR registrants.

## SCH-07 — No role guard on session cancellation; certified or past sessions can be cancelled, notifying staff that their "upcoming" class is cancelled
- **Portal:** Admin/Instructor · `requestCancelSession` and `confirmCancelSession` 9382/9384.
- **Current:** Logged in as **instructor**, calling `confirmCancelSession` on a certified June session removed it from `sessions`, queued 5 "Your upcoming training session has been CANCELLED" notifications, and left its completion in place. Attendance for that session can no longer be corrected, because `openScheduledSessionAttendance` treats cancelled sessions as read-only (`t2.mjs` C). Every other mutating method here checks role; this one does not.
- **Severity:** High: this is a permission failure, and it also produces false notices and an orphaned completion. **VERIFIED-RUNTIME.**
- **Fix:** In `confirmCancelSession` and `requestCancelSession`, require `role==='admin'`. Refuse when `_sessionLocked(s)`, or when the session is past or has recorded attendance; direct those cases to the correction path instead.
- **Test:** Instructor cancel → refused. Admin cancel of a certified session → refused.

## SCH-08 — Editing a certified session's date or time does not update its completions, and edits don't update request snapshots
- **Portal:** Admin › Scheduled Sessions › Edit · `addSession` edit branch 8596.
- **Current:** Changing the date of a certified session (6/17 → 6/10) is accepted. The completion stays at 6/17/26 (`t2.mjs` D), so the session and the transcript disagree. The reschedule notice path also fires for a past class. Separately, for any date change, the `requests[].sessionDate/sessionTime/sessionLocation` snapshots are not refreshed (only the reschedule-from-cancelled branch refreshes them).
- **Severity:** Medium. **VERIFIED-RUNTIME** (completion); VERIFIED-CODE (requests).
- **Fix:** Block edits to date, time and code on `_sessionLocked` sessions, or route them through an audited correction that re-dates the completions and voids. In the edit branch, map the matching requests to the new date, time and location.

## SCH-09 — "AMAP Day 1 - 2" / "SCIP Day 1-2" multi-day entries are imported as Day 1 at 1:00–2:00 PM
- **Portal:** Upload Calendars · `_calendarParseCell` (the `timeRx` search on the title tokens).
- **Current:** The "1 - 2" in the title matches the time pattern, so "AMAP Day 1 - 2 / 9:00 AM - 5:00 PM" → `AMAP1 1:00 PM–2:00 PM`, and the Day 2 session is lost. The same happens with "SCIP Day 1-2" (`cases1.mjs`).
- **Severity:** Medium: a wrong time and a missing Day 2, with no warning. **VERIFIED-RUNTIME.**
- **Fix:** Start the time search after `titleEnd`, never inside title tokens. Detect "Day 1 - 2" / "Days 1 & 2" and either create both day sessions or send the entry to the skipped list.

## SCH-10 — Capacity/waitlist gaps: no promotion when capacity rises, pending requests hold seats against admin adds, and nothing prevents double-booking the same course or overlapping classes
- **Portal:** Register / Session Requests / Scheduled Sessions · `addSession` edit, `sessionCapacityLive` 14333, `validateRegistrationLive` 14341, `registerStaff` 14378.
- **Current (`t5.mjs`):**
  - Raising capacity 2 → 4 left both waitlisted staff on the waitlist (`remaining:2`). Only `removeFromRoster` promotes.
  - The same staff member was approved into two First Aid sessions on the same day with overlapping times (9–11:30 and 10–12:30). There is no duplicate-course or time-conflict check.
  - Admin direct adds count pending manager requests as used seats and waitlist people even though seats are free. Denying those requests later does not promote anyone.
- **Severity:** Medium. **VERIFIED-RUNTIME.**
- **Fix:**
  - After a capacity edit, promote waitlisted staff in order, reusing the promotion logic from `removeFromRoster` and its notifications.
  - In `validateRegistrationLive`, warn (managers: block) when the staff member already holds an active registration for the same `sessionCourseKeyFor` in another upcoming session, or when the times overlap.
  - Promote on `denyReq` when the denial frees a seat.

## SCH-11 — Post-certification corrections leave the session roster `result` stale; a correction from absent to present records "failed" first
- **Portal:** Admin › Attendance correction · `correctCertifiedAttendance` 14492.
- **Current:**
  - After a correction to absent, `session.roster[].result` stays `'completed'` (`chain.mjs`). This is the field Scheduled Sessions and the printed sheet fall back on.
  - Correcting a no-show to "present" without also setting pass gives `nowPass=false`. That writes a void for a completion that doesn't exist and sets the request to `failed`. A second correction (pass) is needed.
  - Completions created by corrections have no `completedAt`.
- **Severity:** Low–Medium. **VERIFIED-RUNTIME / VERIFIED-CODE.**
- **Fix:** Update `roster[].result` in the same `sessions` map. When the correction is absent → present, require a pass/fail choice in the same prompt. Add `completedAt`.

## SCH-12 — Import silently drops entries printed in leading/trailing adjacent-month cells, and rejects the whole month for "9am to 5pm"
- **Portal:** Upload Calendars · `_calendarPageCellsGrid` (a `day<1||day>maxDay` return, with no report).
- **Current:** Orientation 1 and First Aid printed in the Jan 1/Jan 2 cells of a December PDF disappeared with no "not captured" notice. Time written as "9am to 11:30am" blocks approval of the whole month (safe, but strict). (`cases1.mjs`)
- **Severity:** Low. **VERIFIED-RUNTIME.**
- **Fix:** Collect text from out-of-month cells, and if it looks like a training entry, add it to `skippedEntries` or show it as "belongs to adjacent month". Accept `to` as a range separator in `timeRx`.

## SCH-13 — Attendance descriptions: wired end to end, with gaps
- **Portal:** Admin › Course Information → Admin Attendance, Instructor Attendance Sheet, printed sheet from Scheduled Sessions · `saveCourseInformation` 7527ff, `courseDescription` 7499, bindings 16221/16306, and 9366.
- **Verified (runtime, `t4.mjs`):** A custom CPR description saved in Course Information appears on the Admin Attendance view and on the printed sheet from Scheduled Sessions, and it survives a reload. The instructor sheet uses the same `courseDescription` (VERIFIED-CODE).
- **Gaps:**
  - (a) **SDCH 1 and SDCH 2 have no default description**, so their sheets print none until an admin types one.
  - (b) CPR In-Person and CPR Blended share code `CPR`, so they can only have one description, even though they are different formats.
  - (c) Descriptions are not snapshotted. Reprinting a historical sheet shows today's description, not the one in force at the time.
  - (d) Custom Course Library courses have no default description.
- **Severity:** Low. **VERIFIED-RUNTIME.**
- **Fix:** Add SDCH1/SDCH2 entries to `COURSE_SHEET_SUMMARIES`. Allow a description keyed by session key (falling back to the code). Store `descriptionAtCertify` on the session when it is certified.

## SCH-14 — Walk-ins on the sheet cannot be recorded in the LMS after class starts
- **Portal:** Attendance · `addScheduledSessionStaff` (requires `scheduledSessionStatus==='upcoming'`, which is false once the start time passes). The instructor portal has no add path.
- **Current:** The sheet prints "walk-in sign-in lines", but once class begins nobody can add a walk-in to the roster. So a walk-in cannot receive a session completion; it has to be recorded as a separate manual completion without the session link.
- **Severity:** Medium (workflow gap; completions may not be recorded). **VERIFIED-CODE.**
- **Fix:** Allow an audited admin (optionally instructor) "Add walk-in" on uncertified sessions dated today or in the past, subject to the capacity override.

---

### Areas not conclusively tested
- Real HASC PDFs. All parser tests used synthetic PDFs that follow the parser's own geometry assumptions (8 vertical rules, date number at the top-left of each cell). The grid detection from rendered artwork and holiday handling were not exercised against real artwork.
- Multi-calendar queue (`importOfficialCalendarFiles`, skip, clear): code read only.
- Concurrent registration across devices or tabs. Operational state is a whole snapshot in local IndexedDB (`_persistOperationalState`), so writes are last-writer-wins and not shared between admins. This is an architectural issue for the Supabase migration and was not exercised.
- Actual notification delivery. Only queue rows were counted.
- Online/SCORM sessions and custom Course Library course sessions going through certify.
