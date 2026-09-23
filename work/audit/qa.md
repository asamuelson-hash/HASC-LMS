# QA / Regression Testing — HASC LMS (area `qa`, prefix `QA-`)

Tested build: `work/out.html` (unmodified baseline `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html`).
Code references are to `work/template.html`. **Note:** someone edited `work/template.html` while this
audit was running (for example, `parseMDY` is now strict and `isFutureDate()` was added). Line numbers
are approximate, so use the function names to find code. Runtime results come from the baseline `out.html`.
Scratch scripts: `work/scratch/qa/` (`sweep.mjs`, `clicks.mjs`, `edge.mjs`, `fixes.mjs`, `empty.mjs`,
`desc.mjs`, `trimp.mjs`, `future.mjs`, `dup*.mjs`, `perf.mjs`); raw output: `sweep_*.json`, `clicks_*.json`.

**Clock:** there is no demo clock. `todayDate(){ return new Date(); }` (~7965) uses the real date, 2026-09-22.

## Summary of the runtime sweep

| Check | Result |
|---|---|
| Tabs rendered | 57: 40 admin (32 in NAV_BY_ROLE + 8 System Center tabs), 10 manager, 3 instructor, 4 staff |
| pageerrors / console errors | **0** on every tab. The only messages were the offline CDN `ERR_FAILED` and permissions-policy noise |
| Blank screens | 0. Smallest page is the manager Requests empty state (503 chars), and it shows a correct empty-state message |
| `undefined` / `NaN` / `[object Object]` / `Invalid Date` / raw `{{ }}` in `innerText` | 0 hits on all 57 tabs, including edge cases (a staff member with no completions, a manager with no locations, an instructor session with 0 registrants) |
| DC runtime "never resolved" bindings | 2 (QA-04, QA-05) |
| Slowest tab renders (setState to paint) | manager `needs` 1159 ms · admin `reports` 851 ms · admin `voids` 665 ms (824 buttons) · admin `rulediag` 656 ms · admin `forecast` 457 ms. All other tabs are under 300 ms |
| Buttons clicked | admin 838 OK · manager 203 OK · staff+instructor 38 OK. 30+19+9 no-op (triaged below) · 9 timed out at 1.5 s (heavy synchronous work, QA-09) · 64 destructive buttons skipped |
| Newest feature (attendance course descriptions) | All 12 session codes resolve to a description. An admin description overrides the default and shows on the attendance tab. An HTML payload is escaped (`<img onerror>` did not run). **No defects found.** |

## Status of the 11 fixes from AUDIT_REPORT.md

| # | Fix | Status in this build | Evidence |
|---|---|---|---|
| 1 | Docs persistence moved off localStorage (IndexedDB) | **Holds** (redesigned as the v5 delta store, `_persistAllDocsV5`) | Runtime: 3 completions recorded, page reloaded, all 3 still present |
| 1b | Staff import no longer rolls back at scale | **Holds** | Runtime: 3-row Empeon CSV → "Import applied atomically: 1 created, 2 updated"; new hire present |
| 2 | `recordPouring()` ReferenceError | **Holds** | `rnCandidate&&this.isNurse(rnCandidate)` (~10011) |
| 3 | Archived staff blocked from login and active lists | **Holds functionally**; the performance part **regressed** (QA-06) | Runtime: archived ID → "No active staff member with that Staff ID."; 0 archived in `activeStaffRoster()` |
| 4 | First-login temporary password = last name | **Holds** (`nameParts()`) | Runtime: first name rejected with a hint; last name accepted and opens pwSetup |
| 5 | `deriveEmail()` "Last, First" | **Holds** | `Aaraf, Twabib` → `taaraf@hasccenter.org`; login by that email works |
| 6 | `schCount` key collision | **Holds** (Reports now uses `rptSchCount`) | only one `schCount:` key remains |
| 7 | `approveReq` setTimeout misuse | **Holds** | two separate statements inside the arrow function |
| 8 | Void modal "Related session" blank | **REGRESSED** (QA-03) | runtime warning `{{ vmRec.sessLabel }} never resolved` |
| 9 | Duplicate `pourFormLabel` key | **REGRESSED** (QA-08) | the key appears twice in the renderVals object (~16315) |
| 10 | QA / Workflow Test Center: 56 checks | **REGRESSED** (QA-02) | stub is back and the tab is retired |

---

## Findings (most severe first)

