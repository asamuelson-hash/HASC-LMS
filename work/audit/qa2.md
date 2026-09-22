# QA regression pass 2 — HASC LMS (area `qa2`, prefix `QA2-`)

Build under test: `work/out_review2.html` (frozen 22:59; includes the W1–W5 merges and the read-only staff preview, commit 5700900).
Baseline: `work/out.html`. Code references are to `work/template.html` (22:56). Function names are given alongside line numbers.
Scripts are in `work/scratch/qa2/`. `sweep.mjs` and `clicks.mjs` are the first-pass scripts, now parameterised with `BUILD=` and `TAG=` and with the `qa` tab added. Other scripts: `features.mjs` (new features), `ci2.mjs`, `cal2.mjs`, `phone.mjs`, `phoneprev.mjs`, `slow.mjs`, `aud.mjs`, `ooc.mjs`, and `old_*.mjs` (the first-pass targeted scripts pointed at the new build).
Raw output: `{base,new}_sweep_*.json`, `new_clicks_*.json`, `{base,new}_phone.json`, `features_*.json`. Phone screenshots: `work/shots/qa2/`.

**Result: no functional regressions found.** There were 0 page errors and 0 console errors across all 58 tabs, in the 3 admin-preview portals and on phone. No button throws. All 22 in-app QA checks pass.

## 1. Tab render sweep (new vs baseline)

| Check | Baseline | Review build |
|---|---|---|
| Tabs rendered | 57 (+ `qa`, which redirected to `system`) | 58: 41 admin including System Center sub-tabs and **QA Checks**, 10 manager, 3 instructor, 4 staff |
| Page errors / console errors | 0 | **0** |
| DC "never resolved" warnings | 1 (Reports caption, QA-04) | **0** |
| `undefined` / `NaN` / `[object Object]` / `Invalid Date` / raw `{{` | 0 | **0** (also 0 in edge cases: staff with no completions, manager with no locations, empty instructor session) |
| Blank screens | 0 | 0. Instructor Attendance (268 chars) and Sheet (272 chars) now show an empty-state prompt; see QA2-01 |
| Slowest tabs (setState to paint) | mgr needs 1029 · admin voids 1092 · rulediag 693 · reports 634 | mgr needs 1084 · reports 671 · rulediag 656 · voids 598 · forecast 542. All other tabs are under 340 ms. No render-time regression (±15%). Manager Home 169→189 ms after the Out-of-compliance card was added |
| Admin preview (`switchRole` manager/instructor/staff) | not tested in pass 1 | All 17 portal tabs render with 0 errors and 0 bad text. The banner stays up on every tab. "Return to my admin account" restores role=admin with `hopOrigin` cleared. Audit entries written during a preview are attributed to the admin, with `actingAs` noted. `exportData` is blocked while previewing |

## 2. Click sweep (same script, same skip list)

| Portal | Baseline OK / NOOP / UNCLICKABLE | Review OK / NOOP / UNCLICKABLE | ERROR |
|---|---|---|---|
| admin | 838 / 30 / 3 | 849 / 31 / 4 | 0 |
| manager | 203 / 19 / 6 | 210 / 20 / 0 | 0 |
| staff + instructor | 38 / 9 / 0 | 40 / 9 / 0 | 0 |

- **Now working (7):** manager "My Reports" (was unclickable on 4 tabs); manager "Print all N matching transcripts" and "Print all matching certificates"; admin "Print all matching certificates".
- **Newly flagged (4), none of them a regression:**
  - Admin Reports "🖨️ Print / PDF" and Create Report "Generate Preview" timed out at 1.5 s. Timed directly, both behave the same on both builds (QA2-03).
  - Reports pager "Prev" at page 1 is a no-op that is not `disabled`. It is the same button as in the baseline and belongs to the QA-10 class.
  - Manager "Light" is a no-op because the theme is already Light.
