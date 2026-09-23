# Review 1: adversarial review of fix batch 0820a51 + 4635c5e

Build under test: `work/out_fix.html`. It was re-extracted and is byte-identical to `work/template.html` at HEAD 4635c5e. Baseline: `work/out.html`.
Scratch scripts are in `work/scratch/review1/`: dist.mjs, newred.mjs, locadd.mjs, smoke.mjs, scen.mjs, scen2.mjs, scen3.mjs, impdate.mjs, perf.mjs.
Existing suites still pass on HEAD: compliance.test.mjs 13/13 and rules.test.mjs 7/7.

Severity scale: Critical / High / Medium / Low. Evidence tags: VERIFIED-RUNTIME, VERIFIED-CODE, SUSPECTED.

---

## R1-01 High: "Upload internal certificate → post" still hand-edits the roster. An older date moves compliance backwards, and any date string is accepted
- Admin › Uploaded/Internal certificate · `uploadInternalDoc()` (template.html ~9966-9971)
- **Current behavior.** When the post action is chosen, the code runs `roster.map(r=>...{rec:{[linkCode]:'g'},dt:{[linkCode]:date}})` directly. It does no date validation and does not go through the replay. VERIFIED-RUNTIME (scen.mjs S5), staff 18901, CPR 8/20/25 (g):
  - posting a CPR document dated `1/5/21` sets CPR to 1/5/21 and the status to **r**. This is the same bug CMP-02 fixed on the other paths.
  - posting `2/30/27` stores dt `2/30/27` and the status to **g**. That date is both impossible and in the future. The CMP-06 validation is missing here.
- **Expected.** The same rules as recordCompletion: completionDateError, then `applyCompletionsToRoster(applyVoidsToRoster(roster,docs),docs)`.
- **Root cause.** This path was not in the list of five paths the commit converted. The commit message says "every write path".
- **Fix.** In uploadInternalDoc:
  1. Parse icDate with parseMDY and reject on `completionDateError`.
  2. Normalize the date with formatMDY.
  3. Push the completion. Stamp `expOverride:false` when `exp` is empty and exp2 came from `internalExpiry`.
  4. Replace the roster.map with the replay.
- **Regression risk.** Low.
- **Test.** Re-run scen.mjs S5: CPR stays 8/20/25 g, and 2/30/27 is rejected.

## R1-02 Medium: four more completion paths bypass the single replay, so a stale override survives a new completion
- `recordScormCompletion` (~9039), online course completion (~9101), `postOnlineCompletion` (~14343), `vtPostCompletion` (~13328). Each one sets `rec/dt` by hand and leaves `expOverride` alone.
- VERIFIED-RUNTIME (scen2.mjs):
  1. Staff 18901 gets a manual CPR override (exp 10/1/26).
  2. `postOnlineCompletion` then posts CPR dated today.
  3. The result is dt 9/22/26 with the stale override 10/1/26 still in place, so the status is **o (due in 9 days)** right after completion.
  - This is CMP-03 on another path. It self-corrects only after a reload or cross-tab hydrate, because the boot replay then clears it.
- **Fix.** In each path, build `docs` first, then `roster=this.applyCompletionsToRoster(this.applyVoidsToRoster(this.state.roster,docs),docs)`. Stamp `expOverride:false` where `expires` is auto-computed, for example SCORM `expStr` from the package's expiration setting.

## R1-03 Medium: CMP-01 ignores the location override's effective date. A requirement added today makes every tenured staff member overdue immediately
- `initialDueInfo()` (~8040) uses `hire + ov.dueDays`. `locOverrideFor()` (~7942) also ignores `ov.future` and `ov.effDate`, and the Location Requirements UI collects both.
- VERIFIED-RUNTIME (locadd.mjs): adding `DD` with `req:'add', dueDays:30, effDate: today` to loc6 gives:

  | Build | DD status for 22 staff |
  |---|---|
  | Baseline | 18 white, 3 red, 1 green |
  | Fix | **21 red**, 1 green |

  A future-dated add also takes effect immediately, and now shows as red instead of white.
- Policy (hire-anchored) is taken as fixed. But the override's own "Effective" date is data the admin entered, and the implementation discards it. Dynamic Course Library requirements have the same shape: every existing staff member turns red on the day the course is created.
- **Fix.**
  - In `initialDueInfo`, anchor on `max(hire, ov.effDate)` when the requirement comes from an `add` override. For a dynamic library requirement, anchor on the course's `createdAt`.
  - Make `locOverrideFor` skip `ov.future && effDate > today`.
  - If the Training Dept truly wants instant red for existing staff, document that in ruleDiagnostic.
