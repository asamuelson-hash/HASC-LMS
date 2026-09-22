# Compliance Rules & Training Requirements audit (area: `compliance`, prefix CMP-)

Build: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html` (read from `work/template.html`; runtime checks against `work/out.html`).
Scratch scripts: `work/scratch/compliance/x1.mjs` … `x9.mjs` (each boots a fresh profile).

**How the app decides "today":** there is **no demo clock**. `todayDate()` (L7965) and `clockNow()` (L9153) both `return new Date()`. `TODAY_MDY` (L8007) comes from the device clock, and `renewalForecast`/`renewalDetailRows` (L10796+) call `new Date()` directly. At runtime `todayDate()` returned `Tue Sep 22 2026`. See CMP-15 for what follows from this.

**Authoritative engine:** `requiredFor()` (L7944) → `effStatus()` (L8011), with `statusFromDate` (L8008), `artInitialStatus`, and grace handling via `daysSinceHire`/`effGraceWindow`. The data that feeds it (`roster[].rec/dt/expOverride`) is changed by `applyCompletionsToRoster` (L14195), `applyVoidsToRoster` (L10569), `recordCompletion` (L10098), `recordExtCertDirect` (L10032), and `certify` (L14442).

Baseline numbers at runtime: 4,053 roster rows, 2,731 active staff, 15,226 counted matrix cells, and the dashboard shows **85% Agency compliant**.

---

## CMP-01: Required courses that were never completed show as "white" and count as compliant everywhere
**Critical · VERIFIED-RUNTIME**
- **Where:** Admin Dashboard %, Reports/Color Report %, Location Rankings, Manager %, Staff Portal, Follow-up, the Missing report, and "why this status". Code: `effStatus` L8011 (final lines), `_agencyAgg` L10242, `_locationPerformanceAgg` L10256, `_recordsView`, `_mgrMatrixView` L10301, `printComplianceColorReport` L9775, `generateReportPreview` L9710 (`missing` filter), `buildStaffCourses` L14142, `ruleDiagnostic` L16860.
- **Current behavior:** When a *required* course has no record, `effStatus` returns `'w'`, except that:
  - courses in `GRACE_COURSES` (SDCH1/2, O1–O3, FA, PA, CPR) turn `y` or `r` based on hire date;
  - nurse and SDCH staff turn `r`.

  Every other required course stays `'w'`, and every aggregator counts `'w'` as compliant: `['g','y','o','w','info'].includes(l)` → compliant++.

  Runtime counts of active staff for whom the course is *required* (`requiredFor` = true) but `effStatus` = `'w'`:

  | Course | Required & `'w'` | Hired > 1 year ago |
  |---|---|---|
  | SCIPR | 421 of 623 | 302 have no SCIP of any kind |
  | DIABP (Diabetes pouring) | 307 of 322 | 224 whose DIAB was more than 1 year ago |
  | EPP | 249 of 734 | 163 hired > 1y |
  | AMAPP | 73 | |
  | TFP | 65 | |
  | WCO | 71 | |
  | WCI | 65 | |
  | DD | 17 | drivers |

  SCIP1/SCIP2 are required for 623 core-care staff (`baseRequiredFor`) but are not in `MATRIX_COLS` or `BASE_RPT_COMPLIANCE_CODES`. 429 of them lack SCIP Day 2, and this is never shown or counted.

  What users see:
  - The Staff Portal labels these rows "Not yet due / not required".
  - `effStatusLabel` says "Not on record".
  - `ruleDiagnostic` explains `'w'` as "Compliant at present…".
  - The Missing report drops them (`if(rpt==='missing'&&(st!=='r'||!!comp)) return`).

  Example: 3294 "DSP AMAP and Driver", hired 2007, has DIAB 5/1/12, no Diabetes pouring, no WCO/WCI. Every one of those cells is white and counted compliant.
- **Impact:** The agency % is 85.4% as displayed. Counting required-but-missing cells (other than ART) as non-compliant gives **77.0%**. Also excluding `info` cells (CMP-11) gives **69.1%**.
- **Expected:** A required course with no qualifying record should be non-compliant (`r`), or `y` inside a defined initial-due window. "White = compliant" should apply only to not-yet-due items that have an explicit due date (for example initial ART).
- **Root cause:** `'w'` has three meanings: not on record, not yet due, and N/A. The grace fallback is limited to `GRACE_COURSES`, and the aggregators treat `'w'` as compliant.
- **Fix:**
  1. In `effStatus`, after the `iv&&dt` block: if the course is required and `l==='w'` and it is not ART, return `y` when inside an initial-due window (per-course `effGraceWindow`, anchored on hire date or the parent-training date for pourings/SCIPR). Otherwise return `r`.
  2. Add SCIP1/SCIP2 (or a single "SCIP initial" column) to `MATRIX_COLS`/`BASE_RPT_COMPLIANCE_CODES`/`_orderFor`/`buildStaffCourses`.
  3. Make SCIPR required only after SCIP2 exists (renew-after-first); until then SCIP1/2 are the requirement.
  4. Update the `ruleDiagnostic` text and the `reportPrintStatus('w')` wording.
- **Regression risk:** High visible change. Percentages drop sharply and many new red cells appear, so the Training Dept should sign off on each course's initial-due window first. Staff portal, follow-up, and forecast all change.
- **Test:** For 3294, DIABP/WCO/WCI should be red. The Missing report should list them. The dashboard % should equal a hand count from `_complianceGrid`.

## CMP-02: Backfilling an older completion turns a currently compliant staff member red
**Critical · VERIFIED-RUNTIME**
- **Where:** Admin → Add Independent Session. `recordCompletion` L10098 (the `roster=roster.map(... eo[code]=exp ...)` post-step).
- **Current behavior:** `applyCompletionsToRoster` correctly keeps the newer `dt`. Then `recordCompletion` unconditionally writes the *new record's* expiration into `expOverride[code]`, and `effStatus` checks `expOverride` before `dt`.

  Runtime: staff 20002 had CPR `dt 2/22/26`, status `g`, expires 2/22/28. Admin records historical CPR `1/10/22`. The result is `dt` still 2/22/26, `expOverride 1/10/24`, **status `r`**, with red "Action needed" in the Staff Portal and "Expires 1/10/24" everywhere.
- **Expected:** Entering history never lowers the current status. The override should only be written when the new completion becomes the driving (latest) completion.
- **Fix:** Remove the post-map, or apply it only when `compDateVal(date) >= compDateVal(current dt)`. `applyCompletionsToRoster` already handles `expires` for the winning record.
- **Regression risk:** Low.
- **Test:** Backfill an older CPR/FA/ART for a green staff member. The status, expiration, and the persisted state after reload should all be unchanged.

## CMP-03: An old `expOverride` survives newer completions, so staff stay red after passing a class
**Critical · VERIFIED-RUNTIME**
- **Where:** `certify` L14442 (in-person session finalization), `applyCompletionsToRoster` L14195, `effStatus` L8011 (`ovr` checked first), `transcriptStaff` L14172.
- **Current behavior:** Completions without an `expires` field update `dt`/`rec` but leave any existing `expOverride` untouched. This covers session certifications (the `newComps` have no `expires`) and the alternates added by `COMPLETION_SATISFIES`. `certify` also writes `dt` directly and never clears the override. Because `effStatus` prefers the override, the stale date wins.

  Runtime: staff with CPR red → Independent Session CPR 9/5/24 (override 9/5/26) → certified CPR class 9/15/26, passed. The result is `dt 9/15/26`, **status `r`**, and the Staff Portal shows "Completed 9/15/26 · Expires 9/5/26 · Action needed". This persists after reload because the replay order gives the same result.

  Also, `certify` sets `dt[code]=session date` even when that date is *older* than the current `dt`, so a late-finalized session can move the driving date backwards.
- **Expected:** The latest completion defines the expiration. A completion with no explicit expiry should clear the override and fall back to the interval rule.
- **Fix:**
  - In `applyCompletionsToRoster` (and `transcriptStaff`), when a completion wins: set the override if it has `expires`, else `delete expOverride[code]`.
  - In `certify`, route through `applyCompletionsToRoster(this.state.roster, docs)` instead of the hand-written `rosterState` map, and stamp `expires` using `expirationFor`.
  - Consider making `effStatus` ignore an override whose date is earlier than `dt`.
- **Regression risk:** Medium. Manual expiration overrides that are deliberately shorter than the interval must still win. Keep them only when the override belongs to the same completion that is driving `dt`.
- **Test:** The sequence above should end green with expiry 9/15/28, both before and after reload.

## CMP-04: A cert that satisfies several courses (EMT card → CPR+FA) loses its compliance effect on reload
**Critical · VERIFIED-RUNTIME**
- **Where:** `recordExtCertDirect` L10032 (`complianceCode:sat.join('+')`) together with `applyCompletionsToRoster` L14195 (uses only `completionComplianceCode` + `COMPLETION_SATISFIES` and ignores `satisfiedRequirements`).
- **Current behavior:** In the live session the roster is patched directly, so CPR and FA show `g`. After `page.reload()` the boot replay writes `dt['CPR+FA']='9/1/26'`, and **CPR and FA go back to `r`**. Meanwhile the transcript (`transcriptStaff`, which does read `satisfiedRequirements`) still shows CPR 9/1/26. So the transcript says completed while compliance says expired.
- **Expected:** Every code in `satisfiedRequirements` is applied on every replay.
- **Fix:**
  - In `applyCompletionsToRoster`, build the code list the same way `transcriptStaff` does: `sats.length?sats:[primary]`, plus `completionSatisfies`.
  - Stop writing compound `complianceCode` values. Store the primary code and put the rest in `satisfiedRequirements`.
  - Migrate existing records that contain `'+'`.
  - Check `applyVoidsToRoster` for the same issue: its candidate filter matches `(c.complianceCode||c.code||c.course)===code`.
- **Regression risk:** Low–Medium (voids need a matching change).
- **Test:** EMT card → reload → CPR and FA green with the entered expiry. Void it → both revert.

## CMP-05: Manager Home "With overdue", "Due soon" and staff cards ignore the compliance engine
**High · VERIFIED-RUNTIME**
- **Where:** Manager Portal → Home/Team Overview. L15556–15557 (`mRed`, `mDueSoon` from `Object.values(r.rec)`), `staffStatus` L14521 (used by `mStaffCards` L15594).
- **Current behavior:** These read the raw imported letters in `rec`, which never age, never apply requirements, and include non-required codes such as SCIP1 `'r'`.
  - Runtime for Nachman Chopp's team: the UI shows **"0 With overdue · 0 Due soon · 65% Team compliant"**, but 205 team members have at least one `effStatus==='r'`.
  - Agency-wide: 43 staff have a raw `'r'` letter versus 1,187 with an effective red. 1,148 staff are red only by `effStatus`, and 4 are red only by raw letters.
- **Expected:** The KPIs and cards come from the same `effStatus` grid as `mPct`.
- **Fix:**
  - In `_mgrMatrixView`, compute `redStaff`/`dueStaff` from `ES(r,c)` over the team's required columns and return them.
  - Rewrite `staffStatus(r)` as the worst `effStatus` over `MATRIX_COLS` (or the `_complianceGrid` row).
- **Regression risk:** Low. Numbers change sharply.
- **Test:** Manager home "With overdue" equals `team.filter(r=>MATRIX_COLS.some(c=>effStatus(r,c)==='r')).length`.

## CMP-06: Future-dated and impossible completion dates are accepted and count as compliant
**High · VERIFIED-RUNTIME**
- **Where:** `recordCompletion` L10098, `recordExtCertDirect` L10032 (no date parse or validation at all), pourings/RN paths, `applyCompletionsToRoster` (accepts any date), `parseMDY` L7974 (rolls invalid dates over).
- **Current behavior:**
  - Staff 20691, FA red → recorded FA `9/22/2030` → `g`, expires 9/22/32, Staff Portal green. Nothing warns. The same record would also count as a `renewAfterFirst` first completion.
  - `parseMDY('2/30/26')` gives 3/2/26, `'13/5/26'` gives 1/5/27, and `'9/0/26'` gives 8/31/26, so typos are silently turned into other valid dates.
  - `recordExtCertDirect` stores `xcDate` verbatim.
- **Expected:** Reject completion dates after today (or allow at most +1 day for timezone), and reject impossible calendar dates.
- **Fix:**
  - Make `parseMDY` strict: check that `d.getMonth()===m-1 && d.getDate()===day`.
  - Add a `validateCompletionDate(date)` helper used by every write path, including import.
  - In `applyCompletionsToRoster`, ignore completions dated after `todayDate()`, or show them as "pending".
- **Regression risk:** Low. Check whether import files contain legitimately future-dated rows.
- **Test:** Future and 2/30 entries should be rejected with a toast on each entry screen.

## CMP-07: The initial ART due date resets whenever someone repeats an orientation course
**High · VERIFIED-RUNTIME**
- **Where:** `artOrientationAnchor` L7992 and `artInitialStatus`. `dt` holds only the *latest* completion per code.
- **Current behavior:** The anchor is `max(dt[pathway codes])`, so any refresher or retake of SDCH1/O1–O3 moves the initial ART due date forward.

  Runtime: staff 20379 (SDCH, hired 5/5/25) had initial ART due 9/29/26, status `o`. Recording an SDCH1 refresher dated 9/20/26 changes ART to **`w` (not yet due) with due date 9/20/27**. The "why" text rationalizes this.

  Separately, staff whose pathway has no dates never get an ART due date: 93 staff hired more than 2 years ago are ART `w`. They are usually red elsewhere, but ART itself never shows as owed. In total, 128 SDCH staff hired more than 2 years ago are ART "not yet due".
- **Expected:** The anchor is the date the pathway was *first* completed (the earliest completion of each code, then the max across the pathway codes). ART should also get a fallback due date, such as hire + 1 year + grace, when orientation history is missing.
- **Fix:** Build the anchor from completion history (`buildCompletionRecords`/`_firstCompletionIndex`, extended to keep the earliest date) rather than `staff.dt`. Add the fallback.
- **Regression risk:** Medium, because some ART statuses will turn yellow or red.
- **Test:** Repeat the 20379 refresher scenario. ART should stay `o` with due 9/29/26.

## CMP-08: EPP is treated as one-time, yet both the course description and the data show it is annual
**High · VERIFIED-CODE, runtime data evidence**
- **Where:** `INTERVAL_DAYS` L7958 (no EPP), NOEXP lists in `expirationFor` L8230 and `independentCourseExpiryRule` L10050.
- **Current behavior:** An EPP completion never expires. The course description says "Initial and annual training on HASC Center's Emergency Preparedness Plans". All 551 EPP dates on the roster fall within the last 366 days, which fits an annual cycle.

  An admin can set EPP to "annual" in Course Information, and `effStatus` then honors it (runtime: EPP dated 8/1/25 turns `r`). But `independentCourseExpiryRule` checks its hard-coded NOEXP list *before* the configured interval. Runtime: the rule label stays "One-time course — no expiration" and the new completion is saved with `expires:'No expiration'`. Transcript and certificate then say "No expiration" while status turns red a year later.
- **Expected:** EPP renews every 365 days, if the Training Department confirms that policy. Any admin-configured renewal rule should flow to every expiration writer.
- **Fix:**
  - Add `EPP:365` to `INTERVAL_DAYS`, or set it via `courseInfo`.
  - In `independentCourseExpiryRule` and `expirationFor`, consult `courseInfoRenewalDays(code)` before the NOEXP list.
  - Replace the three NOEXP arrays with one `isOneTime(code)` helper.
- **Regression risk:** Medium. EPP cells for staff trained more than 1 year ago turn red; currently there are 0 such dates.
- **Test:** EPP dated 8/1/25 → `r`. A new EPP Independent Session → expires +1y.

## CMP-09: Location-override renewal intervals change the status but not the displayed expiration
**Medium · VERIFIED-RUNTIME**
- **Where:** `expirationFor` L8230 and `calcExpiry` use `catalogIntervalDays`, not `effInterval`. They are used by the Staff Portal, transcript, `_renewalBase`/forecast, and reports.
- **Current behavior:** With a location override of CPR `intervalDays:180`, staff 20002 (CPR 2/22/26) has `effStatus` **`r`**, while the Staff Portal, transcript and forecast show **"Expires 2/22/28"**. Location `oneTime` overrides likewise still display an expiration date.
- **Fix:** In `expirationFor`, use `effInterval(staff,code)`; return 'No expiration' when it is null. Apply the same change to `calcExpiry` and the forecast.
- **Regression risk:** Low.
- **Test:** Repeat the scenario above. The displayed expiry should be 8/21/26 and should agree with the red status.

## CMP-10: Status counts expiry in days while the displayed date uses calendar years (leap-year and month-end drift)
**Medium · VERIFIED-RUNTIME**
- **Where:** `statusFromDate` L8008 (`+365/730/1095` days) versus `expirationFor`/`calcExpiry`/`independentExpirationFor` (`setFullYear` when `days%365===0`).
- **Current behavior:**
  - Driver 3294 with DD dated 9/22/23: status **`r`** today, while the Staff Portal says **"Expires 9/22/26"** (today). The 1,095-day span crosses 2/29/24.
  - ART dated 2/29/24: the displayed expiry is 3/1/25, while the status clock expires on 2/28/25.
  - `expirationFor` also treats 2-digit years as `2000+y`, while the rest of the app uses a pivot-50 rule.
- **Fix:** Pick one rule (calendar years: `addYearsDate`, with 2/29 → 2/28) and have `statusFromDate` compute expiry through the same helper as `expirationFor`. Use `_yr` everywhere.
- **Regression risk:** Low (±1 day).
- **Test:** DD 9/22/23 → status and display agree. Test 2/29 completions.

## CMP-11: "Info" cells (course not required, but a completion exists) count in the compliance %
**Medium · VERIFIED-RUNTIME**
- **Where:** The same aggregators as CMP-01 (`'info'` is in the compliant list).
- **Current behavior:** 816 not-required cells, such as an SDCH worker's old O1 or a non-core worker's old CPR, are added to both the numerator and the denominator. This inflates % (85.4 → 84.6 without them), makes a location's % depend on unrelated history, and a staff member who takes an optional course raises their location's score. The Staff Portal also maps `info` to green "Completed" even when that completion has expired.
- **Fix:** Exclude `info` (and `na`) from the numerator and denominator in all aggregators. Do this through one shared `cellCounts(letter)` helper so the surfaces cannot drift apart.
- **Regression risk:** Low.

## CMP-12: Transfers and grandfathering conflict: no grace after a role or location change, and the SDCH equivalency ignores the pre-2018 waiver
**Medium · VERIFIED-RUNTIME (simulated transfer)**
- **Where:** `daysSinceHire`/grace in `effStatus` (anchored only on `h`), `baseRequiredFor` `hiredBefore2018`, `effStatus`/`sdchEquiv` SDCH equivalency (requires O1+O2+O3).
- **Current behavior:**
  - DSP 10555 (hired 2013, fully compliant, has O1+O2 but no O3 because O2/O3 were waived as pre-2018) moved to "Self Directed Com Hab": **SDCH1/SDCH2 turn red immediately**. There is no grace from the transfer date, and the O1+O2+O3 equivalency cannot be met because O3 was never required.
  - SDCH staff 20379 moved to a residence: **O1/O2/O3/PA/CPR/FA turn red immediately**. EPP/SCIPR are `w` (CMP-01), and ART becomes `w` because SDCH pathway dates don't count toward the non-SDCH ART anchor.
  - The pre-2018 test uses `h`. If Empeon's `h` holds a *rehire* date, grandfathering is lost or granted wrongly (SUSPECTED, since the data has no separate original-hire field).
- **Fix:**
  - Record a `roleChangeDate`/`locChangeDate` in the staff change history and use `max(hire, change)` for the grace anchor of newly required courses.
  - Allow equivalency for pre-2018 staff with O1 only, or document that it is intentionally not allowed.
  - Include the SDCH pathway in the ART anchor for all staff.
- **Regression risk:** Medium (policy decisions needed).

## CMP-13: Core compliance rules are hard-coded, and the one-time/renewal lists are duplicated
**Medium · VERIFIED-CODE**
- **Hard-coded:**
  - the role→course matrix in `baseRequiredFor` L7896 (DSP/nurse/SDCH/housekeeper regexes);
  - `GRACE_COURSES` and the 90-day default grace;
  - the 30/90-day yellow/orange thresholds (`statusFromDate`, `artInitialStatus`);
  - the 2018 grandfather cutoff;
  - the SDCH location regex (`isSDCH`: any "respite" or "com hab" substring in location or position);
  - `INTERVAL_DAYS`;
  - three different NOEXP lists (`expirationFor`, `independentCourseExpiryRule` — which also includes SCIP1/2 and AMAP1/2 — and the implicit list in `INTERVAL_DAYS`);
  - `EXT_CERT_TYPES` rules;
  - `COMPLETION_SATISFIES`.
- **Configurable today:** location overrides (add/remove/interval/dueDays/oneTime/renewAfterFirst), Course Information renewal mode, and custom catalog courses. `isNurse` doesn't match "LPN" even though the bucket label says "Nurse / RN / LPN" (no LPN titles exist in current data).
- **Risk:** Any policy change requires a code change, and the duplicated lists already disagree (CMP-08).
- **Fix:** Move these rules into a `complianceRules` document (in docs/Supabase) with one reader API. Collapse the NOEXP lists into `isOneTime(code)`. Log rule changes to the audit log.

## CMP-14: Surfaces compute the % from different populations and course sets
**Low · VERIFIED-CODE**
- Dashboard (`_agencyAgg`), Records/Color Report (`_recordsView`), and Manager (`_mgrMatrixView`) count only `MATRIX_COLS`.
- Location Rankings (`_locationPerformanceAgg`) additionally counts location-**added** codes and skips suppressed ones. It also uses `complianceExcludedSet` plus a non-blank location check instead of `isActiveStaff`.
- The Create Report "active" filter excludes only `docs.archived` and keeps staff with blank locations.
- The printed Color Report uses the columns that have data.
- With no overrides these agree (runtime: dashboard 85, ranking 85, report 85). Once a location adds a custom course, the dashboard % and the ranking agency % diverge, and the Staff Portal lists the course while the dashboard ignores it.
- The `_agencyAgg` memo key has neither `matrixCols` nor the day, while `_complianceGrid` has the day. After midnight the dashboard can show yesterday's aggregates until data changes.
- **Fix:** One `complianceSummary(staffList)` built on `_complianceGrid` with the effective per-staff code list (`MATRIX_COLS ∪ locAdded − suppressed`), used by every surface. Add `day` and `cols` to the `_agencyAgg` deps.

## CMP-15: "Today" is the unauthenticated device clock
**Low · VERIFIED-CODE**
- `todayDate()`/`clockNow()` return `new Date()`, and the forecast and the legacy-report status use `new Date()`/`Date.now()` directly.
- There is no demo clock (the old `[6,18,2026]` constant was removed, per the L8006 comment).
- Changing the PC clock changes every compliance status. Session finalization gating (`certify` checks `clockNow() < scheduledEnd`) can also be bypassed this way.
- Timezone is the browser's. A completion at 11 pm in one zone could land on a different day elsewhere. This is theoretical for a single-site agency.
- **Fix:** Use a server-trusted date in production. Route all "now" calls through `todayDate()`, including `renewalForecast`, `renewalDetailRows`, the follow-up session filter, and the report legacy status.

---

### Consistent across surfaces (checked)
- Follow-up (`followUpRows`), Renewal detail (`renewalDetailRows.letter`), Audit packet, Staff Portal list, and Records matrix all read `effStatus` or `_complianceGrid`. They inherit CMP-01/03/09/10 but agree with each other.
- Voiding the newest completion correctly restores the prior dated completion (runtime: CPR 9/15/26 voided → back to 9/22/24 `o`).
- No current roster data has future dates, unparseable dates, or missing hire dates. So far these are only input-path risks (CMP-06).

### Areas not conclusively tested
- The Empeon/Intelex import path (`importTrainingRecords` ~L11353), which may write completions whose `expires` or compound codes interact with CMP-03/04.
- Video/SCORM completions that count toward compliance (`recordScormCompletion`, L13273–13284). I did not exercise their `expires`/`countsTowardCompliance` handling end to end.
- `renewAfterFirst` combined with voids: whether voiding the only completion correctly drops the requirement again. `_firstCompletionIndex` ignores voids and `referenceSuperseded`, so this is SUSPECTED.
- Dynamic catalog courses with `complianceRequirement` (`catalogAudienceMatches`, where "managers" also matches "assistant director"). Not exercised.
- Whether the Staff Portal home shows any aggregate %; only the course list was checked.
- The rehire-date semantics of `h`, for grandfathering and grace (see CMP-12).