- **Removed buttons:** the 8 admin Attendance row controls (Present/Late/Absent/Pass/Fail/Override/×/Mark all) are gone because no session is preselected any more (QA2-01).
- **New features exercised:**
  - **Staff "My required trainings":** tested with 3 staff (5 overdue / 1 due soon / 1 overdue). The summary line matches `buildStaffCourses` exactly (5 = O2, O3, RNORI, RNPLAN, PONS). "Find a session" shows an informative toast (no upcoming sessions exist, QA-06). "View certificate" opens the cert modal. No errors.
  - **Manager Home "Out of compliance":** tested with 5 managers. The count equals the "With overdue" KPI in every case (233, 619, 615, 138, 27). Rows are sorted worst-first and capped at 15. No 0-overdue rows appear. The empty state renders for a manager with no locations. "Register staff" opens `register` and "See full report" opens `needs`.
  - **Backup/restore:**
    - Export produced `hasc-lms-backup-2026-09-22.json` (17 MB, format v2, 24,654 completions, 4,053 roster).
    - All 6 bad files were rejected with specific messages and changed nothing: bad JSON, an array, a foreign format, an unrelated object, `completions` that is not a list, and roster rows without an id.
    - A restore of the real backup removed a completion added after the export. The pre-restore banner appeared. "Undo last restore" brought the completion back. "Download it" produced `hasc-lms-pre-restore-…json`.
    - The state survived a reload.
    - The page is blocked while previewing another portal.
  - **Course Information impact preview:**
    - The CPR renewal was changed to Annual. The preview predicted "249 staff will change status (194 become overdue, 55 become due soon)". After Save, effective CPR `r` went from 189 to 383, which is exactly +194, and the due-soon arithmetic reconciles.
    - Recomputing the preview takes about 60–85 ms per change and per keystroke (memoised).
    - An invalid custom interval (−5 or "abc") hides the preview.
    - Choosing the unchanged "default" shows no preview.
  - **Calendar "Changes to review":**
    - An injected draft that moves a session with 3 registrants to a new time and location produced the expected warning.
    - A draft containing an LMS-cancelled session produced the "was cancelled… will not be re-created" line.
    - HTML in draft titles is escaped (`<img onerror>` did not run).
    - "Skip this month" clears the draft.
  - **Admin preview banner:** it names the admin and the previewed user. The staff variant states that it is read-only. The return button works (see section 1).

## 3. Phone viewport 390×844

24 main tabs across the 4 portals, plus the preview banner (admin → manager/staff), were rendered on both builds. **No page-level horizontal overflow** (scrollWidth = 390 everywhere), no bad text and no errors. The new blocks (staff required trainings, manager Out-of-compliance card, QA Checks, Backup, Course Information) lay out correctly (screenshots in `work/shots/qa2/new_phone_*.png`). **Nothing newly broken.** The phone issues that already existed (a tall header, a tab strip that is clipped sideways, the instructor Pass/Fail columns) are unchanged. They are UX-11, which was fixed in commit 371b9ca **after** this build was frozen, so `tools/tests/phone.test.mjs` scores 2/5 on this build, as expected.

## 4. In-app QA Checks

System Center → QA Checks (the tab now resolves, and the System Center card is present). `window.__hascLogic.qaResults()` returns **22 checks, 22 PASS, 0 FAIL, in 112 ms**. The areas covered are compliance status bands, expiry arithmetic, stale overrides, backfill, future dates, void fallback, new-hire and never-completed cases, SDCH equivalency, ART anchor, aggregation parity (dashboard / Location Rankings / N/A exclusion), Staff Portal parity, attestation, impossible dates, archived-exclusion and duplicate seats. "Run again" works and updates "Last run". **Negative test:** a duplicate roster seat was injected, and "Sessions: no staff member holds two seats in one session" flipped to FAIL as it should.

## Status of first-pass findings

| ID | Status on review build | Evidence |
|---|---|---|
| QA-01 dates | **Fixed** | `12/1/2026` gives "cannot be in the future", and `6/1/2099` and `3/3/2126` give "out-of-range year". Status letters are unchanged. Training import: 2099 and impossible dates → Blocked. Pouring and RN paths call `completionDateError` (~10392, ~10428) |
| QA-02 QA suite | **Partly fixed** (QA2-02) | Tab is restored with 22 checks, not 56. There is no export |
| QA-03 void "Related session" | **Fixed** | Shows "—"; no warning (`vmSessLabel` ~16957) |
| QA-04 Reports caption | **Fixed** | `aCountCaption`; 0 DC warnings |
| QA-05 `isArchivedStaff` perf | **Fixed** | Filter over the full roster takes 3 ms (was 72 ms); active count still 2,734 |
| QA-06 no future sessions | Open (data, deferred) | 0 upcoming sessions |
| QA-07 training import undo | Addressed (code) | `undoTrainingImport(batchId)` (~11909); `admin_import.test` 26/26 |
| QA-08 duplicate `pourFormLabel` | **Fixed** | 1 occurrence |
| QA-09 blocking print | Improved but still open (QA2-03) | Print-all transcripts about 1.7 s (was 2.5 s) |
| QA-10 decorative no-op controls | Open | Same set: progress KPI tiles, "← Previous" at offset 0, "Select staff to print", plus Reports "Prev" |
| QA-11 duplicate seed completions | Open | not re-tested; no code change |

Edge cases re-run on the new build all still pass: double submits, reload persistence, empty states, staff import, archived login, last-name first login, the attendance-description XSS check, and duplicate/idempotent training import.

---

## Findings (new in this pass)

