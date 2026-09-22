# Manager Portal audit (area: `manager`, prefix MGR-)

Build: `work/template.html` (baseline, read-only). Runtime: `work/out.html` via `tools/harness.mjs`.
Scratch scripts: `work/scratch/manager/x1.mjs … x13.mjs` (x1 = scope census of all 71 manager/AC accounts,
x3 = per-tab sweep for 6 managers, x6 = VT/registration/print tests, x7 = scope edge cases, x10 = Home vs admin KPIs).

Clock: no demo clock. `TODAY_MDY` is a getter on `todayDate()` = `new Date()` (line 8007, 7965). All 77 seeded
sessions are dated Jun 17 – Sep 9 2026, so **on 2026-09-22 the Manager Register tab has no sessions to offer**.
This is a data condition, not a code bug. Registration tests used a future session injected at runtime.

Managers tested at runtime: Abraham Sacks (2278), Mark Resnick (4139), Leah Friedman (15286), Miriam Nemetsky (3539),
Hadassah Halberthal (2517), Shaindle Reinitz (18894), and Area Coordinator Joshua Lieber (15432), signed in through the real `doLogin`.
Synthetic principals were used for the edge cases (zero, invalid, string, or ALL locations).

How scope works (`managerAuthorizedRoster`, line 7790): the **union** of (a) the transitive `mgrId` reporting tree
(`managerScopeRoster`, 7789) and (b) staff whose raw or canonical location matches `cu.assignedLocations`. The locations come from
`HASC_DATA.managers[].locations`, set at login (`doLogin` 8143 / `signIn` 8167).

---

## MGR-01 · Home and "My Reports" show wrong overdue and due-soon counts (read from raw import letters instead of the compliance engine)
- **Portal/module:** Manager › Home and My Reports KPI tiles; Register "Needs this training" note
- **Location:** `renderVals` lines ~15558-15559 (`mRed`, `mDueSoon` read `Object.values(r.rec)`), ~15608 (`mRegStaff.statusNote` reads `r.rec[code]`), `staffStatus()` 14521 (`mStaffCards`, not currently rendered)
- **Current behavior:** the "With overdue" and "Due soon" counts use the raw imported `rec` letters. Every other compliance view uses `effStatus()`. Runtime results (x3, x10), manager Home compared with the admin engine for the same staff:

  | Manager | Staff | Home "With overdue" | Admin engine | Home "Due soon" | Admin engine |
  |---|---|---|---|---|---|
  | Leah Friedman | 74 | **0** | **73** | 0 | 1 |
  | Mark Resnick | 1,950 | **1** | **708** | 0 | 221 |
  | Abraham Sacks | 978 | 42 | 576 | 22 | 225 |
  | Joshua Lieber (AC) | 130 | 6 | 60 | 6 | 52 |

  Admin Staff Records filtered to "Afterschool - Lev Tova" reports 73 overdue and 34%. Leah's Home screen reads *"74 TEAM MEMBERS · 0 WITH OVERDUE · 0 DUE SOON · 34% TEAM COMPLIANT"*. The % tile matches because `_mgrMatrixView` uses `effStatus`. Example: Aboud, Shira (20691) has `rec={SCIP1:'w',SCIP2:'w'}` but `effStatus` returns red for O1, O2, O3, PA, CPR and FA. The matrix below the tiles shows red cells while the tile reads 0. On Register, the same person is labelled "Optional refresh" for a course she is overdue on.
- **Expected:** the counts match the admin compliance numbers for the same staff.
- **Severity:** **Critical.** Managers are told their team has nothing overdue when almost all of it is.
- **Root cause:** a "cheap KPI" shortcut (the comment at 10299 says so) left on raw `rec` when the matrix moved to `effStatus`.
- **Fix:** compute `mRed` and `mDueSoon` inside `_mgrMatrixView`, where the team's `effStatus` per cell is already swept. Count a staff member as overdue if any `MATRIX_COLS` (plus location-added codes) cell is `'r'`, and as due soon if there is no red cell and any cell is `'o'` or `'y'`. Return both from the memo. Better still, read `_complianceGrid(MATRIX_COLS).byId` so the numbers are identical to the admin grid. For Register, use `effStatus(r, courseCodeFor(session))` for the note. Delete or fix `staffStatus()`.
- **Regression risk:** low. The only render-time cost is on the Home and needs tabs, and it is already memoized.
- **Test:** for Leah, Mark and Abraham, check that Home "With overdue" equals `_recordsView(...,loc)` / the admin grid count for the same IDs (73 / 708 / 576 on the baseline).
- **VERIFIED-RUNTIME**

