# Review 2 — adversarial review of the merged batch-2 build

Build under test: `work/out_review2.html` (payload identical to `git show 5700900:work/template.html`; line numbers below refer to that template).
Baseline: `work/out.html`. Scratch scripts: `work/scratch/review2/` (compat.mjs, probe.mjs, mgr.mjs, restore.mjs, idor.mjs, perf.mjs).

## Summary
- All 9 suites pass on out_review2.html: 130/130 (admin_import 26, certs 15, compliance 13, preview 7, review1 5, rules 7, scheduling 20, security 18, surfaces 19), with no page errors.
- Baseline-to-new data compatibility (one persistent Chromium profile): **no data lost or misread**. The data set included an independent completion, a void, an approved EMT card (`CPR+FA`), a location override, pasted staff rows and the audit log. The only differences are the intended CRT-02 changes: older transcript rows now show their own expiry instead of the newest one.
- Performance: no regressions (table below).
- The merge introduced 6 confirmed defects that change compliance or record integrity, plus 3 smaller ones (listed below).

## Findings (most severe first)

### R2-01 Restoring a records-only (legacy) backup keeps compliance credit for completions that are no longer on record (High, VERIFIED-RUNTIME)
- Admin › Backup · `applyBackupRestore` (~l.10548), `backupRestorePlan` (legacy branch).
- Current behavior: when the file has no `operational.roster` (every baseline "Export records" file, and any full backup without a roster), the restore replays the restored docs onto the current, already-derived `this.state.roster`. `applyCompletionsToRoster` can only raise dates. A date backed only by a completion that the restored file does not contain stays in `dt/rec`, is persisted, and survives reload.
- Evidence (restore.mjs): staff 20691 had CPR red with no date. I took a legacy export, then recorded CPR 9/1/26, then restored the export. Result: the completion was gone from docs (`completionStillInDocs:false`), but `dt.CPR` was still 9/1/26 and status `g`. After a reload: still `g`, and the transcript shows a 9/1/26 CPR row.
- Expected: after the restore, compliance equals what the restored records support.
- Fix: in `applyBackupRestore`, when `op.roster` is absent, start the replay from a pre-completion base instead of the live roster. Use the import/seed roster (`hasc_import_roster_v2` / seed) plus staffChangeHistory. Alternatively, revert every `dt[code]` that matches a completion key present in the current docs but absent from the restored docs, falling back to `baseDt` or the seed date, before replaying. If neither is possible, refuse legacy restores and say why.
- Regression risk: moderate (restore only). Test: restore.mjs expects `after.st` to equal the pre-completion status, before and after reload.

### R2-02 Training-import undo writes key-only voids, so it also voids other same-day completions (High, VERIFIED-RUNTIME)
- `undoTrainingImport` (l.11886-11895).
- Current behavior: the undo entries carry `key` but not `completionId`. Key-only voids match every completion and roster date with the same staff|code|date, from any source. The `existing` set (l.11888) is built from the raw `completionVoids`. It therefore also counts voids that were later reinstated, so a reinstated key is skipped and that imported completion is not voided.
- Evidence (probe.mjs P3): staff 20809. I imported CPR 9/9/26, then entered an approved EMT card (CPR+FA) dated 9/9/26, then undid the import. Before the undo: CPR `g`, FA `g`. After: **CPR `r`**, FA `g`. The EMT card itself is not voided (`emtVoided:false`), but its CPR credit is gone.
- Fix: write `completionId: String(this.completionIdValue(c))` on each entry, as `voidCompletion` does. Keep `key` for older readers. Build `existing` from `this.voidIndex(docs0).ids` (by id) instead of the raw keys.
- Test: rerun P3. CPR must stay `g` because the EMT card remains, and IMP-12 must still pass.

### R2-03 CMP-07 "first completion" ignores reinstated and id-targeted voids, so the ART anchor moves (Medium-High, VERIFIED-RUNTIME)
- `_earliestCompletionIndex` (l.8126) and `firstCompletionDate` (l.8135) read `docs.completionVoids` directly, as a key set. W5 wrote these; W2's `activeVoids()`/`voidIndex()` never reached them.
- Two effects:
  1. A void that was later reinstated (CRT-12) still hides the date.
  2. A void aimed at one completion by `completionId` (CRT-03) hides every other completion with the same staff|code|date, including a valid re-entry.
