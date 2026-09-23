# HASC Center LMS — Production-Readiness Review: Lead Architect Report

**Baseline:** `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html` (unchanged in this repo)
**Delivered build:** `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22_audited.html`
**Branch:** `claude/hasc-lms-readiness-audit-eh04y4` · **Date:** 2026-09-22/23
**Issue ledger:** `work/ISSUE_LEDGER.md` (every finding, owner, status, fix, verification)
**Evidence:** `work/audit/*.md` (10 audit reports + 3 independent reviews + QA regression sweep)

---

## 1. What was examined

Ten specialist agents audited the running application, driving it headlessly at full data scale (4,053 staff, ~24,650 completion records, 77 sessions): compliance rules, the Staff, Manager and Admin portals, data import, scheduling/calendar/registration, certificates and records, permissions and security, QA/regression, and UX. Each finding was traced from input to stored state to UI output, and reproduced at runtime where possible. The app's own clock was used (there is no demo clock), with New York time zone for date bugs.

**Result:** 138 findings (11 Critical, 45 High, 53 Medium, 29 Low). Three independent reviews and a second QA sweep added 23 more follow-ups, all Medium or lower.

## 2. Major problems discovered

The most serious problems gave wrong answers without any visible error:

| Area | What was wrong |
|---|---|
| **Compliance %** | Required trainings with no record counted as *compliant* — about 1,200 missing trainings. The agency showed 85% compliant; the true figure is ~77%. |
| **Recording history** | Entering an older certificate or completion could turn a currently compliant person red (stale expiration overrode the newer one). |
| **Multi-course certs** | An EMT card's CPR + First Aid credit was lost on reload. |
| **Voids** | Voiding a newer record erased the person's older imported history; a void also hid valid re-entries on the same date. |
| **Manager Home** | Showed "0 overdue" while the compliance engine counted hundreds (it read raw imported letters). |
| **Staff portal** | Staff with overdue CPR/First Aid saw only "No online trainings assigned" — never their requirements. |
| **Dates** | Imports turned "Scheduled 10/30/26", scores and bare years into completion dates. Future dates counted as compliant, 2/30 rolled into March, and 2099 expiries read back as 1999. |
| **Calendar** | Imported sessions landed a day early in New York. December PDFs mentioning January were imported as January, and "7–9 PM" became AM. |
| **Imports** | A partial active-staff file could archive ~98% of the roster; undo discarded later work; leading-zero IDs created duplicate people. |
| **Course library** | Adding a course "mapped to" PA silently made every PA completion expire annually (383 staff turned red). |
| **Security** | An audit packet survived logout into the next user's session. Admin "view as" impersonated real people and mis-attributed the audit log. Former managers could still sign in. |
| **Multi-tab** | Two admin tabs could overwrite each other's saved data (an applied import vanished). |

## 3. Root causes

Many reported bugs reduced to a few architectural causes:

1. **No single source of truth for completions.** Five-plus write paths hand-edited each staff member's `rec/dt/expOverride`, each differently. This caused CMP-02/03/04, CRT-01/04, SCH-05 and more. **Fix:** one authoritative replay (`applyCompletionsToRoster`) that every path now uses.
2. **Several compliance calculations.** Surfaces re-derived status from raw letters or their own formulas (CMP-05/11/14, MGR-01, UX-02/05). **Fix:** every surface now uses `effStatus` through one `complianceSummary`.
3. **Lenient, lossy date handling.** Permissive parsing, UTC parsing of ISO dates, and M/D/YY storage (IMP-01..04, CMP-06, SCH-01). **Fix:** strict parsers, local-date ISO handling, and one validation rule on every entry path.
4. **"White" meant three things** (not on record / not yet due / not applicable) and was counted compliant (CMP-01).
5. **Voids keyed by staff+course+date** instead of by record (CRT-03).
6. **Per-user state not isolated** on shared workstations (SEC-01/02/05).
7. **Last-writer-wins persistence** (IMP-08).

## 4. Changes implemented

Every fix is targeted. No feature was removed, and data saved by the original build loads in the new build with nothing lost (verified in a persistent browser profile). Business decisions were made by the Training Director:

- **Missing required course:** red only if it is required for the role and was not completed within 90 days of hire. Configurable per course and per location, with a "legacy" switch.
- **Manager scope:** assigned locations plus reporting line (now stated on screen and in the policy layer).
- **EPP:** stays one-time (it will be folded into ART).
- **Renewal-period changes:** apply to all completions, with an impact preview and an audit entry.
- **Admin preview of the Staff portal:** strictly read-only.

