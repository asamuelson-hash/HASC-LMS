# Data Import & Integrity Audit (area: `import`, prefix IMP-)

Scope: staff roster import (`importEmpeon` → `pendingImport` preview → `applyImport` / `undoLastStaffImport`), training-record import (`importTrainingRecordFile` / `analyzeTrainingImport[Matrix]` → `applyTrainingImport`), the shared date parser `importDate`, the in-house XLSX reader (`_tiZipIndex`, `_tiXlsxSheetMatrix`, `trainingImportReadXlsx`; **no SheetJS**, it is a hand-written ZIP+DOMParser reader), attendance-sheet upload, and persistence (IndexedDB `hasc_lms_state_v3` kv store, localStorage pings, cross-tab sync).

Method: I fed malformed CSV/XLSX inputs through the real functions in the headless harness. Most runs used `TZ=America/New_York`, because the harness default is UTC and hides timezone bugs. Scripts: `work/scratch/import/p2..p11.mjs`, XLSX builder `mkxlsx.py`. The app has no demo clock: `todayDate()` returns `new Date()`, so browser time is 2026-09-22.

Baseline facts: 4,053 roster rows, all IDs are strings, 2 IDs have leading zeros (`000001`, `00000`, both "Intelex Support" accounts that count as active). Every stored date uses **m/d/yy (2-digit year)**, which `_yr` expands with pivot 50 (00–50 → 2000s, 51–99 → 1900s).

---

## IMP-01: Status text and future dates import as completions and make staff compliant
- **Portal/module:** Admin › Import training record · `trainingImportBuildRow` (l.11274), `importDate` (l.11372), `analyzeTrainingImportMatrix` (l.11288)
- **Current behavior (VERIFIED-RUNTIME, p4/p5):** Anything that begins with a status word followed by a date parses as that date. After apply, the staff member shows as compliant.
  - `Scheduled 10/30/26` became CPR completed 10/30/26 with status **Ready**. After apply, 20002 CPR = `g`, even though that date is after today (9/22/26).
  - `Due 11/1/2026` became DYS completed 11/1/26. `Expired 10/26/2024` became a completion on 10/26/24.
  - `1/5/2031` was accepted. 20002 FA = 1/5/31, expiring 1/5/33, status `g` for 7 years.
  - Root cause: `importDate` falls back to `new Date(raw)`. Chrome's lenient parser accepts `"Due 11/1/2026"`. Nothing checks for a future completion date.
  - In the wide "Executive Compliance Report" layout (COC/EHM columns), `Due …`, `Expired …` and `Pending 1` cells all import as completions. These are only Legacy transcript history, but they are still false records. The message still says "status-only values ignored".
- **Expected:** Completion dates are strict formats only (m/d/yyyy, m/d/yy, ISO, Excel serial). Text around a date is rejected. A completion date after today is Blocked, as is one implausibly old (for example before 1960 or before the hire date).
- **Severity: Critical.** Wrong compliance determinations, with no warning.
- **Fix:** In `importDate`, remove the `new Date(raw)` fallback, or restrict it to `/^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/` and `/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/`. Anchor the m/d/y regex at the end, allowing only an optional time: `^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?:[ T].*)?$`. In `trainingImportBuildRow`, block a date after `todayDate()` ("Completion date is in the future"). Use the same guard for the manual/independent completion paths.
- **Regression risk:** Low–Med. Some exotic date formats will now be rejected, but they show up as Blocked, not silently lost.
- **Test:** Rows with `Scheduled 10/30/26`, `Due 11/1/2026`, and tomorrow's date should all be Blocked. `10/26/2025`, `2025-10-26` and `45956` should still be Ready.