- Evidence (probe.mjs):
  - P1, staff 20002: I added a certified O1 session completion on 3/2/20. `firstCompletionDate(O1)` was 3/2/20 and the ART anchor 6/12/25. I corrected it to Fail, then back to Pass (reinstated). The completion is active again (`isCompVoided:false`, and the transcript shows it). But `firstCompletionDate` stays 6/26/25 and the ART anchor moves to **6/26/25**.
  - P2, staff 18283: I voided O2 cmP2a (4/6/20) by id and re-entered cmP2b on the same date. The records show `cmP2a:V, cmP2b`, but `firstCompletionDate(O2)` = 3/12/23.
- Fix: in both functions use `const vi=this.voidIndex(docs)`. Skip a record with `this.isCompletionVoided(x,vi)`, and check only `vi.keys` (key-only voids) for its roster codes, exactly as `applyCompletionsToRoster` does. In `firstCompletionDate`, filter dt/baseDt with `this.isCompVoided(sid,code,d)` instead of the raw key set. Add `completionVoids` to the memo deps (already present).
- Test: P1 `afterReinstate` = 3/2/20 and the anchor goes back to 6/12/25. P2 `firstO2` = 4/6/20.

### R2-04 Cancelling a scheduled (future-dated) location rule also deletes the rule in effect (Medium-High, VERIFIED-RUNTIME)
- ADM-02 (W4) · `saveLocReq` (l.17611) stores the rule in effect only in `newOv.prev`. `removeLocReqOverride` (l.17624) deletes the whole entry.
- Evidence (probe.mjs P5, loc6): I saved CPR "every 365 days" effective now, then "every 1095 days" effective 12/1/26. The rule in effect stays 365 and the stored entry has `prev.intervalDays` = 365. Removing the override then leaves **`locOverrideFor` = null**: the location drops to the global rule today. The audit reads "Required · renew every 37 mo -> Inherit global default", which never mentions the 365-day rule that was dropped.
- Fix: in `removeLocReqOverride`, when `_ovPending(prevOv)` and `prevOv.prev` exist, replace the entry with `prevOv.prev` ("cancel scheduled change") instead of deleting it. Audit it as "Scheduled change cancelled; <prev rule> remains". Offer "Remove location rule" as a separate action. `restoreLocDefaults` should state that it also cancels scheduled changes.
- Test: rerun P5 and expect 365 after cancelling.

### R2-05 Instructor rename (W4 ADM-05) locks the renamed instructor out of their sessions (Medium, VERIFIED-RUNTIME)
- `saveInstructor` (l.8886) rewrites `session.instructor` to the new name. `instructorCanAccessSession` (l.8456, W3) matches `cu.name`. The static `ACCOUNTS.instructor` entries keep their old name, and so does any already-signed-in instructor.
- Evidence (probe.mjs P4): renaming "Sara Schwedelson" to "Sara Schwedelson-Levi" moved 6 sessions. After a fresh instructor sign-in, `currentUser.name` is still "Sara Schwedelson" and she sees **0** sessions (6 before).
- A related problem: directory instructors without an explicit email log in with `deriveEmail(fullName)`, so a rename also changes their login email. This was not run.
- Fix: resolve the instructor identity by `instructorId`/email, not by display name. At sign-in, map the account to its directory record by email (or `formerNames`) and set `cu.name = rec.fullName`. In `instructorCanAccessSession`, compare against `[rec.fullName, ...rec.formerNames]`. Freeze the login email on first save (store `email` when it was derived).
- Test: rerun P4 and expect 6 visible sessions after the rename.

### R2-06 Certificate view builds a certificate in one person's name from another person's completion (Medium, VERIFIED-RUNTIME)
- `resolveCompletion` (l.8529) returns `completionRecordById(completionId)` without checking the staff member or the code. It is used by `openCertFor` (l.14764) and the cert modal view model (l.16677). The W3 scope guard checks only `staffId`.
- Evidence (idor.mjs): signed in as staff 16796, I called `openCertFor('16796','CPR','imp22')`. imp22 belongs to staff 2714. The rendered certificate reads "Melana Matatov … CPR In-Person … April 11, 2010 · CERTIFICATE ID: HASC-16796-CPR-41110" and is printable through `smartPrint`.
- Fix: in `resolveCompletion`, accept the id match only when `this.completionStaffId(c)===String(staffId)` and (`completionMatchesCode(c,code)` or `completionCode(c)===code`). Otherwise fall through to the date lookup. In the modal, call `certificateBlockReason` as well.
- Test: idor.mjs should show no certificate, or a certificate for the staff member's own CPR only.