## MGR-02 · Managers see staff far outside their assigned locations, and three different scope rules disagree
- **Portal/module:** every Manager tab, print and export
- **Location:** `managerAuthorizedRoster` 7790-7806, `managerScopeRoster` 7789, `HASCPolicy.inScope/canReadStaff` 353-366, comment at 15415-15416
- **Current behavior:** scope is the reporting tree **plus** the assigned locations. With a deep reporting chain this greatly widens access. Runtime census (x1, x3):
  - **Abraham Sacks** is assigned 3 locations (Camp after Camp, Day Hab East 14th, General and Admin) but sees **978 active staff across 57 locations, 888 of them outside his assigned locations**. The header lists all 57. My Reports, Transcripts (Print all 978), Certificates, Audit (57 locations) and Register all show that full set.
  - Frumie Ziskind: 394 staff outside her locations. Yehuda Horowicz: 253. Joshua Lieber (AC): 22. Aviva Rosenzweig: 21.
  - **`HASCPolicy.canReadStaff`**, the rule flagged as "Mirror every rule in RLS", allows only **151 of the 1,075** staff the app shows Abraham. A third definition sits in the comment at 15416: "RLS on staff.manager_id".
- **Expected:** one written scope rule. Under the stated requirement (managers see only staff at their assigned locations), the tree term must go or be limited. If supervisory reach through the reporting chain is intended, `HASCPolicy` and the RLS plan must say so.
- **Severity:** **High.** Silent over-exposure of staff PII and records. The RLS mirror would either break the portal or keep the leak.
- **Root cause:** "transitive caseload" was added on top of location scope without updating the policy layer.
- **Fix:** (1) The product owner picks the rule. (2) Implement it in one place, `managerAuthorizedRoster`, and have `HASCPolicy.inScope` / `canReadStaff` call the same resolver (canonical locId match, not raw lowercase names). (3) If the tree is kept, limit it to direct reports who sit at the manager's locations, or make it an explicit per-manager flag. (4) Add an invariant test: for every manager, the app scope must be a subset of the policy scope.
- **Regression risk:** medium. Managers who rely on the tree lose staff. Run x1 before and after and review the list with HR.
- **Test:** rerun `x1.mjs`. `outsideAssignedLoc` should be 0, or match the approved exceptions, for all 71 accounts. `x7.mjs` `policyVsApp` counts should be equal.
- **VERIFIED-RUNTIME**

## MGR-03 · Location Directory manager assignments have no effect on access, and a rename silently drops staff
- **Portal/module:** Admin › Locations → Manager scope
- **Location:** `toggleLocManager` 8580, `toggleLocCoord`, `saveLocationEdit` 8575, `managerAuthorizedRoster` 7790
- **Current behavior:** admins can assign or remove managers and coordinators on a location. Scope never reads `location.managers` or `location.coordinators`; it reads only the static `HASC_DATA.managers[].locations`. Runtime (x7): removing every manager from "Afterschool - Lev Tova" left Leah's scope at **80 → 80**, so revocation does nothing. The directory also disagrees with the login data: Lev Tova lists managers 18150, 15286 and 19603. Renaming a location does not keep the old name as an alias. After a rename plus an Empeon re-import that writes the new name, Leah's scope fell **80 → 70**, down to her tree only, with no warning.
- **Expected:** the Location Directory is the source of manager-to-location assignment. Removing a manager revokes access, and renames keep the old name as an alias.
- **Severity:** **High** (revocation failure).
- **Fix:** build `cu.assignedLocations` as locIds from `state.locations.filter(l => l.managers.includes(empId) || l.coordinators.includes(empId))`, falling back to `HASC_DATA` only to seed. Compare staff by `getLocationIdForStaff`. In `saveLocationEdit`, push `prev.name` into `aliases` when the name changes.
- **Regression risk:** medium. Seeded directory assignments must be reconciled with `HASC_DATA` first, because they currently differ.
- **Test:** toggle a manager off a location, then sign in as that manager; the location's staff must disappear. Rename a location, re-import staff with the new name, and check the scope count is unchanged.
- **VERIFIED-RUNTIME**