### QA-01: Free-text date fields accept impossible, future and wrong-century dates and silently change the compliance result. **High** · VERIFIED-RUNTIME (baseline)
- **Where:** Admin → Add Independent Session / Add Pouring / RN Courses / Add External Certificate / Import training record. Code: `parseMDY()` / `_yr()` / `formatMDY()` (~7973-7979), `recordCompletion()` (~10123), `recordPouring()` (~10004), the RN-course recorder (~10038), `trainingImportBuildRow()` (~11314).
- **Current behavior (baseline):** all of these dates are accepted and each produced the success toast "Completion recorded…":
  - `12/1/2026` (70 days in the future) → staff CPR letter turns **r → g**.
  - `3/3/2126` is stored as `3/3/26`, so it silently becomes 2026 → **r → g**.
  - `6/1/2099` is stored as `6/1/99`, which reads back as 1999, so the record is already expired and the status stays r.
  - `13/45/26` rolls over to `2/14/27`; `2/31/26` rolls over to `3/3/26`; `0/0/26` becomes `11/30/25`.
  - The training-record importer marked `1/1/2099` as **"Ready: Will update transcript and current compliance."**
- **Expected:** reject impossible calendar dates, reject completion dates after today, and never quietly change the century.
- **Root cause:** `new Date(y,m-1,d)` rolls invalid dates over instead of failing. There was no check for future dates. `formatMDY` stores only a 2-digit year, and `_yr` maps it back into the 1951–2050 window.
- **Status:** the in-progress `template.html` has a strict `parseMDY` and adds `isFutureDate()`, but that check is only called from `recordCompletion()` and the external-certificate path (~10059). **`recordPouring()`, the RN-course recorder and `trainingImportBuildRow()` still have no future-date check.** The 2-digit-year storage in `formatMDY` is still there.
- **Fix:** call `isFutureDate()` in every completion writer, including the training import (mark those rows Blocked). Reject parsed years outside 1990..today+1 before formatting. In the longer term, store ISO `YYYY-MM-DD`.
- **Regression risk:** low. Seed dates are all 2-digit years inside the window.
- **Test:** run `work/scratch/qa/future.mjs` and `trimp.mjs`. Expect rejection toasts or Blocked rows, and no change to the status letter.

### QA-02: The QA / Workflow Test Center was removed again (regression of AUDIT fix #10). **Medium** · VERIFIED-CODE
- **Where:** Admin → System Center. `_qaResultsCompute()` (~9947) and `go()` (~8280).
- **Current behavior:** `_qaResultsCompute(){ return [{name:'QA suite not included in this build', …}] }`. The `qa` tab key is also in the `retired` set in `go()`, which sends it to `system`. The System Center "QA & Testing" card, `aQaTab`/`qaTests`/`qaCoverage` and `exportQaSummary()` are all gone. `qaResults()` is now dead code. The previous build (`prev.html` ~10322) had the 56 outcome-based checks.
- **Expected:** the check suite from the audited build is available to admins, or it is deliberately removed together with its dead `qaResults` memo.
- **Root cause:** the newer build was branched from a pre-audit source, or the suite was stripped when the dev-only tabs were retired.
- **Fix:** port `_qaResultsCompute`, `qaCoverage` and `exportQaSummary` from `scratch/qa/prev.html` (~9017, ~10307-10330). Also restore the tab, the renderVals keys (prev ~15771/15808) and the System Center card (prev ~15680). Remove `qa` from `retired`. The checks are pure reads (they are called from renderVals), so re-adding them is low risk. Review each check against features renamed in this build.
- **Test:** open admin → QA. Expect 56 rows, all PASS on seed data. Inject a duplicate roster seat and confirm the matching check flips to FAIL.

### QA-03: Void Completion modal shows a blank "Related session" (regression of AUDIT fix #8). **Low** · VERIFIED-RUNTIME
- **Where:** Admin → Course Completions → Void. Template ~6921 `{{ vmRec.sessLabel }}`. `openVoidModal()` (~10629). renderVals near `vmExpLabel` (~16253).
- **Current behavior:** the runtime warns `[dc-runtime] out: {{ vmRec.sessLabel }} never resolved — rendered as empty`. `sessLabel` is only added by the completions-table row mapper, not by `buildCompletionRecords()`. `vmSessLabel` no longer exists.
- **Fix:** add `vmSessLabel: vmRec ? (vmRec.sessionId ? vmRec.sessionId+(vmRec.sessionTitle?' · '+vmRec.sessionTitle:'') : '—') : ''` next to `vmExpLabel`, and bind `{{ vmSessLabel }}`.
- **Test:** `fixes.mjs`. Expect no "never resolved" warning and "—" or the session label shown.