**By area:**
- **Compliance:** unified replay; missing-required policy; ART anchored on the first orientation completion; expiry display equals status; info/N/A cells excluded from %; strict dates; configured renewal rules take precedence over hard-coded lists.
- **Staff portal:** "My required trainings" list with working actions; quizzes never reveal answers; the attestation signature must match; phone layout.
- **Manager portal:** engine-based KPIs; "Out of compliance" list; Register sorted by need; exact print-all; scoped video tiles; inactive managers blocked; Deny hidden.
- **Scheduling:** local-date sessions; calendar month/time/location parsing; re-import keeps admin edits; admin-only cancel; waitlist promotion; overlap block; instructor Pass/Fail on phones.
- **Certificates and records:** one stable certificate ID per completion; per-row expiry; id-targeted, append-only voids; voided records can't print; online retakes keep history.
- **Admin and imports:** scheduled location rules; validated backup/restore with single-level undo; coverage checks and typed confirmation for archiving; supervisor/email preservation; leading-zero ID matching; scoped staff-import undo; training-import batch undo; instructor rename carries sessions and access; flush on tab close; in-app QA Checks restored (22).
- **Security:** per-user state reset at sign-in and logout; audited admin preview that keeps the real identity; read-only staff preview; scope-checked certificate views; import permission guards; URL scheme allow-list.
- **Persistence:** three-way merge on every save, so concurrent admin tabs no longer overwrite each other.

## 5. Tests performed

- **12 regression suites** (`tools/tests/*.test.mjs`, ~170 assertions). Each check reproduces a finding end to end through the app's own functions or UI, including after a page reload. Every suite was run against the original build (where its finding checks fail) and against the fixed build (where all pass). Run: `cd tools && npm i playwright@1.56.1 && for f in tests/*.test.mjs; do node $f <build.html>; done`.
- **Builder/reviewer pattern:** six builders worked in isolated worktrees. Three independent adversarial reviews (`review1..3.md`) found 23 follow-ups, all fixed and added to the suites.
- **QA regression sweep 2:** 58 tabs × 4 portals, ~1,100 buttons clicked, phone viewport, admin preview mode. **No functional regressions** versus the baseline; in-app QA Checks 22/22.
- **Upgrade compatibility:** state saved by the original build, opened in the new build, with nothing lost.

## 6. Remaining known issues

| Priority | Item |
|---|---|
| **Critical (architecture)** | **Authentication/authorization are browser-side only.** Staff sign in with Staff ID plus last name (the set password is stored only in that browser). All data ships inside the file, and every permission check can be bypassed in devtools. Requires Supabase Auth + RLS (`SUPABASE_MIGRATION.md`, `supabase/schema.sql`). |
| Medium | Several business rules are still code-level (role pathways, 2018 grandfather date, 30/90-day color thresholds) — CMP-13/ADM-12. The SCORM iframe is not sandboxed (SEC-07). One-time load scrubs delete history without an audit entry (CRT-13). There is no grace period after a transfer or role change (CMP-12, a policy decision). |
| Medium (UX) | Inconsistent status wording, unexplained course abbreviations, toasts for errors, sign-in instructions, overlapping tab names (UX-06/07/08/10/13/14/16). |
| Low | 14 items (see ledger), including 741 duplicated seed completions and some no-op controls. |
| Ops | All seeded sessions are in the past, so registration can't be exercised until the real upcoming calendar is loaded. |

## 7. Recommended next priorities

1. **Server authority (go-live blocker):** Supabase Auth + RLS, remove the demo password paths, and move the compliance calculation server-side (or share one module) so the UI and back end use the same rules.
2. **Store dates as ISO `YYYY-MM-DD`,** retiring M/D/YY and the 1951–2050 window.
3. **Admin-configurable rule tables** for role pathways, grace windows and color thresholds, with an audit trail.
4. **Transfer/role-change grace** (policy decision needed), and SCIP 1/2 as visible requirements.
5. **UX pass** on terminology and sign-in guidance, driven by `work/audit/ux.md`.
6. **Load the real Fall 2026 calendar** and run a live registration → attendance → certification pilot at one site.

## 8. Areas not conclusively tested

- Real HASC calendar PDFs (parsing was tested on synthetic PDFs matching the layout).
- Real printers and PDF output on mobile (print HTML was inspected, not paper).
- Bunny Stream video playback, SCORM packages, and outbound email/SMS notifications.
- Supabase server mode (no project available; everything ran in local mode).
- Cross-device behavior; multi-tab was tested in one browser.
- 10,000+ row import files and performance on low-end phones.