- **Test.** Re-run locadd.mjs. The expected result is 18 staff due on today + 30 days (o/y), not red.

## R1-04 Medium: voiding an AMAP2 completion leaves AMAP green on the voided date
- `voidCompletion` (~10636) and `applyVoidsToRoster` (~10598). VERIFIED-RUNTIME (scen.mjs S1), staff 3294:
  1. Add AMAP2 dated 9/1/26. AMAP becomes 9/1/26 g.
  2. Void it. The record's `affectedCodes` is `['AMAP2']`, so only AMAP2 is removed and **AMAP stays 9/1/26 g**.
- The baseline has the same behavior, but the new `completionRosterCodes` comment says voiding the primary also voids what it satisfied. That is true only for replay input, not for dates already on the roster.
- Side effect: `applyVoidsToRoster` writes `rec.AMAP2='w'` where there was no key before, and effStatus then shows AMAP2 as 'r'. It is not a matrix column.
- **Fix.**
  - In `applyVoidsToRoster`, also treat alternates as voided: for each void `v`, add each `a` in `completionSatisfies(v.code)` to `codes`, voiding under the primary key.
  - Or set the record's `affectedCodes` from `completionRosterCodes(match).map(x=>x.code)` in `buildCompletionRecords` (~10545).

## R1-05 Medium: EMT completions saved in the legacy shape (`complianceCode:'CPR+FA'`, as the baseline wrote them) now void only partially
- Real users' IndexedDB already holds records in this shape. VERIFIED-RUNTIME (scen2.mjs, staff 10875):
  - Completion Records shows **three rows** for one card: CPR (affected [CPR]), FA (affected [FA]) and CPR+FA.
  - Voiding the CPR row reverts CPR only. FA stays 9/12/26 g with exp 9/12/28 from the voided card.
  - The Transcript still shows `CPR 9/12/26 · Up to date`, because `transcriptStaff` keys the void on 'CPR+FA'.
  - Older CPR/FA transcript rows also show the new card's expiry (9/12/28).
- **Fix.** Migrate once in `migrateCertModel`: for a completion with `satisfiedRequirements.length>1` and a '+' in complianceCode, set `complianceCode=sat[0]`. Also make `buildCompletionRecords` emit one row per completion with `affectedCodes=completionRosterCodes(c)`.

## R1-06 Medium: a future Form 811 received date is accepted, the success toast says compliance was updated, and nothing changes
- `recordPouring` (~10020). Only the pouring date gets `completionDateError`. The received date is only checked to be on or after the pouring date. `complianceDate=recv`, and the replay now holds future-dated completions.
- VERIFIED-RUNTIME (scen3.mjs): pourDate 9/20/26 with recv 12/1/26. The completion is stored with date 12/1/26, the toast says "AMAP Pouring recorded — compliance and transcript updated", and **AMAPP stays r**.
- `transcriptStaff` does not hold future dates, so the Transcript counts it (VERIFIED-CODE).
- **Fix.** Run `completionDateError(recvDate,'The '+type.form+' received date')`.

## R1-07 Medium: expiration dates are not validated. A year of 2051 or later wraps to 1951 or later and shows as expired immediately
- VERIFIED-RUNTIME (scen3.mjs):
  - A manual expiration of `1/1/2055` on an independent session is stored as `1/1/55`, which is read as 1955. The status is **r** straight after the completion.
  - EMT `xcExp` of `Dec 2027` is stored verbatim and shown as the expiration; the status silently falls back to the interval.
  - EMT exp `9/20/25` on a 9/20/26 card is accepted, and CPR and FA turn red.
- Import expirations go through `importDate`, which accepts any 4-digit year and truncates it, so `1/5/2055` becomes `1/5/55`.
- **Fix.** Add `expirationDateError(exp, completionDate)`:
  - strict parse
  - year between 1951 and 2050
  - on or after the completion date
  - apply it in recordCompletion (manualExp), recordExtCertDirect (xcExp), recordPouring (pourExp), approveExtCert and trainingImportExpiration
  - normalize the stored value with formatMDY

