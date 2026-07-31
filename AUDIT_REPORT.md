# HASC Center LMS — Production Audit & Repair Report

**Audited file:** `HASC_LMS_v5_production__5_.html` (2,472,265 bytes)
**Corrected file:** `HASC_LMS_v5_production__6_audited.html` (2,521,149 bytes)
**Date:** 2026-07-31
**Data scale exercised:** 3,943 staff records · 1,138 archived · 24,385 completion records · 67 sessions · 7.26 MB docs payload

---

## A. Executive summary

The application is architecturally sound. The intended layering
(`HASC_CONFIG → HASCAuth → HASCIdentity → HASCSession → HASCPolicy → HASCRepo /
LMSDataService → HASCStore → portal UI`) is real and observed: role scoping,
notification idempotency, void/audit append-only semantics, session-certification
de-duplication, the single `effStatus()` compliance path and the memoized selector
layer all behave correctly under test. Escaping in the certificate, transcript and
report print paths is thorough — an injected `<img onerror>` payload in a staff
name did not execute.

**Two blocking defects were found, both from a single root cause, and both invisible
in small demo data.** The `docs` layer (completions, voids, archive list, uploads,
change history) persisted only to `localStorage`. At the shipped seed scale that
payload is **7.26 MB**, well past the ~5 MB per-origin quota, so:

* every administrative write silently failed to survive a refresh, and
* **every Empeon/Intelex staff import rolled back**, because the quota exception was
  thrown inside the import's transaction boundary.

This was reproduced against the original file: a valid 3-row import returned
*"Import rolled back. No changes were applied: Failed to execute 'setItem' on
'Storage': Setting the value of 'hasc_docs' exceeded the quota."* The primary
roster-maintenance workflow was non-functional as shipped.

**Defects fixed by severity — 11 total, plus one restored capability:**

| Severity | Count | Items |
|---|---|---|
| Blocking | 2 | Staff import always rolled back at scale; all admin writes lost on refresh at scale |
| High | 3 | `recordPouring()` runtime crash; archived staff could sign in to the Staff Portal; first-login temporary password unusable for the entire roster |
| Medium | 4 | Archived staff treated as active in 3 admin surfaces; wrong derived email format; template-key collision corrupting a Reports counter; `setTimeout` argument mis-nesting in the approval path |
| Low | 2 | Blank "Related session" field in the Void modal; duplicate object key |
| Capability | 1 | QA / Workflow Test Center shipped as a 1-row stub; replaced with 56 outcome-verifying checks |

**Safe for continued testing: yes.** The bundle loads clean from a fresh profile,
all 42 tabs across all four portals render without a single runtime error, and no
existing feature was removed or degraded.

**Production deployment still blocked by architecture, not by defects.** Every
authorization rule in this file is browser-side and therefore advisory. Staff
compliance data cannot sit behind it until Supabase Auth + RLS are in place. The
file itself documents this correctly and I did not weaken any of those boundaries.

---

## B. File-architecture handling

The outer file is a self-unpacking bundle, not flat HTML. Procedure followed:

1. Untouched backup taken before any edit.
2. `script[type="__bundler/template"]` JSON-decoded to a 1.85 MB working file.
3. **Round-trip verified byte-identical before editing anything** — extract → re-serialize
   → `cmp` against the original returned zero differences. This required reproducing the
   bundle's exact escaping conventions (`\uXXXX` for every non-ASCII code unit, `<\/script>`
   for close-script sequences).
4. All edits applied to the extracted source; re-serialized through the same verified path.
5. Post-build integrity confirmed:

| Check | Result |
|---|---|
| Outer prefix (loader, splash, CSP handling, manifest, ext_resources) | byte-identical |
| Outer suffix | byte-identical |
| `__bundler/manifest` (7 compressed assets) | byte-identical, parses |
| `__bundler/ext_resources` | byte-identical, parses |
| Asset UUID reference counts inside the template | identical to original (5/1/1/1/1/0/0) |
| Template tag ASCII-only, valid JSON | yes |
| Standalone `file://` load from clean profile | boots, splash clears, no fatal error |