### QA-04: Admin Reports KPI tile caption is blank (unsupported ternary in the template). **Low** · VERIFIED-RUNTIME
- **Where:** Admin → Reports, fourth KPI tile. Template ~4063: `{{ showArchived ? 'Records in view' : 'Active staff in scope' }}`. This is new since the audited build.
- **Current behavior:** the DC runtime does not evaluate expressions, so it warns "never resolved" and the tile caption under `aCountLabel` is empty.
- **Fix:** compute `aCountCaption` in renderVals (next to `aCountLabel`, ~10297) and bind it.
- **Test:** open the Reports tab with the checkbox off and on. Expect the caption to show in both states and no warning.

### QA-05: `isArchivedStaff()` reverted to a linear scan, so active-roster filtering is about 100× slower. **Medium (performance)** · VERIFIED-RUNTIME
- **Where:** `isArchivedStaff()` (~11428) → `employmentState()` → `isEmploymentActive()` / `isActiveStaff()`, which are called from 29 sites (login, registration validation, render paths).
- **Current behavior:** `(this.state.docs.archived||[]).some(id=>String(id)===String(s.id))` runs over 1,319 archived IDs for every staff check. Measured: `roster.filter(isActiveStaff)` over 4,053 records takes **72 ms**, against **0.7 ms** with the memoized `archivedStaffSet()`, which still exists. The audited build used the Set (prev ~11684).
- **Fix:** `isArchivedStaff(s){ return !!s && (s.archived===true || this.archivedStaffSet().has(String(s.id)) || this.archivedStaffSet().has(s.id)); }`. Better still, normalize the Set to strings once.
- **Regression risk:** the ID type differs (the archived list holds strings, roster ids are strings). Test with both.
- **Test:** `perf.mjs`. Expect under 5 ms and an unchanged active count (2,734).

### QA-06: Every seeded session is in the past, so registration is unusable at the real date. **Medium (data/ops)** · VERIFIED-RUNTIME
- **Where:** seed `sessions` (77, the last dated Wed, Sep 16, 2026). `isUpcomingSession()` (~7967) uses the real clock.
- **Current behavior:** there are 0 upcoming sessions. Admin and manager Register calendars have nothing to register for. Every `validateRegistrationLive` returns "That session is in the past." Instructors see all 5 of their sessions as "Past · not certified". Separately, none of the 77 sessions is certified, including past ones that have enrolled staff.
- **Expected:** a production dataset carries future sessions, or the calendar import is re-run. Past uncertified sessions with registrants should appear in a follow-up queue.
- **Fix:** load the Q4 calendar through Upload Calendars before go-live. Consider an admin dashboard count of "past sessions awaiting certification".
- **Test:** after the calendar upload, `edge.mjs` should find an upcoming session without the synthetic clone.

### QA-07: Training-record import has no batch undo, and duplicates are only checked when the file is analyzed. **Medium** · VERIFIED-CODE
- **Where:** `applyTrainingImport()` (~11388).
- **Current behavior:** each apply writes one `importBatchId`, but nothing reads `importBatches` to reverse a training batch. The staff import has `undoLastStaffImport()`; this importer has no equivalent. A wrong file, such as one with the wrong date column, can post thousands of compliance completions that can only be voided one at a time. Duplicate detection (`trainingImportExistingKeys`) runs when the file is analyzed and is not repeated when it is applied. Runtime tests: a double apply added 2 rows, not 4, because rows flip to "Imported". Re-analyzing the same file marks every row as Duplicate. An in-file duplicate row was caught. So idempotency holds on the normal path.
- **Fix:** add an "Undo last training import" action that bulk-voids, with an audit reason, every completion whose `importBatchId` matches. Recompute `existing` inside `applyTrainingImport` and skip keys that already exist.
- **Test:** import 3 rows, undo, and confirm the status letters and transcript are restored and the audit entries are written.

### QA-08: Duplicate `pourFormLabel` key in renderVals (regression of AUDIT fix #9). **Low** · VERIFIED-CODE
- ~16315: `pourFormLabel:this.pouringType(this.state.pourType).form` appears twice in the same object literal, with the same value, so it causes no visible bug.
- **Fix:** delete one of them.