### R2-07 Manager Home mixes filtered and unfiltered numbers (Low-Medium, VERIFIED-RUNTIME)
- The Home KPI tiles and the W3 team line use `_mgrMatrixView(... this.state.mLoc, this.state.mSearch ...)`. The W5 "Out of compliance" card uses `followUpRows({list:scope})`, which is unfiltered. Home has no location control, so a filter left over from the Color Report silently changes the KPIs.
- Evidence (mgr.mjs, Mark Resnick): unfiltered, the team line reads "1950 staff". After setting the Color Report location to "Self Directed Com Hab" and returning Home, the team line and KPIs read "688 staff", while the card still says "708 of 1,950 staff have at least one overdue".
- Fix: on Home, call `_mgrMatrixView` with `''` for mLoc/mSearch (or show the active filter with a Clear control). Also have `followUpRows` include `locAddedCodesFor` codes so the card and `complianceSummary` agree. The data had no such case at present (`locAddedOnlyRed:0`).

### R2-08 Rule Diagnostic shows a scheduled rule as the rule in effect (Low, VERIFIED-RUNTIME)
- `ruleDiagnostic` (l.17642) reads the raw `overrides[code]` and never calls `_ovInEffect`.
- Evidence (P6): with a future "remove" rule for CPR, the diagnostic says "Not required" while `requiredFor` = true and the status is `r`.
- Fix: use `this._ovInEffect(profOv)` for the text and add "Scheduled: <rule> from <effDate>" when `_ovPending(profOv)`.

### R2-09 Void-history robustness (Low, VERIFIED-CODE)
- `activeVoids` (l.10952): a reinstatement created from a void without `voidId` gets `reinstatesVoidId: undefined`. That cancels every other void lacking a `voidId`, for example voids from externally produced or imported data. Guard with `v.voidId!=null` on both sides. `correctCertifiedAttendance` should refuse to reinstate a void that has no id.
- `backupRestorePlan` counts reinstatement entries under "Voided completions" (l.10536). Count `activeVoids` instead.

## Checked and found consistent
- Merge points: `openVideoCert`/`openCertFor`/cert modal scope guards are present on every path. `correctCertifiedAttendance` keeps W1 `completedAt` and W2 append-only reinstatement (CRT-12 passes). The W3 team line and W5 nav handlers both work. The W4 backup block keeps the W3 import guards and is admin-only and preview-safe.
- `applyVoidsToRoster`/`applyCompletionsToRoster` both go through `activeVoids`/`voidIndex`. The only raw readers of `completionVoids` are those in R2-02 and R2-03.
- `parseSessionDate` (W1) is used by `sessionDateObj`, the upcoming count (W5) and the calendar. I found no raw `new Date(session.date)`.
- The ADM-02 effective dates reach `initialDueInfo`, `requiredFor` and `locAddedCodesFor` through `locOverrideFor`/`_ovInEffect`.
- The W3 scope resolver and the W5 manager Home and Video tiles use `managerAuthorizedRoster`. The OOC list rows are all in scope, and `HASCPolicy.canReadStaff` agrees for the sampled staff.
- Storage keys and IndexedDB names are unchanged between the builds.

## Performance (ms; boot = goto until `_dataReady`; tabs = [first visit, revisit]; two runs each)
| metric | baseline run1 / run2 | review2 run1 / run2 |
|---|---|---|
| boot | 1109 / 1442 | 1336 / 1339 |
| admin dash | 111,101 / 113,112 | 104,140 / 139,116 |
| admin records | 188,99 / 190,84 | 120,140 / 120,87 |
| admin color report | 213,203 / 184,180 | 217,204 / 185,164 |
| admin location rank | 190,133 / 193,150 | 166,82 / 164,141 |
| manager sign-in + home (Resnick) | 487 / 419 | 315 / 440 |
| manager home | 189,255 / 185,271 | 148,218 / 194,256 |
| manager color report (needs) | 1036,1029 / 983,986 | 1012,1191 / 1044,971 |
| manager progress | 410,413 / 433,407 | 109,69 / 70,67 |
| staff My Trainings | 59,57 / 63,63 | 55,55 / 61,56 |

No regressions. The manager Color Report takes about 1 s even when revisited, in both builds. That is not caused by the merge.

## Areas not conclusively tested
- Instructor login-email change on rename for directory instructors (R2-05, second part): not run.
- W5 video tiles for managers with archived staff: `managerAuthorizedRoster` includes archived staff, so tiles may count them. Not measured.
- Undo of a staff import (IMP-07) combined with voids and reinstatements.
- The full-backup round trip into a fresh profile (only the legacy path was exercised).