## MGR-04 · "Print all matching" prints the entire scope when the search matches nobody
- **Portal/module:** Manager (and Admin) › Transcripts and Certificates
- **Location:** `onPrintAllTrx` / `onPrintAllCerts` 16215-16217 → `printAllTranscripts` 8315, `printAllCerts` 8352
- **Current behavior:** the handler passes `trxFiltered.map(id)`. When that is empty, `requested.size === 0` makes the function fall back to `allowed`, which is every in-scope active staff member for the location. Runtime (x6, Leah): the button reads **"Print all 0 matching transcripts"**, and clicking it produced **74 transcripts**. For certificates, "(0 staff)" printed **30 certificates for 26 staff**. For Mark Resnick the same click would print 400 of 1,950. Admin has the same defect at agency scale.
- **Expected:** nothing prints, and a toast says "No staff match".
- **Severity:** **High.** Silent incorrect output, and a document dump beyond what the user selected.
- **Fix:** separate "explicit list" from "no list". Give `printAllTranscripts` / `printAllCerts` a `{explicit:true}` option (or pass `null` for the whole scope). When `explicit` is set and the list is empty, return with a toast. Disable the button when `trxFiltered.length === 0`.
- **Regression risk:** low.
- **Test:** search "zzz" → Print all → no print and a toast. Clear the search → Print all prints N.
- **VERIFIED-RUNTIME**

## MGR-05 · Inactive or terminated managers can still sign in and see their full scope
- **Portal/module:** Login → Manager
- **Location:** `doLogin` 8143 (manager branch). There is no employment check, unlike the staff branch, which filters `isEmploymentActive`.
- **Current behavior:** Rachel Darrison (18535) has employment state `inactive`, yet she signs in with the manager password and sees **1,924 staff** (x9). Naomi Goldzweig (4137) is not in the roster at all and can still sign in.
- **Expected:** a manager or AC whose roster record is inactive or missing is refused, or at least flagged.
- **Severity:** **High** (access not revoked on termination). Demo credentials are a known prototype limit, but this is a logic gap, not a credential gap.
- **Fix:** in the manager branch, `const rec=this.staffById(f.empId); if(!rec||!this.isEmploymentActive(rec)) { loginError: 'This manager account is inactive.' }`. Apply the same check in `switchRole`. Mirror it in RLS or an auth hook.
- **Regression risk:** low. Check that Naomi Goldzweig's missing record is a data issue and not a legitimate account.
- **Test:** sign in as rdarrison@hasccenter.org → refused.
- **VERIFIED-RUNTIME**

## MGR-06 · Video Training tab shows agency-wide statistics and location names to managers
- **Portal/module:** Manager › Video Training
- **Location:** `vtVM` 13317-13326 (`ss.vtStats()`), 13595 (`vtFilterLocOpts` from all `vtRows`); tiles at template 5776-5785
- **Current behavior:** rows are scoped, but the six tiles and the pass rate come from `HASCStore.vtStats()` across the whole agency. Runtime (x6): Leah has 2 assigned staff but sees *"Staff assigned 5, Passed 1, Overdue 4, pass rate 20%"*. The location filter lists other programs' locations (Self Directed Com Hab, Self Directed Respite).
- **Expected:** the tiles and filter options are computed from the scoped rows.
- **Severity:** **Medium** (aggregate leak and wrong oversight numbers).
- **Fix:** for managers, compute stats from the filtered `rows` (assigned, completed, in progress, failed, overdue, rate) and build the location options from `rows` instead of `ss.vtRows()`.
- **Test:** Leah → tiles show 2 assigned, and the location options list only her locations.
- **VERIFIED-RUNTIME**

## MGR-07 · Video Training rows mislabel completed training as "Overdue · Not started", and three status filters never match
- **Portal/module:** Manager (and Admin) › Video Training list
- **Location:** `vtVM` 13560-13580 (`SB` map and `overdue` recompute); status `<select>` at template line 6059
- **Current behavior:** `vtRows()` emits `completed | in_progress | questions_pending | attestation_pending | failed | voided | not_started`. The label map only knows `passed | failed_quiz | watching | not_started`, so every row except not-started falls back to "Not started". `overdue` is recomputed as `!r.passed && due < now`, and `passed` means quiz passed, so a completed video with no quiz is still marked overdue. Runtime (x6): Shira Aboud's completed assignment shows **"Overdue · Not started"**, while Course Progress shows the same row as **Completed**. The filters "Passed" and "Watching" return **0 rows**, and "Quiz not passed" also can never match.
- **Expected:** labels and filters follow `prStatusLabel()`, and overdue follows `status !== 'completed'`.
- **Severity:** **Medium.** Wrong oversight information, so a manager chases staff who already finished.
- **Fix:** reuse `prStatusLabel`/`prStatusColors` for the rows. Set `overdue = r.status!=='completed' && r.status!=='voided' && due<now`. Change the option values to `completed`, `in_progress`, `failed`, etc., or map them.
- **Test:** complete a no-quiz video → the row reads Completed; each filter returns the matching rows.
- **VERIFIED-RUNTIME**