The loader, Babel execution order, blob handling and resource map were not modified.

---

## C. Change log

### 1. Docs persistence exceeded the localStorage quota — **Blocking**

* **Area / portals:** shared persistence layer — Admin (all mutations), Manager, Instructor, Staff
* **Observable problem:** Admin records a completion, external certificate, pouring, void or
  archive action; the toast confirms success; after refresh the record is gone. Separately,
  every staff import aborted with *"Import rolled back — no changes applied."*
* **Root cause:** `saveDocs()` persisted the entire docs object to `localStorage`, capped near
  5 MB per origin. The live payload is 7.26 MB, so `setItem` threw `QuotaExceededError` on every
  write. In `saveDocs` the exception was swallowed behind a toast; in `applyImport()` the same
  `setItem` sat **inside** the transaction's `try`, so the quota failure triggered the rollback
  path and discarded a perfectly valid import.
* **Correction:** IndexedDB is now the durable store for `docs`, using the object store the app
  already opens for operational state (`hasc_lms_state_v3`). `localStorage` is retained as the
  fast cross-tab signal and legacy read path, written best-effort inside its own `try`. Both
  copies are timestamped (`hasc_docs_at_v1` / the IndexedDB record's `updatedAt`) and `loadData()`
  prefers whichever is newer, so a tab closed inside the 400 ms debounce cannot lose the last
  write. When the localStorage copy does not fit, a small `hasc_docs_ping_v1` timestamp is written
  instead so cross-tab sync still wakes other tabs, which then re-read IndexedDB. `applyImport()`
  now commits to IndexedDB inside the transaction and mirrors to localStorage best-effort;
  rollback and `undoLastStaffImport()` both restore the IndexedDB copy.
* **Backward compatibility:** an existing `hasc_docs` value is still read on first load, then
  migrated forward on the next write. No stored shape changed — `loadDocs()` takes an optional
  pre-parsed object and applies the same seed-merge normalization either way.
* **Regression tests:** small payload (21 KB) → localStorage written and stamped; large payload
  (30,000 synthetic completions) → localStorage refused, IndexedDB holds all 30,000, ping written;
  record a completion → reload → record present, roster letter green, correct date, on transcript;
  3-row import (2 updates + 1 new hire) → preview correct → applied atomically → undo restores the
  pre-import roster exactly; unrecognized CSV → rejected with a clear message, roster unchanged.
* **Performance impact:** neutral to positive. The IndexedDB write is debounced 400 ms and async,
  replacing a synchronous multi-megabyte `JSON.stringify` + `setItem` on the main thread.

### 2. `recordPouring()` threw `ReferenceError: r is not defined` — **High**

* **Area / portals:** Admin → Add Pouring; compliance (AMAPP/DIABP/TFP/CBP)
* **Observable problem:** Selecting a named HASC RN and clicking "Record accepted pouring" did
  nothing. Only the "Other" free-text path worked.
* **Root cause:** `this.staffById(rnChoice && this.isNurse(r))` — `r` is not in scope. Under class
  strict mode this is an immediate `ReferenceError`, aborting the handler before any state change.
* **Correction:** resolve the RN by id, then re-validate that the record is a nurse and not
  archived — preserving the evident intent of the `isNurse` call and keeping the existing
  "selected accepting RN is no longer available" guard meaningful.
* **Regression tests:** pouring recorded with a real RN → 1 completion added, AMAPP letter `g`,
  dated correctly, present on the transcript, audit entry written; "Other" path unchanged;
  duplicate-date guard still rejects a repeat.
* **Performance impact:** none.

### 3. Archived staff could sign in to the Staff Portal — **High**

* **Area / portals:** authentication; Admin Dashboard; SCORM assignment
* **Observable problem:** A terminated staff member could authenticate and view their record.
  Archived staff also appeared in the Admin Dashboard progress list and were selectable and
  counted in the SCORM course-assignment picker.
* **Root cause:** four code paths filtered on `r.archived`. `setArchived()` only ever writes
  `docs.archived` (an id list); **no roster record in the data set carries an `archived`
  property** — 0 of 3,943. Every one of those filters was a no-op.
* **Correction:** all four routed through the existing authoritative helpers
  (`activeStaffRoster()`, `archivedStaffSet()`, `isArchivedStaff()`). `isArchivedStaff()` was
  additionally changed from a linear `Array.includes` over 1,138 ids to the memoized Set, and
  still honours an explicit `s.archived === true` so a future import that does stamp the flag
  keeps working.
* **Regression tests:** archive a staff member → excluded from `activeStaffRoster()` and
  `getActiveStaff()`, absent from the SCORM picker, registration refused with
  *"…is inactive/archived and cannot be registered"*, staff login refused with *"No active staff
  member with that Staff ID."*; their completion history remains on the roster and transcript.
* **Performance impact:** small improvement (Set lookup replaces a 1,138-element scan).

### 4. First-time staff password derived the first name, not the last — **High**

* **Area / portals:** Staff Portal authentication
* **Observable problem:** The login screen states *"First time? Your temporary password is your
  last name."* Entering the last name failed for every staff member.
* **Root cause:** roster names are stored `"Last, First"` (the app's own `importNameParts().lms`
  builds exactly that). Both `doLogin()` and `savePwSetup()` used
  `String(name).trim().split(/\s+/).pop()`, which returns **"Twabib"** for `"Aaraf, Twabib"` — the
  first name. Manager, area-coordinator and instructor accounts are stored `"First Last"`, so the
  same expression was correct for them, which is why it survived.
* **Correction:** added `nameParts(name)` / `staffLastName(name)`, delegating to the existing
  `importNameParts()` parser that already handles both formats, plus a single-token fallback.
* **Regression tests:** old (wrong) value rejected with the correct hint; last name accepted →
  signs in → password-setup prompt appears → new password saved → sign out → sign in with the new
  password → sign in by derived email; manager login by both real and derived email unchanged.
* **Performance impact:** none.

### 5. `deriveEmail()` mis-parsed "Last, First" — **Medium**

* **Area / portals:** authentication (staff email login matching)
* **Observable problem:** `"Aaraf, Twabib"` derived `atwabib@hasccenter.org` — last-initial +
  first name — instead of the agency convention `taaraf@hasccenter.org`.
* **Root cause:** same naive `split(/\s+/)` as above.
* **Correction:** routed through `nameParts()`. Manager/instructor derivation is unchanged
  (verified explicitly). **Behaviour note:** a staff member who had memorised the previously
  derived (incorrect) address must now use the correct one, or their Staff ID — which is the
  documented primary path (`"Staff ID or email"`).
* **Regression tests:** four name-shape cases including a multi-word surname
  (`"Van Der Berg, Anna Marie"` → `avanderberg@`) and a single-token name; three seeded managers
  compared against their real addresses.
* **Performance impact:** none.

### 6. `schCount` template-key collision — **Medium**

* **Area / portals:** Admin → Reports → Schedules; Admin → Staff Records
* **Observable problem:** The "Scheduled Reports" header showed a bare number (the count of
  staff-change-history entries) instead of "· N schedule(s)".
* **Root cause:** two unrelated panels assigned `schCount` in the same `renderVals()` return
  object. The later assignment silently won for both templates.
* **Correction:** the Staff Change History counter renamed to `schChangeCount`, with its
  template binding updated to match.
* **Regression tests:** created 2 schedules and 3 staff-change entries → Reports shows
  "· 2 schedule(s)", Staff Records shows 3. Covered by a permanent structural QA check.
* **Performance impact:** none.

### 7. `approveReq()` passed a function call as `setTimeout`'s delay — **Medium**

* **Area / portals:** Admin → Approvals → notifications and reminders
* **Observable problem:** none visible — it worked by accident.
* **Root cause:** `setTimeout(fn, this.notifyStaffEvent(...), 0)` — the notify call occupied the
  *delay* argument. Its return value (an object, or `null`) coerced to `NaN` → 0. Any change to
  that return type would have become an arbitrary reminder-rebuild delay.
* **Correction:** split into two explicit statements.
* **Regression tests:** manager registers → admin approves → request `enrolled`, seat added to the
  session roster, staff Upcoming Sessions updated, one notification queued, no duplicate on a
  repeat call (`skipped: 'duplicate'`).
* **Performance impact:** none.

### 8. Void Completion modal — "Related session" always blank — **Low**

* **Area / portals:** Admin → Course Completions → Void
* **Root cause:** `openVoidModal()` stores the raw `buildCompletionRecords()` row; `sessLabel` is
  added later by the completions-table row mapper, so `{{ vmRec.sessLabel }}` never resolved.
  Detected by the DC runtime's own "never resolved" diagnostic.
* **Correction:** `vmSessLabel` derived alongside the existing `vmExpLabel` / `vmCertLabel`,
  using the identical expression as the table mapper.
* **Regression tests:** a full unresolved-binding sweep across all 42 tabs in all four portals
  plus seven modal states — original: 1 unresolved binding; corrected: **0**.

### 9. Duplicate object key `pourFormLabel` — **Low**

Exact duplicate with an identical value in the Add Pouring view-model; removed. No behaviour change.

### 10. QA / Workflow Test Center was a stub — **Capability restored**

* **Observable problem:** the tab returned a single row, *"QA suite not included in this build."*
  The Admin QA screen, its coverage map and its export were effectively inert.
* **Correction:** implemented 56 checks that assert on **outcomes** computed from live shared
  state — not on function existence. `qaResults()` is called from `renderVals()`, so the suite is
  strictly pure (no `setState`, no storage writes, no timers); mutating workflows are covered by
  asserting on the state they leave behind plus the structural invariants a broken workflow would
  violate. Sampled checks are bounded and say so in their "Actual" text. Total run cost: **404 ms**,
  memoized on the existing compliance-dependency key and only computed on the QA tab.
* **Proof the suite is not vacuous:** injecting six defects into live state (duplicate roster seat,
  duplicate completion id, malformed completion, dangling session reference, open request held by
  an archived staff member, two completions for one attendee) flipped exactly the six corresponding
  checks to FAIL and nothing else.

Coverage, all passing:

| Category | Checks |
|---|---|
| Attendance & certification | 12 |
| Compliance rules & overrides | 11 |
| Role scoping & permissions | 10 |
| Completions & transcripts | 8 |
| Registration & approvals | 7 |
| Certificates | 2 |
| Reports & scheduling | 2 |
| Core workflow & data integrity | 2 |
| Audit logging | 1 |
| Notifications | 1 |
| **Total** | **56** |

---

## D. Cross-portal verification matrix

Each row was executed end to end against the corrected build.

| Workflow | Staff | Manager | Instructor | Admin | Shared store | Persist | Compliance | Transcript | Certificate | Notification | Audit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Manager registration request | upcoming session appears after approval | request created `pendingAdmin` | — | lands in Approvals | `createRegistrationRequest` mirrored | ✓ IndexedDB | n/a | n/a | n/a | 1 queued, dedup on repeat | ✓ |
| Admin approval | ✓ | status → `enrolled` | roster updated | seat added, capacity respected | `approveRegistrationRequest` | ✓ | n/a | n/a | n/a | `registration_confirmed`, no duplicate | ✓ |
| Instructor certification | completion visible | progress views update | attendance + pass/fail, session locks | completion posted once | `finalizeCertification` | ✓ | letter → `g`, dated | entry added | issued per course config | — | ✓ |
| Double-certify (idempotency) | — | — | rejected (locked) | 0 additional completions | — | ✓ | unchanged | unchanged | unchanged | — | ✓ |
| Accepted pouring (Form 811) | not visible (manager-facing) | visible | — | recorded, RN resolved | `addIndependentCompletion` | ✓ | AMAPP → `g` | entry added | no certificate (by config) | — | ✓ |
| Archive staff | login refused | still visible for history | — | excluded from active lists | `applyStaffImportLifecycle` | ✓ | excluded from all aggregates | history retained | history retained | reminders cancelled | ✓ |
| Staff import (3 rows) | — | — | — | preview → atomic apply → undo | lifecycle mirrored | ✓ IndexedDB | recalculated | preserved | preserved | reminders closed out | ✓ |
| Void completion | removed from compliance | reflected | — | append-only void record | — | ✓ | no longer satisfies | retained historically | marked voided | — | ✓ actor + reason |
| Staff first login | ✓ signs in, sets password | — | — | — | `HASCSession` published | localStorage (per-user hash) | n/a | n/a | n/a | — | ✓ |

Scoping verified independently: manager sees 1,608 of 3,943 staff with 2,335 out of scope and no
roster exposure for sessions containing none of their staff; instructor reaches 5 of 67 sessions
with zero roster leakage on the other 62; staff sees only their own record.

---

## E. Remaining limitations

**Fixed and verified:** all 11 defects above.

**Prototype-only by design (unchanged, correctly labelled in-app):**
* Demo credentials are checked in the browser. Anyone with the file can enter any portal.
* All role scoping is UI-level. It is advisory and cannot be relied on as production security.
* The audit log is client-side and not tamper-evident.

**Requires Supabase:** real authentication with Employee-ID usernames and forced first-login
password change; RLS mirroring every `HASCPolicy` rule; server-side validation of every mutation;
durable multi-user storage (the browser stores here are single-device).

**Requires Edge Functions / provider credentials:** actual email and SMS delivery (the queue,
templates, idempotency, consent gating and webhook handling are all implemented and testable, but
nothing is dispatched); Bunny Stream API operations beyond playback. No provider secret is present
in the bundle — verified by a recursive scan of `HASC_CONFIG`, which is now a standing QA check.

**Cannot be enforced in browser-only code:** actor identity (a caller can edit JavaScript);
tamper-proof audit; cross-device data isolation; certificate authenticity.

**Still needs real-environment testing:** concurrent multi-user editing of the same session or
roster; genuine SCORM packages from your vendors (malformed and manifest-less ZIPs are handled
gracefully — verified — but only synthetic packages were exercised); live Bunny Stream playback,
resume and embedded-question timing; physical printer output (print documents were verified to
build correctly, and mobile print detection is present, but no paper was produced); PDF calendar
parsing against real HASC calendar files.

**Business rule flagged, deliberately not changed:** the brief states *"AMAP Pouring becomes green
only after three successful pourings and confirmation that the 811 documentation was sent to the
Training Department."* The implementation currently turns AMAPP green on **one** accepted pouring,
with the compliance date driven by the Form 811 received date when supplied (falling back to the
accepted date) and a 365-day renewal interval. AMAPP is correctly modelled as a separate
requirement — it is not satisfied by the AMAP certificate — and the "three RN-observed pourings"
rule is documented in-app as belonging to *initial* AMAP qualification, which is a different gate.
Converting the ongoing AMAPP row to a count-based rule would change the compliance status of
thousands of live records, and the seeded data carries no pouring-count history to evaluate it
against. I have not made that change: it is a business decision about which of the two readings is
authoritative, not a coding defect I can safely infer. Everything needed to implement it is
isolated in `recordPouring()` and `effStatus()` if you confirm the intent.

---

## F. Performance report

Measured in headless Chromium against the full 3,943-staff data set, before and after.

**Hot paths reviewed:** bundle unpacking · initial render · portal and tab switching · staff-search
typing · compliance matrix generation · location rankings · report preview · Course Progress
filtering · transcript and certificate generation · shared-store updates · persistence ·
IndexedDB hydration.

**Expensive operations found and their status:**

| Operation | Cost | Status |
|---|---|---|
| Compliance grid (3,943 × 26 = ~102k `effStatus` calls) | 82 ms cold | Memoized on the data key; repeat access **0 ms** and 0 additional `effStatus` calls (now a standing QA check) |
| `buildCompletionRecords()` over 24,385 records | 115 ms | Memoized |
| `renderVals()` — 1,158 view keys | **2 ms** | All heavy work behind memoized selectors |
| Reports tab first paint | ~550 ms | React reconciliation of a large screen, not computation. Per tab-switch, never per keystroke. Left as-is. |
| Docs persistence | was a synchronous 7.26 MB `JSON.stringify` + `setItem` on the main thread | Now a debounced async IndexedDB write — **improved** |
| `isArchivedStaff()` | linear scan of 1,138 ids | Now a memoized Set lookup — **improved** |

**Before / after (identical methodology):**

| Measurement | Original | Corrected |
|---|---|---|
| Keystroke latency, Staff Records search (max of 7) | 34 ms | 37 ms |
| Dashboard tab | 68 ms | 74 ms |
| Staff Records tab | 100 ms | 83 ms |
| Sessions tab | 167 ms | 185 ms |
| Approvals tab | 100 ms | 101 ms |
| Locations tab | 217 ms | 185 ms |
| Reports tab | 1045 ms | 1176 ms |
| 10× dash↔records round trip | 401 ms | 401 ms |

Differences are within run-to-run noise on a shared runner; no measurement moved outside it.
Typing, searching, filtering and portal navigation remain responsive: text entry never blocks, the
existing 200 ms debounce plus the precomputed staff-search index means a keystroke triggers **0**
`effStatus` calls outside the dashboard and records screens, and the search settles correctly.

**Resource hygiene confirmed:** `componentWillUnmount()` releases the store subscription, auth
subscription, key and storage listeners, smooth-input capture handlers, all pending timers, virtual-
list animation frames, device-resize listeners and calendar object URLs. The docs-persist timer was
added to that teardown and flushes its pending write on unmount rather than dropping it.

**Resilience:** with **every external host blocked** (offline simulation), the bundle unpacks,
boots, renders and completes a full mutate-persist-reload cycle with zero page errors. Malformed
SCORM ZIPs and unreadable manifests fail with specific messages and leave the course catalog and
the rest of the application intact.

---

## G. Verification performed on the corrected build

| Check | Result |
|---|---|
| ESLint correctness rules (`no-undef`, `no-dupe-keys`, `no-unreachable`, `no-const-assign`, …) over all inline scripts and both bundled shared-layer assets | 0 errors |
| Standalone `file://` load from a clean browser profile | boots, splash clears, no fatal error |
| Tabs navigated across Admin (26), Manager (9), Instructor (3), Staff (4) | 42 / 42 render content, **0 runtime errors** |
| Unresolved template bindings across all tabs + 7 modal states | 0 (was 1) |
| Viewports: 1920×1080, 1440×900, 1100×800, 820×1180, 1180×820, 390×844, 844×390 | 0 px horizontal overflow, 0 off-screen buttons |
| Modals open, render and close on Escape | ✓ (cert, why-this-status, attendance sheet, void, cancel session) |
| Print paths build their document root | transcript, certificate, batch transcripts, batch certificates ✓ |
| XSS: `<img onerror>` injected into staff name, position and location, rendered to a print document | did not execute; payload escaped |
| Persistence: mutate → reload | record survives, roster letter, date and transcript all correct |
| Import: unrecognized CSV / valid import / undo | rejected cleanly / applied atomically / restored exactly |
| Built-in QA suite | 56 / 56 pass in 404 ms |
| QA suite negative control (6 injected defects) | exactly 6 corresponding checks flip to FAIL |