### QA2-01: Attendance screens no longer open with a session selected after sign-in. **Low** · VERIFIED-RUNTIME
- **Where:** Instructor → Attendance and Attendance Sheet; Admin → Attendance. `USER_STATE_DEFAULTS` (~7426) now includes `instSession` in `named`, so `_userStateReset()` clears it on every sign-in, sign-out and portal hop. The boot-time default `instSession: firstAttendanceSession` (~14726) is therefore always overwritten and is now dead.
- **Current:** the instructor Attendance tab shows "Open a session from My Sessions to take attendance." and the Sheet shows "Open a session first." (the baseline showed the first session's roster and sheet). Admin Attendance shows the session picker with nothing selected. Opening a session from My Sessions (`openSession`) works, and a description override still renders once a session is chosen.
- **Assessment:** this is a side effect of the shared-workstation state reset (a security/privacy improvement), not a break. The empty state is clear. It is a small workflow change: one extra click for instructors.
- **Suggested:** optionally, after sign-in, pre-select the instructor's own next or most recent uncertified session (`instructorCanAccessSession`). Otherwise remove the dead default at ~14726.
- **Test:** sign in as instructor → Attendance. Expect either the own-session roster or the empty-state prompt, never another instructor's session.

### QA2-02: The in-app QA suite is back but carries 22 of the previously audited 56 checks and no export. **Low–Medium** · VERIFIED-RUNTIME
- **Where:** `_qaResultsCompute()` / `qaResults()` (~10261), renderVals `aQaTab` (~17287).
- **Current:** 22 outcome checks, all PASS, and "Run again" works. The audited build's `exportQaSummary()` and the coverage panel (`qaCoverage`) were not restored. Areas the old suite checked that are not covered now include registration/request workflow, certificate issuance, import idempotency, location-rule profiles and instructor access.
- **Expected:** parity with the audited suite (`scratch/qa/prev.html` ~10307-10330), or a documented decision to trim it.
- **Fix:** port the missing checks that still apply to this build, and `exportQaSummary`.
- **Test:** the QA tab shows N ≥ 56 checks, all PASS on seed data; Export downloads a summary.

### QA2-03: Report printing and preview still block the main thread (pre-existing; the harness flagged them as unclickable). **Low–Medium (perf)** · VERIFIED-RUNTIME
- **Where:** Admin → Reports "🖨️ Print / PDF" and Create Report "Generate Preview".
- **Measured (same on both builds):**

  | Action | Build | Synchronous | Until the page settles |
  |---|---|---|---|
  | Print / PDF | baseline | 1,023 ms | 5.36 s |
  | Print / PDF | review | 905 ms | 5.47 s |
  | Generate Preview | both | ~335 ms | ~1.45 s |

  Print-all transcripts improved to about 1.7 s (was 2.5 s).
- **Not a regression.** Same root cause and fix as QA-09: add a busy state, disable the button while it runs, and build the output in chunks.

### QA2-04: The "Undo last restore" label and message are misleading after an undo. **Low (UX)** · VERIFIED-CODE + RUNTIME
- **Where:** `undoLastRestore()` → `applyBackupRestore()` (~10545-10566).
- **Current:** the undo itself goes through `applyBackupRestore`, which first saves the current (restored) data as the new pre-restore copy. Pressing "Undo last restore" a second time therefore re-applies the restore (a toggle). After an undo the message reads "Restored full backup. Completions: 24654 now → 24655 in file…", which does not say that anything was undone.
- **Fix:** pass a flag from `undoLastRestore` so that the message reads "Last restore undone — data returned to <savedAt>". Either hide the undo button after an undo, or relabel it "Re-apply restore".
- **Test:** restore → undo → the message says undone, and the panel does not offer the same "Undo last restore" again.

### QA2-05: The admin preview banner takes a lot of space on a phone. **Low (UX)** · VERIFIED-RUNTIME
- On a 390×844 screen the yellow banner is 114 px tall (manager) or 133 px (staff, with the read-only sentence), below a header of about 270 px, so portal content starts about 400 px down. There is no overflow and the return button works. The UX-11 compact header landed after the freeze and should shrink this. Re-check on the next build.

## Notes for the lead (not findings)
- The frozen build fails `phone.test` (2/5), `review1.test` IMP-04 and `review2.test` (0/9). The matching fixes (commits 371b9ca, d06fdef, 18ff44d) or reviewer repro tests landed **after** `out_review2.html` was frozen, so these failures are expected and are not regressions. All other suites pass on this build: admin_import 26, certs 15, compliance 13, preview 7, rules 7, scheduling 20, security 18, surfaces 19.
- `go(tab)` does not check the tab against the current role: while previewing, `go('records')` sets `tab.manager='records'`. This cannot be reached from the UI and nothing admin-only renders. Noted only in case a deep-link feature is added.

## Areas not conclusively tested
- Row-level and modal inner buttons: 280 labels were "GONE" after a tab re-select, the same as pass 1.
- Restoring a legacy records-only export, and a restore when IndexedDB is full (the `saveDocs` false path).
- Approving a calendar through the real PDF path. The "Changes to review" box was driven by an injected draft, not by PDF parsing.
- Instructor certification end to end on a future session (QA-06, no future sessions).
- Cross-tab `storage`-event sync.