## MGR-08 · "Include archived" batch printing refuses the archived staff it lists
- **Portal/module:** Manager (and Admin) › Transcripts and Certificates
- **Location:** `batchScope` 8302-8311 (`filter(isActiveStaff)`), used by `printAllTranscripts` and `printAllCerts`
- **Current behavior:** with "Include archived / inactive staff" ticked, the list shows 2,117 people for Shaindle Reinitz, including 386 archived. Selecting an archived person and choosing "Print selected transcript" gives the toast *"None of the selected staff are within your authorized print scope."* and nothing prints (x11). "Print all matching" silently drops the archived people.
- **Expected:** batch printing honors the archive switch. This is the stated use: "retrieving historical employee records".
- **Severity:** **Medium.** It breaks the historical-records and audit workflow, and the permission message is misleading.
- **Fix:** add a parameter, `batchScope(loc, includeInactive)`, and pass `state.trxInclArch` / `certInclArch`. Keep the manager scope check.
- **Test:** tick Include archived, select an archived staff member, print → one transcript.
- **VERIFIED-RUNTIME**

## MGR-09 · A derived login email is shared by two managers, and the first match wins
- **Location:** `doLogin` 8143 (`match = a.email===email || deriveEmail(a.name)===email`, then `find` over ACs, then managers)
- **Current behavior:** `asacks@hasccenter.org` is the derived email for both Alyssa Sacks (5046) and Abraham Sacks (2278). Signing in with it always opens **Alyssa's** account (613 staff). If Abraham uses the derived-email convention, he lands in her account without any warning (x9).
- **Severity:** **Medium** (wrong principal).
- **Fix:** check exact `email` matches first. Accept a derived email only when exactly one account derives it; otherwise show an error, as the staff branch already does for shared names.
- **VERIFIED-RUNTIME**