### QA-09: Batch print blocks the main thread for more than 2.5 s. **Low-Medium (performance/UX)** · VERIFIED-RUNTIME
- **Where:** Admin/Manager → Transcripts / Certificates "Print all N matching…" (`printAllTranscripts()` ~8340), and the Admin Reports "Export Excel Workbook" button.
- **Current behavior:** printing all 2,731 transcripts froze the page for about 2.5 s with no progress indicator. Playwright's 1.5 s click budget timed out on this and on the export. The manager "My Reports" tab took 1.16 s to render on first entry. A double click during the freeze is queued, which can open two print windows.
- **Fix:** show a "Preparing N documents…" state and disable the button, then build in chunks (`await` a tick every 200 staff). Cap or confirm batches over about 500.

### QA-10: Controls that look usable but do nothing. **Low (UX)** · VERIFIED-RUNTIME
After excluding the tab or filter that is already active (for example "Light" theme, the current nav tab, "Clear" with no filter set, "This month" in the current month):
- **Course Progress KPI tiles** (admin and manager `progress`): "N ASSIGNED", "N% AVG PROGRESS", "N CERTIFICATES", "N TRANSCRIPT ENTRIES" are `<button>`s. Assigned and Avg Progress set the filter to `''` (a no-op when nothing is filtered), and Certificates and Transcript entries have no filter at all. Code: `const summary=[['Assigned',…,'']…` (~17010). They should render as non-interactive tiles, or apply a real filter. The Course Progress dataset is also empty (0 assigned) in both portals.
- **"← Previous" month** (admin dashboard calendar, admin/manager Register): at offset 0 it is only *styled* as disabled (`prevStyle` ~15445, `cursor:default`) but is not `disabled`, so keyboard and screen-reader users get a silent no-op. Set the `disabled` attribute.
- **"Select staff to print"** (Transcripts/Certificates, ~2517/5150): its `disabled` attribute is not applied at runtime (Playwright clicked it and the element's `.disabled` was false). The styling already says it is inactive, so the effect is cosmetic.
- **"Build Report"** sub-tab and **"All (N)"** filter chips were no-ops only because they were already selected. This is correct behavior.

### QA-11: Seed data contains 741 duplicated historical completion groups. **Low (data hygiene)** · VERIFIED-RUNTIME
- `docs.completions` holds 741 staff|code|date keys with 2–3 identical "Imported historical completion" rows (for example `imp54`/`imp55`, `4310|ART|6/2/24`). 191 of the first 200 checked belong to active staff.
- `buildCompletionRecords()` (17,587 unique keys) and `buildTranscript()` both **collapse** the duplicates, and voiding by `completionKey` voids all copies. No user-visible duplication was found. Raw exports or aggregates over `docs.completions` would double-count.
- **Fix:** dedupe once in the seed or migration, keeping the lowest id.

---

## Edge cases that passed (no issue)
- **Double submit (synchronous double call, which is what a double click does before a re-render):** `registerStaff` as admin gave 1 seat and 1 request. As manager, 1 request. `recordCompletion` added 1 record, and the second call was rejected as a duplicate. Two different courses recorded in the same tick got distinct ids. A double apply of the training import added no duplicates.
- **Reload mid-flow:** saved data survives. The sign-in is not kept across a reload (the in-memory session is deliberate for shared workstations), so an unsaved form is lost. That is by design.
- **Empty states:** a staff member with no completions, a manager with no assigned locations ("No staff in your locations yet", 0%), and an instructor session with 0 registrants ("0 of 0 attendance marked"; `certifyReady` false, so an empty session cannot be certified) all render cleanly.
- **Large lists:** Course Completions (17.6k records, paged, 824 buttons) renders in 665 ms. Locations has 351 buttons; Duplicates has 222.
- **Attendance descriptions (newest feature):** falls back from the Course Information override to `COURSE_SHEET_SUMMARIES`; print output is escaped via `this.esc`; admin and instructor views render. CPR In-Person and Blended share code `CPR`, so one description serves both (acceptable).

## Areas not conclusively tested
- Buttons behind modals or expanders. 280 button labels disappeared after re-selecting a tab and were not exercised: row-level actions on paged tables, and modal inner buttons.
- Destructive actions (void, archive, delete, reset, undo, restore) were skipped in the click sweep. Only import undo and void were exercised, through code and targeted scripts.
- Cross-tab and multi-window concurrency (the `storage`-event sync path).
- Real file uploads (PDF calendar, SCORM, certificate images). File choosers opened but were not fed files, except for the CSV imports.
- Instructor certification end to end on a future session, because no future session exists (QA-06).
- The full set of structural invariants the removed QA suite used to check (QA-02) was not re-implemented here.