## R1-08 Medium: `importDate` now rejects legitimate formats that the baseline accepted
- VERIFIED-RUNTIME (impdate.mjs), baseline result vs fix result:

  | Input | Baseline | Fix |
  |---|---|---|
  | `Monday, January 5, 2026` (Excel long-date format, common in CSV exports) | 1/5/26 | rejected |
  | `Mon, Jan 5, 2026` | 1/5/26 | rejected |
  | `Thu Jan 05 2026 00:00:00 GMT-0500` (JS Date.toString) | 1/5/26 | rejected |
  | `Jan-5-2026` | 1/5/26 | rejected |
  | `Jan-05-26` | 1/5/26 | rejected |

- In the row template these rows become "Completion Date is invalid" (scen.mjs S6). In the Executive Compliance / wide layout (~11346) an unparseable cell is **silently counted as ignored**, so a whole report in long-date format imports nothing.
- Correctly rejected now: `2026`, `95`, `Jan 2026`, `Passed`, `1/5`, `2/30/26`, `13/5/26`.
- Correctly accepted now: `January 5th, 2026`, ISO date-times, and `1/5/2026 12:00:00 AM`.
- **Fix.**
  - Strip an optional leading weekday before the month-name regexes: `raw=raw.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i,'')`.
  - Allow `Mon[-\s]D[-\s,]YYYY`.
  - In the wide layout, count a non-empty cell that does not parse as a Blocked row, not as ignored.

## R1-09 Low: import year range is not checked
- `importDate('1/5/1945')` returns `1/5/45`, which is read as 2045, and the row is blocked as "Completion Date 1/5/45 is in the future". The date is actually old, so the message is misleading.
- `1/5/1949` behaves the same way. VERIFIED-CODE, and matches the `_yr` pivot at 50.
- **Fix.** In `trainingImportBuildRow`, use `completionDateError` (which already enforces 1951-2050 and no future dates) instead of `isFutureDate`, and apply the range check to the raw 4-digit year before truncating.

## R1-10 Low: the Transcript still runs its own replay (`transcriptStaff`, ~14221)
- It still does the following:
  - applies every `expires`, including auto-computed ones stamped `expOverride:false`, as an override
  - counts future-dated completions
  - ignores the AMAP2→AMAP alternate
  - keys voids on the primary code only
- Result: Transcript rows and statuses can disagree with the matrix, as in R1-05 and R1-06. VERIFIED-RUNTIME for R1-05 and VERIFIED-CODE otherwise.
- **Fix.** `transcriptStaff(stIn){ return this.applyCompletionsToRoster([stIn], this.state.docs)[0]; }`. Keep the `completionAddToTranscript` filter as a pre-filter of the docs passed in if it is needed.

## R1-11 Low: auto-computed expirations on some paths are still treated as explicit overrides
- The commit says auto dates carry `expOverride:false`, but these paths store a rule-derived `expires` without that flag, so `completionExplicitExpiry` pins it as an override:
  - import when there is no Expiration column (`calcExpiry`, catalog interval)
  - pouring without a manual expiration (`expirationFor`)
  - external certificate `+2y` / `+1y`
  - SCORM package expiration
- A later change to a location's `intervalDays` or the Course Information renewal is then ignored for those records. This was already true in the baseline; VERIFIED-CODE.
- **Fix.** Stamp `expOverride:false` whenever the expiry was computed rather than entered or printed on the document.

## R1-12 Low: approving a staff-submitted external certificate with a free-text date
- The staff upload modal (~6854, ~11814) stores `extDate` unvalidated. `approveExtCert` now correctly refuses `May 14, 2026` and similar, but there is **no way to edit the date**, so the admin must deny it and ask for a re-upload.
- Accepted values such as `05-14-26` and `5/14/2026` are stored un-normalized in `comp.date`. The void and certificate keys then depend on the raw text.
- **Fix.** In `approveExtCert`, normalize with `importDate(d.date)` and then `formatMDY`. Store the normalized value in both extCert and completion. Validate at upload time in the staff modal as well.

## R1-13 Low: `baseDt` is not cleared by the scrub and reconcile passes
- The passes at ~13895 (mock scrub), ~13940 (reference reconcile) and ~13984 (active roster reconcile) delete or replace `dt[code]` but keep `baseDt[code]`.
- A date the authoritative reconcile removed can come back when a later completion is voided (applyVoidsToRoster `hist`). SUSPECTED: this only matters if those passes re-run once `baseDt` exists, for example with a new reference key.
- **Fix.** Delete `baseDt[code]` wherever those passes delete `dt[code]`.