## MGR-10 · The Home "Deny" button always fails for managers
- **Location:** template 2330-2336 (Home "Requests to review" renders `item.onDeny`); `denyReq` 14307 is admin-only
- **Current behavior:** a manager sees Deny on pendingMgr requests. Clicking it shows *"Only administrators can deny registration requests."* and nothing changes (x6). Forward works and checks scope.
- **Severity:** **Low-Medium** (a dead control in the manager's main action queue).
- **Fix:** hide Deny for managers, or add a manager-scoped "Return / withdraw" action (status `withdrawn`, with a scope check through `canViewStaffMember`).
- **VERIFIED-RUNTIME**

## MGR-11 · Home and Online Progress cut off large teams with no notice
- **Location:** Home `mProgRows` 16397 (`scope.slice(0,300)`, sorted **after** the slice); Online Progress `mOnline` 16336 (`mScope.slice(0,200)`)
- **Current behavior:** Mark Resnick has 1,950 staff; the "Team training progress" list shows 300 of them, taken in roster order and then sorted by name. Online Progress stops at 200 staff. No count or "showing N of M" text appears. Five of the six managers tested exceed 200.
- **Severity:** **Medium** (silently incomplete oversight views).
- **Fix:** sort first, then page with a visible "showing N of M" and a Show more control (the same pattern as `repShow`).
- **VERIFIED-CODE** (the 300 cap was confirmed at runtime: `prog: 300`)

## MGR-12 · The header and team line misstate the manager's scope
- **Location:** `assignedLocLine` 15429 (`managerLocs` derived from reachable staff, not from assignments); `mTeamLine` "Reporting to {name}" 16294
- **Current behavior:** Abraham's header lists 57 "Locations" although he is assigned 3. Every manager's team line says "Reporting to X · N staff" even though most of the scope is location-based and not direct reports. This hides the MGR-02 widening from the manager.
- **Severity:** **Low.**
- **Fix:** show "Assigned locations: …" from the assignments, plus a separate "+N staff via reporting line" note if the tree is kept.
- **VERIFIED-RUNTIME**

## MGR-13 · Approving a Staff Training Portal request does not schedule anything, but the toast says it does
- **Location:** `mPortalReqs.onApprove` 15589 → `HASCStore.actOnRequest` (runtime source: it only sets `status='approved'`)
- **Current behavior:** no roster seat, no registration request, no admin step. The toast says *"now sees this session as scheduled."* The queue is empty in the baseline because staff self-requests are disabled, so this is a legacy path that is still live.
- **Severity:** **Low.**
- **Fix:** turn an approval into `registerStaff(session, [staffId])` (manager → pendingAdmin), or remove the section.
- **VERIFIED-CODE**

## MGR-14 · Audit-packet history is filtered by location, not by staff scope
- **Location:** 11212 (`hist.filter(h => allowed.includes(h.loc))`)
- **Current behavior:** a manager who reaches only part of a location (common under MGR-02) sees packet history entries, including every staff name, that an admin generated for the whole location. Packet generation itself is correctly re-scoped (`audBuildPacket` 11022-11025).
- **Severity:** **Low** (names only).
- **Fix:** for managers, filter `h.staff` to IDs in `managerAuthorizedRoster`, or show only the manager's own packets.
- **VERIFIED-CODE**

## MGR-15 · A string `assignedLocations` value crashes scope resolution
- **Location:** `managerAuthorizedRoster` 7797 (`(cu.assignedLocations||[]).map`)
- **Current behavior:** `assignedLocations: 'Afterschool - Lev Tova'` throws `...map is not a function` (x7). `HASCPolicy.locationScope` accepts a scalar, so the two layers disagree. Current `HASC_DATA` always uses arrays, but a future manager import could supply a string.
- **Severity:** **Low.**
- **Fix:** normalize once in `signIn`: `Array.isArray(l) ? l : (l ? [l] : [])`.
- **VERIFIED-RUNTIME**

## MGR-16 · The Course Progress tab is slow for large scopes
- **Location:** `courseProgressRaw` 16898 (`roster.filter(canViewStaffMember)`, and each call does `managerAuthorizedRoster(cu).some(...)`: 4,053 × ~2,375 comparisons), called twice per render by `courseProgressVM` (`all` and `rows`)
- **Current behavior:** renderVals takes 494-672 ms per render for Mark Resnick on the progress tab, against about 150 ms on the other tabs (x13). It runs on every keystroke in that tab's filters.
- **Severity:** **Low** (performance).
- **Fix:** build `new Set(managerAuthorizedRoster(cu).map(r => String(r.id)))` once, compute Raw once per render, and memoize it on the store version plus scope.
- **VERIFIED-RUNTIME**

---

## Verified correct (no finding)
- `registerStaff` / `validateRegistrationLive` reject out-of-scope staff ("outside your authorized locations/caseload"), archived staff, duplicates and capacity overflow. In-scope staff produce `pendingAdmin` + `manager_request` records carrying the canonical location (x6, x11).
- `forwardReq` re-checks scope. The single-certificate and transcript print handlers (`printOneCert`, `printCertificateRow`, `printCompletionCert`, `printStaffCerts`) check `canViewStaffMember`. `audBuildPacket` limits selected IDs to `audStaffPool`. `exportManagerComplianceWorkbook` uses the authorized scope.
- Location-name matching tolerates differences in case, whitespace and punctuation. The baseline data has no normalization collisions. The one alias ("East 14th Street" → Day Hab East 14th) resolves. Merged locations resolve through `mergedInto`.
- Zero locations with an unknown empId, all-invalid locations, and a blank location all give an empty scope, and the header reads "No staff in your caseload". `'ALL'` gives the whole roster.
- Team compliant % matches the admin engine exactly for all six managers tested.
- Course Progress rows are scoped correctly (Leah sees 2 of 5 assignments). VT rows are scoped too; only the tiles and filter options leak (MGR-06).
- Staff with no location (1) and inactive staff are excluded from active manager views. Five active staff (HASCCenter ×3, "1068 E14th Street", "Day Hab w/o Walls") fall in no manager's scope, which is expected for admin-only locations but worth an HR check.

## Areas not conclusively tested
- Manager notifications feed: `docs.notifications` is empty in the baseline. Its `ids.has(n.staffId)` check relies on string IDs, which holds for the current roster.
- Online Progress content: there are no online courses or assignments in the baseline, so only the cap (MGR-11) was reviewed.
- Physical and mobile print rendering: `printHTML` was stubbed to count output.
- Whether system accounts (IDs 1, 000001, 00000) can enter a manager scope through `mgrId` or location. `managerAuthorizedRoster` does not exclude `systemAccountSet()`, unlike the admin views; none appeared for the managers tested.
- Registering staff whose employment is inactive but who are not in `docs.archived`: every inactive record in the baseline is archived, so this case could not be exercised.
- Concurrency and RLS: all scoping is client-side only (a known prototype limitation).