## IMP-02: Lenient date parsing invents dates from non-dates (numbers, missing year, year only)
- **Module:** `importDate` (l.11372). Used by training import, staff hire date, and expiration dates.
- **Current behavior (VERIFIED-RUNTIME, p2, NY timezone):**

  | input | result |
  |---|---|
  | `10/26` | 10/26/**2001** |
  | `Pending 1`, `Room 12`, `x 5`, `CPR 2` | 1/1/01, 12/1/01, 5/1/01, 2/1/01 |
  | `85`, `Score: 95` | 1/1/1985, 1/1/1995 |
  | `100` | 1/1/**2000** (year 100 → "00") |
  | `2025` | **12/31/24** (UTC midnight read in local time) |
  | `Oct 2025` | 10/1/25 |
  | `10/26/202` | 10/26/2020 (truncated year accepted) |
  | `10/26/20255` | 10/26/25 |
  | `20395` | 11/2/1955 (any 5-digit number is treated as an Excel serial) |

- **Impact on staff import (VERIFIED-RUNTIME, p7):** Hire Date `2025` overwrote staff 20002's hire date 11/5/24 with **12/31/24**. Hire Date `10/26` created staff with hire date 10/26/2001. Hire date drives the O1/O2/O3 due windows.
- **Severity: High.** Silent corruption of hire and completion dates.
- **Fix:** Same strict parser as IMP-01. Reject year-only, month-year and truncated 3-digit years. For the fallback, parse only full text dates and build them with `new Date(y,m-1,d)` (local), never `new Date('YYYY')`.
- **Test:** Each input in the table should return `''`.

## IMP-03: Single-course CSV auto-picks a numeric column (e.g. Score) as the completion date
- **Module:** `trainingImportSingleCourseSpec` / `trainingImportDateColumnScore` (l.10706–10714)
- **Current behavior (VERIFIED-RUNTIME, p5):** File headers were `Employee ID,Employee Name,Course,Score,Completed On` ("Completed On" is not an alias). Scores 85/92/100 were chosen as the date column, giving completions dated **1/1/85, 1/1/92, 1/1/00**, all Ready. The real `Completed On` column tied on valid-count and lost because it comes later. The preview shows no hint of which column was used as the date.
- **Severity: High.** Fabricated transcript history; missing courses become "completed 2000" and show as expired.
- **Fix:** Score only values that pass the strict date parser (IMP-01), which excludes bare 1–4 digit numbers. Require ≥80% of non-blank cells to be valid. Prefer headers matching `/date|completed|on$/i`. Show "Date taken from column 'X'" in the preview message and require confirmation.
- **Test:** The same file should pick `Completed On`, or refuse the file if it is ambiguous.

## IMP-04: Dates after 2050 are stored as 2-digit years and read back in the 1900s
- **Module:** `importDate` output `m/d/yy` (l.11379), `_yr` (l.7973), `formatMDY`, `calcExpiry` (l.10043)
- **Current behavior (VERIFIED-RUNTIME, p2/p4):** Expiration `12/31/2099` (a common "no expiry" sentinel in HR/LMS exports) was stored as `12/31/99`, read as 1999. After apply, 3294's CPR (completed 9/1/26) has `expOverride 12/31/99` and status **`r` (expired)**. `1/1/9999` becomes 1/1/1999. In the other direction, years 1900–1950 come back as 2000–2050 (`6/15/1950` → Jun 15 2050). `calcExpiry('CPR','10/26/49')` gives `10/26/51`, which reads as 1951.
- **Severity: High.** A current completion shows as expired. Any date typo becomes a century shift.
- **Fix:** Short term: in `trainingImportExpiration`, treat any expiration year ≥ 2051 (or ≥ today+20y) as "No expiration" and warn. Reject completion or hire years < 1951. Long term: store ISO `YYYY-MM-DD` (the comment at l.7970 already calls for this).
- **Test:** Import expiration 12/31/2099; the result should be status `g` and "No expiration".

## IMP-05: A partial active-only Intelex file can archive nearly the whole roster; coverage check bypassed
- **Module:** `importEmpeon` l.11674–11683 (`coverageSafe = profileKey==='intelex_active' ? true : coverage>=0.70`), `applyImport` l.11710–11712
- **Current behavior (VERIFIED-RUNTIME, p8):**
  - Test file: 60 existing active staff in Intelex column layout, all `Flag=A`, with "Full roster sync" enabled.
  - The plan was `fullRosterEligible:true` at **2.2% coverage** and archived **2,674 of 2,734 active staff (98%)**. The only guards were three `window.confirm` dialogs.
  - The result persisted across reload (active 60, archived 3,993). Archiving also withdraws requests, removes future session seats and cancels reminders (`_closeOperationalForArchived`).
  - Undo exists, but see IMP-07.
- **Severity: High** (mass data change on operator error; a department-filtered export is a realistic mistake).
- **Fix:** Apply a coverage floor to `intelex_active` too (for example ≥ 70%, or absolute missing ≤ max(25, 5%)), and allow an override only through a typed confirmation such as "ARCHIVE 2674". At minimum, refuse when coverage < 50%.
- **Test:** Rerun p8. `fullRosterEligible` should be false and `archiveMissingBlocked` true.

## IMP-06: Staff import replaces valid supervisors with location "placeholder" supervisors
- **Module:** `importEmpeon` l.11605–11631, 11666
- **Current behavior (VERIFIED-RUNTIME, p7/p8):**
  - Blank supervisor column: staff 11201 had `mgrId 3601` in the LMS. Re-imported with a blank Supervisor Number, the manager became `19405` (placeholder Area Coordinator). The existing LMS supervisor is never considered.
  - Filtered file: in an `intelex_active` file that does not include the supervisor's own row, every supervisor is flagged "not in the current active Intelex roster". All 60 staff in p8 had manager `20298` replaced with `4139`. This happened even with no archiving.
  - Either way the change is labelled only "review flags present"; it is not blocked.
  - Manager scope, approvals and notifications move to someone else.
- **Severity: High.**
- **Fix:**
  - Fall back to `existing.mgrId` when the source supervisor is blank or missing from the file but is still an active, non-archived LMS staff member.
  - Only treat "absent from active-only file" as stale when the file passes the full-roster coverage check (IMP-05).
  - List supervisor changes in a separate preview bucket that needs explicit acceptance.
- **Test:** Import 11201 with a blank supervisor; `mgrId` should stay 3601.

## IMP-07: Undoing the last staff import silently discards every later change
- **Module:** `undoLastStaffImport` (l.11737–11754), snapshot taken in `applyImport` l.11727–11728
- **Current behavior (VERIFIED-RUNTIME, p9):** Staff import, then a training import of 2 completions, then Undo staff import. The completion count went 24,656 → 24,654, and the training import batch record disappeared.
  - Undo restores the **whole** docs snapshot and the whole operational snapshot from before the import. Everything done since is rolled back: completions, voids, certificates, attendance sheets, sessions, requests.
  - The snapshot never expires, so it can happen days later.
  - The confirmation text mentions only roster, lifecycle, seats, requests and reminders.
- **Severity: High** (data loss).
- **Fix:** Make undo a reverse diff of the batch: remove the created IDs, restore the patched fields from `updatedStaff[].changes.from`, un-archive `archiveIds`, and re-archive `reactivateIds`. Alternatively, invalidate `lastStaffImportUndo` on any later `saveDocs` / operational change and warn about it in the confirm text.
- **Test:** Repeat p9. The training completions should survive the undo.

## IMP-08: Cross-tab last-writer-wins can silently drop an applied import and audit entries
- **Module:** `_persistOperationalState` (l.12088), `_handleStorageSync` (l.12101), `componentDidUpdate` persist trigger (l.12071)
- **Current behavior (VERIFIED-RUNTIME, intermittent 1 of 4 runs, p10):**
  - Setup: two admin tabs. Tab A applies a staff import (new staff 99990001); tab B is idle or logging an audit entry.
  - In the failing run, B's debounced persist wrote B's **stale whole snapshot** (roster, sessions, auditLog…) over A's commit. The ping made A hydrate the stale roster. The new staff member vanished from A, from B and from a fresh tab.
  - Other runs lost either A's "Staff import completed" audit entry or B's audit entry. Hydration does not merge `auditLog`, `locations` or `instructors`, but each tab persists its own copy.
- **Severity: High** (silent loss of applied data and audit trail; multi-tab admin use is normal).
- **Fix:**
  - Keep a monotonic `rev` in the `operational` record and compare-and-swap in one readwrite transaction (read `rev`, abort if it differs from the tab's loaded rev, then rehydrate and reapply).
  - Store `auditLog` append-only (separate key per entry, or merge by id) instead of in the snapshot.
  - At minimum, cancel a pending `_opsPersistT` when a foreign ping arrives, and rehydrate before writing.
- **Test:** Two tabs. B calls `logAudit` 0–300 ms before A's `applyImport`. The fresh tab must show both the new staff and both audit entries (loop 20×).

## IMP-09: Excel-mangled leading-zero IDs create duplicate staff
- **Module:** `importEmpeon` l.11584/11603 (`byId[id]` exact string), `trainingImportBuildRow` (`String(x.id)===sid`)
- **Current behavior (VERIFIED-RUNTIME, p7):** `011201` next to existing `11201` (same name and location) became **Create active**: a second person with no training, so false non-compliance. No warning is given for the same name, or for IDs that differ only by leading zeros. In the training import, `020002` and `20002.0` are Blocked, which is safe.
- **Severity: High** (duplicate people, split transcripts, inflated counts).
- **Fix:** Normalize IDs on both sides: trim, strip a trailing `.0`, and match numeric IDs by their unpadded value. A new ID that matches an existing ID after normalization, or an existing name + location, should be blocked with "possible duplicate of #…".
- **Test:** The `011201` row should be Blocked or matched to 11201.

## IMP-10: Excel 1904 date system not handled; namespaced sheet XML rejected
- **Module:** `trainingImportReadXlsx` / `_tiXlsxSheetMatrix` (l.11318–11332)
- **Current behavior (VERIFIED-RUNTIME, p5):**
  - A workbook with `<workbookPr date1904="1"/>` and serial 44804 (= 9/1/2026) imported as **8/31/2022**, Ready: shifted by 4 years and 1 day.
  - A sheet whose elements use an `x:` prefix (produced by some .NET OpenXML exporters) failed with "Could not find an Employee ID column". This one is safe but blocks the import.
  - Tab- and semicolon-delimited CSVs are also rejected (safe).
  - Cell number formats are ignored, so text-looking IDs with custom `000000` formats lose their zeros (see IMP-09).
- **Severity: Medium** (1904 case is silent wrong dates).
- **Fix:** Read `date1904` from workbook.xml and add 1462 to serials before `importDate`. Use `getElementsByTagNameNS('*','row'|'c'|'v'|'is')`. Optionally sniff the `\t`/`;` delimiter.
- **Test:** The 1904 file should give 9/1/26; the prefixed file should parse.

## IMP-11: Unknown or typo course codes import silently as Legacy history
- **Module:** `trainingImportResolveCode` (l.10693), `trainingImportBuildRow`
- **Current behavior (VERIFIED-RUNTIME, p4):** Code `CRP` (typo of CPR) became "Will import as Legacy Course transcript history only", status Ready. It was posted to the transcript, and the intended CPR completion was never recorded. Numeric codes with no title pass through as course "1", "2".
- **Severity: Medium**
- **Fix:** A code that matches neither the catalog nor `COURSE_NAME` should be `Needs review` (not Ready) unless the file marks it as legacy explicitly. Suggest the nearest catalog code.
- **Test:** A `CRP` row should not be Ready.

## IMP-12: No undo or rollback for training-record imports; persistence failure only toasts
- **Module:** `applyTrainingImport` (l.11346), `saveDocs` (l.10128)
- **Current behavior (VERIFIED-CODE; p4 shows `undoTrainingImport` undefined):**
  - Each row carries `importBatchId`, but no function removes a batch. Bad imports (IMP-01..04) can only be voided one completion at a time.
  - The roster and "Imported N" status update before the IndexedDB write resolves. If the write fails (quota, blocked storage), the user sees success plus a generic storage toast, and the data is lost on reload.
- **Severity: Medium**
- **Fix:**
  - Add "Undo batch": remove the completions with that `importBatchId`, then recompute the roster via `applyVoidsToRoster` / `applyCompletionsToRoster` from the seed.
  - Await `saveDocs` in `applyTrainingImport`. On `false`, revert state and mark the rows "Not saved".

## IMP-13: Blank columns wipe existing values; display-name split is naive
- **Module:** `importEmpeon` l.11666–11667, `importNameParts` (l.11437)
- **Current behavior (VERIFIED-CODE/RUNTIME, p7):**
  - An Email column with a blank cell sets `patch.email=''`. `emailValid` is true for blank, so the existing email is erased (no roster emails exist today, so impact is latent).
  - A blank SupervisorNumber clears or replaces the manager (IMP-06).
  - Display-name-only rows: `Mary Ann Van Buren` becomes last "Buren", first "Mary Ann Van". `Smith, John, Jr.` becomes first "John, Jr.".
- **Severity: Low–Medium**
- **Fix:** Skip a patch field when the source value is blank and an existing value is present (treat "blank" as "no data"). Offer an explicit "clear" override in the review grid instead.

## IMP-14: Attendance sheet re-upload replaces the previous file with no history; no size limit
- **Module:** `uploadSheet` (l.~11757)
- **Current behavior (VERIFIED-CODE):**
  - A second upload for the same session filters out the previous sheet, so the prior signed original is gone. Only an audit line "replaced" remains.
  - Files are stored as base64 data URLs inside the single `docs_v5_field_sheets` IndexedDB value, with no size cap.
  - Every sheet change rewrites the whole array. Large PDFs can hit quota, which only produces the storage toast.
- **Severity: Medium** (loss of a signed source document).
- **Fix:** Keep prior versions (`versions[]`, or mark superseded). Cap size (for example 10 MB). Store each file under its own IndexedDB key.

## IMP-15: Intelex support accounts are imported and counted as active staff
- **Evidence (VERIFIED-RUNTIME, p3):** IDs `000001` "Support ( Full Access ), Intelex" and `00000` "Support, Intelex" are active in the roster, so they count in compliance denominators.
- **Severity: Low.** **Fix:** Add a skip-list (IDs of all zeros, or name contains "Intelex Support") in `importEmpeon`.

---

## Verified OK (no finding)
- Duplicate Employee IDs within one staff file: all copies are blocked (l.11636).
- Duplicate training rows in a file or already on record: marked Duplicate. Stored dates are uniformly m/d/yy, so key matching works.
- An imported training completion **older** than the current roster date does not overwrite it (`applyCompletionsToRoster` keeps the newest).
- Staff re-import does not touch completions or `dt`. A blank hire date or unmapped location keeps the existing value.
- Invalid dates (02/30, 13/05, 26/10) are rejected. ISO strings with a time or `Z` keep their literal date, so there is no UTC off-by-one for `YYYY-MM-DD` because the regex runs first. Excel serials with a time fraction work.
- Unknown status (`LOA`, blank) is blocked. A status-less Empeon file blocks every row, which is safe but unhelpful.
- Full-roster archival is off by default. Non-Intelex profiles need ≥70% coverage.
- `applyImport` rollback on persistence failure works (p9): roster, archived list and IndexedDB are unchanged, with a clear message.
- Load precedence: IndexedDB `operational` vs legacy localStorage is chosen by `updatedAt`, and the seed completions are always taken from the build plus the delta.

## Areas not conclusively tested
- Calendar-upload import integrity (left to the scheduling auditor).
- Uploaded external certificates path (`extcert`), beyond reading the code.
- Real IndexedDB quota exhaustion (simulated only by forcing `_persistDocsNow` to fail).
- Very large (10k+ row) Intelex files: performance and yield batching.
- The one-time boot migrations (`scrubCompletionsAfterCutoff`, reference reconciliations) re-running if docs meta is lost. They could remove imported completions dated after 7/1/2026; not reproduced.
- Supabase/`_mirrorToService` import mirroring.