## R1-14 Low / Info
- **Discarded override.** A manual override entered on a *backfilled older* independent completion is thrown away by the stray-override cleanup. That is correct for compliance, but the toast and the **Critical** audit entry "Expiration manually overridden" still say it was applied. Warn in the toast, or refuse an override when the date will not drive.
- **Dead config.** `courseInfo.initialDueDays` is read in `initialDueInfo` but nothing writes it, and the `basis==='parent'` text in `ruleDiagnostic` became dead code in 4635c5e.
- **Timezone.** `completionDate()` still turns a date-only ISO string with `new Date(raw)`, which reads it as UTC and gives the previous day in US timezones. The new `parseMDY` reads the same string as a local date. This predates the fix and was not visible under the UTC harness.

---

## Verified fine
- **Strict `parseMDY` callers (all 23).** Every data caller passes M/D/YY roster, completion, override or hire values. Across the full roster (h, all dt), 24,654 completions (date and expires) and all session dates, old and new parsers produce **0 differences** (dist.mjs).
  - Session dates (`Wed, Jun 17, 2026`) go through `sessionDateObj`/`new Date` and never reach parseMDY; both builds return null for them there.
  - ISO values now parse correctly; before, `2026-01-05` became 10/1/73, which fixes a latent bug.
  - `M/D/YY h:mm` is now accepted, where it used to be null.
  - Nothing relied on rollover.
  - `statusFromDate`, `compDateVal` and `daysSinceHire` keep their own parsers and are unchanged.
- **`applyCompletionsToRoster`.** The boot replay is idempotent: 0 rows change on a second pass, and it costs 59 ms vs 51 ms on the baseline.
  - Correct cases confirmed: video completions (`expOverride:false`), RN courses (`No expiration`), backfill, late session certification (SCH-05), independent completion with manual override, and EMT direct (CPR+FA with explicit expiry, then void of both).
  - The fallback to the Sept-15 reference on void works (S4: 9/14/26 voided, back to 2/22/26 from the reference).
  - `completionExplicitExpiry` drops only `expOverride:false` values, which are all rule-computed, so no honored expiry is lost.
  - The stray-override cleanup never deleted a legitimate override in any scenario. The embedded roster has no `expOverride`, so every override originates from a completion.
- **`baseDt` safety.** Nothing iterates roster object keys generically. Exports and reconcile passes spread `...r`, so the extra field is harmless apart from R1-13.
- **CMP-01 (HEAD, hire-anchored) status shifts.** Only white cells for required courses with no record change, about 1,190 cells: SCIPR 421, EPP 252, DIABP 307, AMAPP 73, TFP 65, WCO 71, WCI 65, AMAP 20, DD 17, TF 3, DIAB 1.
  - Nurse, SDCH and housekeeper populations are unchanged, because they were already red through the existing rules.
  - `renewAfterFirst` is handled by `requiredFor`.
  - No active staff member lacks a hire date, and the no-hire case now shows 'y' as the policy says.
  - Watch the policy consequences: 403 staff with no SCIP 1/2 show **SCIP Recert** overdue, and pourings turn red at hire + 90 even when the parent course was taken recently. See also R1-03.
- **Performance.**
  - Cold compliance grid: 205 ms → 259 ms.
  - effStatus: about 2 µs per call in both builds.
  - Cold renderVals: 253 ms → 285 ms.
  - Tab render times are unchanged.
- **Manager KPI (MGR-01) and `staffStatus`.** Counts come from the same `effStatus` sweep as the percentage. Archived or non-active staff fall back to `effStatus` when they are missing from the grid. `mRed` and `mDueSoon` are 0 only where the team is also empty, as in the baseline.
- **Smoke test.** All 49 tabs across the 4 portals render with **no page errors** in either build (smoke.mjs). Text sizes differ only on reports, locationrank, followup and manager needs, which is expected from the new reds.

## Areas not conclusively tested
- Cross-tab hydrate (`_handleStorageSync`) with two live tabs.
- Supabase and HASCStore mirror paths.
- Behavior in a non-UTC timezone (see the timezone item in R1-14).
- Real `.xlsx` files: `importDate` was only tested with the strings the reader would produce.
