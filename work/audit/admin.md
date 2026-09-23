# Admin Portal audit (ADM)

Build: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html` → `work/template.html`. Harness scripts are in `work/scratch/admin/` (smoke.mjs, t1–t7.mjs). Extracted service/store JS is in `work/scratch/admin/res/`.
Clock: no demo clock. `TODAY_MDY` is a getter over the live browser date (template.html:8006-8007).

**Render smoke test (smoke.mjs):** all 32 `NAV_BY_ROLE.admin` tabs rendered with no page errors and no `undefined`/`NaN`/`[object Object]` in the text. So did the 8 System Center sub-tabs (rulediag, audit, instructors, catalog, profiles, operations, backup, dupes).

**Persistence map:**
- Stored in IndexedDB `hasc_lms_state_v3`:
  - `operational`: roster, sessions, requests, notification queue/settings/templates, instructors, auditLog, locations.
  - `docs_v5_*`: completions delta, voids, archived, report templates/schedules, courseConfig, and courseInfo (inside meta).
  - `sharedStore`: HASCStore, which holds auto-assign rules and video training.
- Stored in localStorage: location requirement profiles (`hasc_locReqProfiles`) and the course library (`hasc_course_library_v1`).
- Not stored anywhere: `specialRetraining`, `staffPhones`, `locImportQueue`.

---

## ADM-01 Creating a Course Library course "mapped to" an existing requirement overwrites that requirement's global rules. **Critical · VERIFIED-RUNTIME**
- Where: Admin › Course Library. `createCourse()` (9086), `_buildMasterCourseCatalog()` (7423-7434, the `add()` merge branch), `catalogIntervalDays()` (7538), `baseRequiredFor()` (7896), `effStatus()` (8011).
- **Current behavior:**
  - When codes collide, the catalog merge copies `requiredFor`, `expiration` and `delivery` from the "dynamic" course-library record onto the built-in entry: `if(x.dynamic){… if(x.requiredFor)cur.requiredFor=x.requiredFor; if(x.expiration)cur.expiration=x.expiration; …}`.
  - The New Course form defaults `ncExp` to `'Annual'`. Built-in courses carry `expiration:null`.
  - For codes that are not in `INTERVAL_DAYS` (PA, O1-O3, DYS, EPP, SDCH…), `catalogIntervalDays` therefore starts returning 365, and `effStatus` ages every completion against it.
  - If "Compliance requirement" is ticked, `baseRequiredFor` returns `catalogAudienceMatches(dyn)` for the whole code. That throws away the role rules (nurse/SDCH/core-care) for that code.
- **Runtime evidence (t1.mjs):** created "PA Refresher Workshop" mapped to PA with default settings.
  - Before: 476 active staff with a required PA completion, all `g`.
  - After: `r:383, y:16, g:77`.
  - `expirationFor()` still displays "No expiration" (hard-coded NOEXP list, 8230), so the matrix says Expired while the transcript says No expiration.
  - The change persisted across a reload.
- **Expected:** a mapped course is an additional delivery that satisfies the existing requirement. It must never change that requirement's interval or audience.
- **Root cause:** the merge assumes a dynamic record is authoritative for rule fields.
- **Fix:**
  1. In `_buildMasterCourseCatalog` `add()`, when `cur.source==='built-in'`, do not copy `requiredFor`, `expiration` or `delivery` from a dynamic record.
  2. In `baseRequiredFor`, only use `catalogAudienceMatches` when the code is not a built-in (`!this.COURSE_NAME[code]`).
  3. In the form, hide or disable Expiration/Audience when `ncCode` is set, and state that the existing course's rules apply.
  4. Add a data migration that strips `expiration`/`requiredFor` from existing custom courses whose `code` is built-in.
- **Regression risk:** moderate. Genuinely new custom compliance courses must keep their own interval and audience.
- **Test:** repeat t1. PA counts must be unchanged. A new unmapped "Annual" compliance course must still expire after 365 days.

## ADM-02 Future-dated location requirement changes take effect immediately. **High · VERIFIED-RUNTIME**
- Where: Training Requirements. `saveLocReq()` (16836) stores `effDate`/`future`, but `locOverrideFor()` (7938) never reads them.
- **Current behavior (t2.mjs):** at 1014 Ave J 6-B, saved "CPR: not required, effective 12/31/26". All 5 affected staff moved from `g` to `info`/not-required at once, and `requiredFor()` returns false today. The toast and audit entry both say "effective 12/31/26".
- **Expected:** the base rule applies until `effDate`.
- **Fix:**
  - In `locOverrideFor`, return null when `ov.future && parseMDY(ov.effDate) > todayDate()`.
  - Apply the same check in `locAddedCodesFor` and `locReqIndex`, or filter there.
  - Include today's date in the memo deps for these paths. `_complianceGrid` already includes it.
  - Keep showing pending rules as "Scheduled" in the UI.
- **Regression risk:** low.
- **Test:** repeat t2. The status must stay `g` until the clock passes 12/31/26 (stub `todayDate`).

## ADM-03 Renewal-rule changes in Course Information leave the dashboard, matrix and reports stale. **High · VERIFIED-RUNTIME**
- Where: `saveCourseInformation()` (7525). `_cmpDeps()` (10228) omits `docs.courseInfo`. The same gap affects `state.customCourses`/`onlineCourses`, which also feed `catalogIntervalDays`/`baseRequiredFor`.
- **Current behavior (t2.mjs):** staff 3294, FA completed 1/16/25. After setting FA to Annual and saving, `effStatus` returns `r` but `_complianceGrid().byId['3294'].FA` is still `g`.
  - The confirm dialog says compliance "may recalculate immediately".
  - The dashboard, matrix, location rankings and agency aggregates stay wrong until an unrelated roster change or a reload.
- **Fix:** add `this.state.docs.courseInfo`, `this.state.customCourses` and `this.state.onlineCourses` to `_cmpDeps()`. Also add them to the deps of the `compRecsAll` and `certStatusMap` memos.
- **Regression risk:** low (costs one extra recompute).
- **Test:** repeat t2. The grid must equal `effStatus` right after saving.

## ADM-04 Backup "Import records" accepts any JSON, silently replaces docs and reverts completions to the shipped seed. **High · VERIFIED-RUNTIME**
- Where: System Center › Backup. `importData()` / `exportData()` (10125-10126).
- **Current behavior (t3.mjs):**
  - Importing `{"hello":"world"}` reported "Imported 24821 records." Completions changed from 24,654 to 24,821 because `completions:d.completions||window.HASC_COMPLETIONS` fell back to the seed.
  - `sheets`, `extCerts`, `internalDocs` and `importBatches` are overwritten with `[]` when missing.
  - There is no confirmation, no schema or version check, and no pre-import snapshot.
  - The roster is not re-derived (`applyCompletionsToRoster`/`applyVoidsToRoster` are not called), so compliance doesn't reflect the imported data until reload.
  - Export covers `docs` only. Roster edits, sessions, requests, locations, location requirement profiles, the course library, auto-assign rules and video training are not backed up, yet the page says the roster "loads from the system data file".
- **Expected:** a validated, confirmed restore of a full backup, with rollback.
- **Fix:**
  - Stamp exports with `{format:'hasc-lms-backup',version,exportedAt}` and include the ops snapshot, `locReqProfiles`, the course library and a HASCStore snapshot.
  - Refuse files without the stamp.
  - Show counts and ask for confirmation.
  - Never fall back to the seed. Treat missing fields as "keep current".
  - After restoring, recompute the roster as `loadData` does, and log an audit entry.
- **Regression risk:** moderate. Older export files need a legacy-accept path that runs after confirmation.
- **Test:** junk JSON is rejected. A round trip of export then import leaves record counts and compliance identical.

## ADM-05 Renaming an instructor orphans their sessions, and a reload re-creates the old name with a duplicate ID. **High · VERIFIED-RUNTIME**
- Where: Instructor Management. `saveInstructor()` (8591), `seedInstructors()` (8425), `instructorCanAccessSession()` (8228).
- **Current behavior (t4.mjs):**
  - Renamed "Yevgeniy Tseytin" to "… Jr". 10 sessions still reference the old name and 0 match the new one, so the instructor loses Attendance/Sessions access, which is matched by name.
  - After a reload, `seedInstructors` re-adds "Yevgeniy Tseytin" (from `SESSION_DEFAULT_INSTRUCTORS` plus session names) with the same `instructorId` `inst_seed_yevgeniy_tseytin`. There are now two active instructors with one ID, so edits and toggles hit both.
- **Fix:**
  - Reference instructors by `instructorId` in sessions (`instructorIds`), with the name kept for display.
  - Until then, have `saveInstructor` cascade the rename to `session.instructor` strings and log an audit entry.
  - Seed by ID, and skip a name whose seed ID already exists.
  - Make `SESSION_DEFAULT_INSTRUCTORS` admin-editable (see ADM-12).
- **Regression risk:** moderate. It touches session rosters and instructor scoping.
- **Test:** rename, then check that sessions follow and that there are no duplicates after reload.

## ADM-06 Changes made less than about 0.8 s before a reload or tab close are lost. **Medium · VERIFIED-RUNTIME**
- Where: `_scheduleOperationalPersist()` has an 800 ms debounce (12085). HASCStore `persist()` has a 700 ms debounce (store.js:466). There is no `pagehide`/`beforeunload`/`visibilitychange` flush anywhere.
- **Evidence (t4.mjs):** added an instructor, reloaded 200 ms later, and the instructor was gone. This applies to every change held in ops state: sessions, requests, locations, instructors, notification settings, and the roster archive side effects. Docs writes are immediate and not affected.
- **Fix:** on `pagehide` and `visibilitychange→hidden`, cancel the timer and call `_persistOperationalState()` and HASCStore `flushPersist()`. Also expose a `flush()` in the store.
- **Test:** repeat t4. The instructor must persist.

## ADM-07 "Assign special retraining" is cosmetic: not stored, not assigned to anyone. **Medium · VERIFIED-RUNTIME**
- Where: Course Library. `assignSpecialRetraining()` (9698). `state.specialRetraining` is not in any persistence path.
- **Current behavior:** the toast says "assigned & audit-logged". The entry disappears on reload (t2.mjs: 1 before, 0 after). "Affected" is a free-text label such as "All Staff". No staff record, assignment or due date is created, and nothing appears in Staff/Manager portals or reports. Only the audit-log line survives.
- **Fix:** either implement it as a real assignment (HASCStore `vtAssign`, or a `docs.specialRetraining` array with staff resolution and due tracking in Follow-up/reports), or remove the panel. At minimum, persist it in docs.
- **Test:** assign, reload, and check that the entry is still there and visible to the affected staff.

## ADM-08 Staff archive is one click with no confirmation; Staff Records has no archive/restore or edit. **Medium · VERIFIED-CODE**
- Where: `setArchived()` (8414) is only reachable from System Center › Staff Profiles (`onToggleArchive`, 16763). The Staff Records tab (4393-4580) is a read-only list.
- **Current behavior:**
  - Archiving immediately removes future session seats, withdraws requests, cancels reminders and withdraws online assignments (`_closeOperationalForArchived` and the HASCStore lifecycle). There is no `confirm()` and no reason is captured. Reactivating does not restore any of it.
  - The Staff Records list shows the first 60 rows (`list.slice(0,60)`) with no "showing 60 of N" note and no row actions.
  - There is no manual staff-profile edit anywhere (position, location, hire date, manager). The page itself says "Manual Updated entries will be available when manual staff-profile editing is added." Corrections have to go through a CSV import.
- **Fix:**
  - Add a confirm-and-reason modal to `setArchived` that lists the side effects, and log the reason to `staffChangeHistory`.
  - Add Archive/Restore/Edit actions and pagination to Staff Records.
  - For edits, add an audited `updateStaffProfile()` that re-runs `arRunForStaff(...,'lifecycle')`.
- **Test:** archiving prompts first, and cancelling the prompt changes nothing.

## ADM-09 Scheduled Reports compute rows differently from the report builder and never deliver anything. **Medium · VERIFIED-RUNTIME**
- Where: `runScheduleNow()` (9920) compared with `generateReportPreview()` (9710).
- **Evidence (t6.mjs), same filters:**

  | Report | Builder rows | Schedule rows |
  |---|---|---|
  | compliance | 70,998 | 71,076 |
  | missing | 1,842 | 1,850 |

  The schedule uses `docs.archived` instead of `complianceExcludedSet()`, so system/test accounts are included. It also ignores the configured `reportCourseFilterCodes` course sets, legacy-course handling and the date filters.
- The generated rows are thrown away; only `rowCount` is kept. There is no file to download and no timer; "due" schedules just show a badge. This is disclosed as "email integration required".
- **Fix:** move the row generation into one pure `buildReportRows(spec)` used by both functions. Store or make downloadable the generated workbook in the dispatch log.
- **Test:** row counts must match for every report type.

## ADM-10 Location-level renewal interval affects status but not the displayed expiration date. **Medium · VERIFIED-CODE**
- Where: `effStatus` uses `effInterval()` (7949, which honors the location override `intervalDays`/`oneTime`). `expirationFor()` (8230) uses `catalogIntervalDays()` and ignores location overrides.
- **Effect:** a site rule "CPR every 365 days" turns staff red after 1 year while the transcript, reports and certificates show a date 2 years out.
- **Related mismatch:** `statusFromDate` adds `days` (730) but `expirationFor` adds whole years, so they can differ by one day around Feb 29.
- Also, when an admin sets a course to "No expiration" (`renewalMode:'none'`), `effStatus` falls back to the imported `rec` letter, which may be a stale `r`.
- **Fix:** have `expirationFor(staff,code,…)` use `effInterval(staff,code)`. Compute status from `expirationFor` (one date function). When the interval is null and a completion exists, return `g`.
- **Test:** add a location CPR 365-day override. The status and the displayed expiration must agree.

## ADM-11 Voids are irreversible, and several admin config changes have no confirmation or audit. **Low-Medium · VERIFIED-CODE**
- Voids: there is no un-void or reinstate function anywhere (grep for unvoid/reinstate/restoreVoid). A mistaken void has to be re-entered as a new completion, which loses the original source and certificate ID. The void itself worked and persisted (t3.mjs: `g`→`r`, still there after reload).
- No confirmation:
  - `arDelete()` (12305, auto-assign rule delete)
  - `removeLocReqOverride()` (16847)
  - `toggleCustomCourse()`
- No audit entry, and queued reminders keep the old text: the notification text fields (org name, reply-to, contact email, footer, quiet hours; 9585-9680 `onSetOrg`, `onRemContact`…) write `reminderSettings` directly.
- **Fix:**
  - Add `reinstateCompletion(voidId)`: an audited, admin-only function that removes the void and recomputes the roster.
  - Add confirms to the three functions above.
  - Route the text settings through a debounced `setRemSetting` so they are audited and trigger `regenAllReminders`.

## ADM-12 Business rules hard-coded that should be admin-configurable. **Medium · VERIFIED-CODE**
Only per-course renewal interval/description (Course Information) and per-location overrides (Training Requirements) are configurable. The rest is fixed in code:

| Rule | Location |
|---|---|
| Role pathways | `baseRequiredFor` 7896; `NURSE_REQ`, `SDCH_REQ`, `OPTIONAL_TRACK`; regexes `isNurse` 7784, `isSDCH` 7786, `DSP_TITLE_RE` 7871, `staffInBucket` 7920 |
| O2/O3 not required for hires before 2018 | `hiredBefore2018` |
| New-hire grace window 90 days, and which courses get grace | `effGraceWindow` 7951; `GRACE_COURSES` 8009 |
| Due-soon thresholds 30/90 days | `statusFromDate` 8008 |
| Default renewal intervals | `INTERVAL_DAYS` 7955 |
| No-expiration course list | `NOEXP` inside `expirationFor` 8230 (duplicates the interval table and can contradict it; see ADM-01) |
| Session defaults | `SESSION_DEFAULT_DUR`, `SESSION_DEFAULT_LOC`, `SESSION_DEFAULT_INSTRUCTORS` 7341-7343 |
| Admin/instructor accounts | `ACCOUNTS` 8082 (there is no user/role admin UI) |
| Report compliance column set | `BASE_RPT_COMPLIANCE_CODES`, `MATRIX_COLS` |
| Location-ranking tiers | 95/90/80 |
| Certificate branding | `DOCUMENT_BRANDING` |

Recommendation: move these into a persisted `docs.policy` object with defaults equal to the current constants. Add a Setup › "Compliance Policy" editor (audited, with the same impact preview as location rules), and read through accessor functions.

## ADM-13 Regression: the in-app QA suite has been stubbed out again. **Medium · VERIFIED-CODE**
- `_qaResultsCompute()` (9922) returns one row: "QA suite not included in this build".
- The previous audit (AUDIT_REPORT.md §10) had replaced this with 56 outcome checks plus a negative control.
- The `qa` tab is also in `go()`'s retired set (8255) and redirects to System Center, so the suite is both empty and unreachable. None of ADM-01/02/03 would have been caught.
- **Fix:** restore the 56-check suite from `HASC_LMS_v5_production__6_audited.html` behind a System Center card. Add checks for the defects in this report: a grid-vs-`effStatus` equality sample, a mapped-course non-interference check, and a check that future-dated overrides are ignored.

## Other observations (not issues, or covered elsewhere)
- Auto-assign rules persist in HASCStore and run on hire, reactivation and lifecycle import (11733, 8419). They are limited to Video Training items. `arDueFor` turns local midnight into a UTC ISO date, which is off by one day only east of UTC.
- The Location Import Review Queue is seeded from three hard-coded demo names (8545) and is never fed by real imports or persisted. In this build it is empty and every roster location resolves, so there is no current impact.
- Overdue Follow-up: the session picker offers only future sessions of the matching course code. This data set has no future sessions (all dated ≤ Jun 2026), so enrolment can't be exercised. AMAP/SCIP overdue items can never match sessions coded `AMAP1`/`SCIP1`.

## Areas not conclusively tested
- Notification dispatch content after settings changes (queued job text vs current settings).
- Course Library online/SCORM creation and version publish. Certificate-config propagation (belongs to the certificates auditor).
- Location merge/alias effects on manager scoping.
- Renewal Forecast and Location Rankings figures beyond rendering. They share `_cmpDeps`, so ADM-03 staleness applies to them.
- Cross-tab sync for location requirement profiles (their localStorage key is not in `_handleStorageSync`, so another open tab would not pick up changes until reload).
