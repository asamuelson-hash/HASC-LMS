# Certificates & Training Records audit (CRT)

Build: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html`, file read: `work/template.html`. Runtime checks used the harness (`work/scratch/certs/a1..a8.mjs`) on real roster staff (IDs 20002, 20379, 19851, 20691, 3294).
**Clock:** there is no fixed demo clock. `todayDate()` returns `new Date()` (L7965) and `TODAY_MDY` is derived from it (L8007). The only hard-coded date is `MOCK_COMPLETION_CUTOFF='7/1/26'`, which the one-time scrub uses.
Data shape: 4,053 staff, 24,654 seeded completions (all "Imported historical completion"), 17,587 synthesized completion records. The seed has no cert-ID collisions, no dt-vs-completion date-format mismatches and no duplicate transcript rows. 1,924 transcript rows are legacy-course history, and none of them issue a certificate.

Escaping passed: I set a staff name to `<img onerror>` and a location to `<script>`, then rendered the certificate modal, `printOneCert`, `printAllTranscripts` and the admin Transcripts tab. Nothing executed. `certBlockHTML`, `transcriptBlockHTML` and `documentHeaderHTML` all run text through `esc()`. **No escaping finding.**

---

## CRT-01 — Entering an older (backdated) completion or external certificate overwrites a newer one and makes compliant staff Expired — **Critical** — VERIFIED-RUNTIME
- **Where:** Admin → Record Entry → Independent completion / External certificate. `recordCompletion()` L10098 (final `roster.map` that sets `eo[code]=exp`). `recordExtCertDirect()` L10032 and `approveExtCert()` L11767 (`sat.forEach(c=>{dt[c]=date; ovr[c]=exp})`).
- **Current behavior:**
  - `recordCompletion` writes the new record's expiry into `expOverride[code]` whatever its date. `recordExtCertDirect` and `approveExtCert` overwrite both `dt[code]` and `expOverride[code]`, even when the certificate is older than what is already on record.
  - Staff 20002 had CPR 2/22/26 (green). An admin entered a historic CPR card dated 3/1/22. The result was dt still 2/22/26 but expOverride 3/1/24, and status **r "Missing / Expired"**. The transcript then shows the 2/22/26 completion as "Expires 3/1/24 · Overdue".
  - Staff 3294 had CPR 2/19/25. An admin added an external CPR dated 2/1/21. dt became **2/1/21**, expiry 2/1/23, status red.
  - The damage **survives reload**: operational roster persistence saves it, and staff 20002 was still red after `page.reload()`.
- **Expected:** a record older than the current driving completion is added to history only. Compliance and expiry should follow the latest valid completion.
- **Root cause:** direct roster mutation that skips the "latest wins" rule already used in `applyCompletionsToRoster` (L14195).
- **Fix:** remove the manual `dt`/`rec`/`expOverride` writes in all three functions. After saving docs, recompute with `applyCompletionsToRoster(applyVoidsToRoster(roster,docs),docs)`, and make that function honor `satisfiedRequirements` (see CRT-04). If a manual expiry override is needed, apply it only when the new completion is the latest for that code. Also add a one-time repair: rebuild `expOverride` from the latest non-voided completion for every staff/code.
- **Regression risk:** medium. Compliance colors change for anyone already affected, which is the intended result.
- **Test:** for a green staff, add an older CPR through each of the three paths. Status stays green, the transcript shows both rows with their own expiries, and the result survives a reload.

## CRT-02 — Older completions on the transcript, certificates and Completions list show the latest completion's expiry — **High** — VERIFIED-RUNTIME
- **Where:** `expirationFor()` L8230 (returns `staff.expOverride[code]` before calculating from the completion date). It is called per historical row from `buildTranscript()` L14210 (`_baseRows` and `_extra`) and from `mkCompRecord()` L10484.
- **Current behavior:** staff 20002 has CPR 2/22/26 and a new CPR 9/1/26 that stores expiry 9/1/28. Both transcript rows and both completion records show **Expires 9/1/28**. The 2/22/26 row should show 2/22/28, or its own stored expiry. The staff-wide override leaks into every historical row, and "Status/Expired" on the Completions list is wrong for history.
- **Expected:** each row shows the expiry stored on its own completion. With none stored, it is calculated from that row's date. The staff-level override applies only to the current driving date.
- **Fix:** add `expirationForRecord(st,code,date,rec)`. It returns `rec.expires`, else the staff override only when `st.dt[code]===date`, else the calculated value. Use it in `buildTranscript`, `mkCompRecord` and `certAuditLine`.
- **Regression risk:** low.
- **Test:** the scenario above. The 2/22/26 row must read 2/22/28.

## CRT-03 — A completion re-entered after a void is permanently invisible, yet compliance shows green with no date — **High** — VERIFIED-RUNTIME
- **Where:** voids are keyed by `staffId|code|date` (`completionKey` L10477). Checked by `voidKeySet`, `transcriptStaff`, `buildTranscript`, `applyCompletionsToRoster`, `mkCompRecord`. The duplicate check in `recordCompletion`/`recordPouring`/`recordRnCourse` allows re-entry after a void.
- **Current behavior (staff 20691):**
  1. Recorded FA 9/1/26 with a mistyped expiry.
  2. Voided it (reason "wrong expiry").
  3. Re-entered FA 9/1/26 correctly.

  The new record `cm…646` exists, but the transcript shows **0 FA rows**, the Completions list shows only the voided row, and no certificate exists. `dt.FA` is undefined, yet `effStatus` = **g**, because `recordCompletion` still writes `expOverride.FA`. The two same-date records also can't be told apart, so voiding one voids every completion of that code on that date (for example a session and an external card on the same day).
- **Expected:** a void targets one completion record, by ID. A corrected re-entry is visible everywhere, and compliance never goes green without a dated record.
- **Fix:** store `completionId` on each void entry and match on it when present. Keep the composite key only for seed or `dt`-only rows that have no ID. In `recordCompletion`, don't write `expOverride` when the resulting `dt[code]` doesn't equal the new date.
- **Regression risk:** medium. Existing void entries need a migration so the key is resolved to IDs.
- **Test:** the void → re-enter sequence above. Expect one voided row and one active row, a transcript row and a certificate.

## CRT-04 — EMT or multi-requirement external certificates: partial void is inconsistent, compliance lives only in the roster, and the transcript shows duplicate "CPR+FA" rows — **High** — VERIFIED-RUNTIME
- **Where:** `recordExtCertDirect`/`approveExtCert` store `complianceCode:'CPR+FA'` plus `satisfiedRequirements`. `applyCompletionsToRoster` L14195 ignores `satisfiedRequirements`, while `transcriptStaff` L14172 honors them. `applyVoidsToRoster` L10569 matches candidates only on `complianceCode||code||course`.
- **Current behavior:**
  - One EMT card produces three transcript rows and three certificates: "CPR In-Person", "First Aid" and **"CPR+FA"**. The final map in `buildTranscript` re-derives the name from `documentCourseName(r.code,r)` without `r.name`, so the real title "EMT Card" is lost.
  - Voiding the CPR row (the natural action from the Completions list) correctly drops compliance back to the previous CPR date. But the transcript still lists CPR 9/10/26, and both the CPR and the CPR+FA certificates are still printable.
  - Rebuilding staff 20691 from seed plus docs (`applyCompletionsToRoster(applyVoidsToRoster([seed]))`) gives CPR/FA = **null/red** and a junk `dt['CPR+FA']`. The EMT card's compliance effect exists only in the persisted operational roster. Any roster rebuild, re-import or backend migration loses it.
- **Fix:** in `applyCompletionsToRoster` and `applyVoidsToRoster`, expand each completion to `satisfiedRequirements` when present. In `buildTranscript`, emit one row per external card, titled from the record (keep `r.name`/`displayCourseTitle`), and suppress the matching `dt` base rows. A void on any affected code should void the parent record (see CRT-03).
- **Regression risk:** medium.
- **Test:** EMT card → one transcript row and one certificate. Void it → CPR and FA both revert. Rebuild the roster from docs → same statuses.

## CRT-05 — A certificate can print another completion's Certificate ID and dates; the ID on the staff card differs from the printed one — **High** — VERIFIED-RUNTIME
- **Where:** `certFacts()` L8329 uses `certAuditLine()` L8266. That function picks `.slice(-1)[0]`, the last-appended completion for the code (not the one being printed and not the latest by date), and its "Certificate ID" overrides `compCertId`. Staff card IDs are built separately at L15489/L15500.
- **Current behavior:**
  - Staff 20002 has FA 3/9/26. An admin later adds a backdated external FA dated 1/5/20. Printing the 3/9/26 certificate now shows **Certificate ID ec1790113009194**, the 2020 card's ID, and a verification line reading "Completion Date: 1/5/20 | Expires: 1/5/22".
  - For an external CPR dated 9/15/26, the staff card shows `HASC-20002-CPR-91526` while the printed certificate and the admin list show `ec1790113007329`.
- **Expected:** the printed ID, the card ID and the admin list ID all come from the same completion record.
- **Fix:** resolve the specific completion first (by ID, else by exact staff+code+date) and use `certFacts` only from that record. Drop `certAuditLine` from `certFacts`. Keep `r.completionId` and `certId` on `_baseRows` in `buildTranscript` by looking up the matching record, so cards, lists and prints share one ID.
- **Test:** the scenario above. All three places show the same ID and the certificate's own dates.

## CRT-06 — Generated certificate numbers are not unique and not stable — **Medium** — VERIFIED-RUNTIME
- **Where:** `compCertId()` L10484 = `'HASC-'+id+'-'+code+'-'+date.replace(/\D/g,'')`. The same formula is duplicated at L15489, L15500 and in `applyCertResolution`.
- **Current behavior:** staff 20379 had FA 1/12/26 and FA 11/2/26. Both certificates printed **HASC-20379-FA-11226**. The ID also depends on the date string's format ("03/05/24" and "3/5/24" give different IDs), so a normalizing import or reference reconcile would silently renumber certificates. Online courses reuse `CERT-<course>-v<ver>-<sid>` for every retake (see CRT-07).
- **Fix:** assign a persisted, unique `certId` on the completion when it is created (for example `HASC-<sid>-<code>-<yyyymmdd>-<seq>` or a UUID). Backfill once for seed records using the zero-padded ISO date. Never recompute it at view time.
- **Test:** two same-course completions on 1/12 and 11/2 get different IDs, and the IDs are unchanged after a reload or re-import.

## CRT-07 — Online-course retake overwrites the prior completion (history lost, same certificate number reused) — **High** — VERIFIED-CODE
- **Where:** `finishOnlineCourse()` L9064-9069 (`_dupIdx` ⇒ `{...x,...newComp,id:x.id}`) and `postOnlineCompletion()` L14250 (`existsIdx`).
- **Current behavior:** completing the same course version again, for example next year's annual renewal, replaces the date and expiry on the existing record. The prior completion disappears from the transcript, the Completions list and the certificates, and the new certificate keeps the old `CERT-…` number. If the old record was voided, the void entry is orphaned.
- **Contrast:** self-hosted video courses (`HASCStore.vtFinalizeCompletion`) append a record with `retake_no` and a `-R<n>` certificate ID, which is correct.
- **Fix:** dedupe only a genuine double-submit (same staff+course+version+date). Otherwise append a new record with a new certificate ID.
- **Test:** complete an online course, move the clock forward one year, complete it again. The transcript should show 2 rows.

## CRT-08 — Changing a course's renewal period silently recalculates expiry for all history, but only for some records — **High** — VERIFIED-RUNTIME
- **Where:** `saveCourseInformation()` L7525 → `courseInfoRenewalDays` → `catalogIntervalDays`, used live by `effStatus` and `expirationFor`.
- **Current behavior:**
  - Setting CPR to "custom 180 days" changed the active CPR-compliant count from **358 to 42** instantly. There was no preview, no confirmation and no effective date; the audit entry only says "default → custom · 180 days".
  - Setting CPR to annual changed staff 20002's 2/22/26 completion from Expires 2/22/28 to 2/22/27 on the transcript and the Completions list.
  - Records that stored an `expires` value (independent, external, online, file-imported) keep their original expiry, while seed and session records are recalculated. Two staff with the same completion date can therefore get different outcomes depending on how their record was entered.
- **Expected (needs a product decision):** usually the renewal policy applies from an effective date forward, and records carry the expiry they were issued with. Either way the behavior must be the same for every record, with an impact preview.
- **Fix:** when a completion is created (session certify L14442, seed backfill), store `expires` together with `ruleVersion`. Add `effectiveFrom` to course information and use the new interval only for completions on or after that date. Show "N staff will change status" before saving.
- **Test:** change CPR renewal. Existing completions keep their stored expiry, and new completions use the new rule.

## CRT-09 — "Certificate disabled for future completions" also removes certificates from past records — **Medium** — VERIFIED-RUNTIME
- **Where:** `toggleCourseCert()` L10191 / `courseConfig()` L10184 → `mkCompRecord` (`issuesCert` uses the current config) → `certStatusMap`/`printableCertificateRows`. Retiring a custom course (`toggleCustomCourse` L9119) has the same effect, because `courseConfig` forces `issueCertificate=false` for codes no longer in the active catalog.
- **Current behavior:** turning CPR off took the CPR records with a certificate from **590 to 566**. The 24 historical records without an explicit `certGenerated` flag lost their certificate and certificate ID, and records with the flag kept theirs. The toast says "future completions are transcript-only", and the retire audit says "completions already earned are untouched". Both are untrue.
- **Fix:** decide certificate eligibility when the completion is created (store `certGenerated` and `certId`; backfill seed records once). Views read only the record's own flag.
- **Test:** turn a course's certificate off. Existing certificates stay the same and new completions have none.

## CRT-10 — Voided completions can still be printed or opened by the direct certificate functions — **Low/Medium** — VERIFIED-RUNTIME
- **Where:** `printOneCert` L8269, `printCertificateRow` L8274, `printCompletionCert` L8268, `openCertFor` L14132. None of them check `isCompVoided`, `certStatusAt` or `canSeeCertAs`.
- **Current behavior:** after the voided ART of staff 19851 left the transcript and the certificate lists (both 0 rows, which is correct), `printOneCert` and `printCertificateRow` each still produced a certificate, and `openCertFor` opened the modal. The UI lists no longer offer these rows, so the risk is limited to stale buttons, deep calls and future screens.
- **Fix:** add a single guard `certificatePrintable(staffId,code,date,completionId,role)` covering void, missing, withheld and visibility, and call it from every print and open path.

## CRT-11 — Expiry shown on documents doesn't match the compliance engine for location overrides and day-vs-year arithmetic — **Medium** — VERIFIED-CODE
- **Where:** `expirationFor()` L8230, `calcExpiry()` (L10032 block) and `trainingImportExpiration()` L10704 use `catalogIntervalDays` and add whole **years**. `effStatus` (L8011) uses `effInterval` (L7949, which includes location `intervalDays` and `oneTime`) and adds **days** (`statusFromDate`).
- **Current behavior:**
  - A location override (for example CPR annual at one site) turns the matrix red while the transcript and the Completions list still show the 2-year date.
  - A `oneTime` override shows an expiry on the transcript while compliance treats the course as not expiring.
  - Adding 730 days instead of 2 years moves the due date by one day across a leap year: status goes red on 1/31/26 while the document says 2/1/26 for a 2/1/24 completion.
  - `expirationFor` also parses two-digit years as `2000+y`, while `_yr` pivots at 50, so a 1990s date on a course with an expiry would compute an expiry in 2090-2099. It is currently latent because every pre-2000 completion found (8) is on a non-expiring course.
- **Fix:** add one `expiryDate(staff,code,date)` built on `effInterval` and `_yr`, with the same year-vs-day rule on both sides. Use it in `statusFromDate`, `expirationFor`, `calcExpiry` and `trainingImportExpiration`.

## CRT-12 — Some void and un-void paths are not append-only — **Medium** — VERIFIED-CODE
- **Where:** `correctCertifiedAttendance()` L14492 (`voids=voids.filter(v=>v.key!==key)`).
- **Current behavior:** no UI can reverse a void, but correcting a certified attendee to Pass deletes **every** void entry with that staff|code|date key, including a void an admin made for another reason. The void history is erased. Only a generic "Attendance correction" audit row remains, not an "un-void" entry.
- **Fix:** append a `{type:'reinstated', voidId, reason, by, at}` entry instead of deleting, and match by `completionId` (see CRT-03). Add a proper admin "Reinstate completion" action with reason and audit.

## CRT-13 — One-time load scrubs hard-delete real completion history without an audit entry — **Medium** — VERIFIED-CODE
- **Where:** `loadData()` L14031-14032. `scrubCompletionsAfterCutoff()` L13837 deletes every completion dated after 7/1/26 that is not in the 9/15 reference. `scrubTestOnlineCompletions()` L13869 deletes **all** online, SCORM and video completion records.
- **Current behavior:** both are gated by a marker in docs. Any install whose docs lack the marker (restored backup via `importData`, a new device syncing older docs, a server migration) permanently loses genuine post-cutoff and online completions. There is no `logAudit` entry and no void-style soft delete.
- **Fix:** remove these prototype scrubs before production, or turn them into soft-deletes (`referenceSuperseded` plus reason) with an audit summary, and never run them on data restored from a backup.

## CRT-14 — Built-in course titles are not captured on seed and dt rows (rename rewrites history) — **Low** — VERIFIED-CODE
- **Where:** `buildTranscript` `_baseRows` (`documentCourseName(c)` with no record), and seed records whose `displayCourseTitle` equals the raw code ("ART"), which `documentCourseName` ignores.
- **Current behavior:** session, independent, import and video completions capture their own title, so they survive a rename. Custom courses have no rename UI, and a retired course keeps its catalog label, so it is not reclassified as legacy. But ~17.6k seed and `dt` rows take their title from `COURSE_NAME` and the current catalog, so any future edit to those labels rewrites the name on historical certificates. The same code also shows one title regardless of variant: CPR Blended and external CPR cards all print "CPR In-Person".
- **Fix:** backfill `displayCourseTitle` on seed completions from the title in force at import time, and pass the matched record into `_baseRows`.

---

## Verified correct
- Escaping of certificates, transcripts, batch prints and the modal.
- Voids are consistent across transcript, certificates, compliance and the staff "My Trainings" view for a single-code completion (staff 19851 ART). The void has a reason, an acknowledgment, actor and date, and an audit log entry.
- A session that is already certified can't be re-certified (dedupe on `existing`).
- Legacy course rows (1,924) are hidden by default behind `certShowLegacy`/`trxShowLegacy` and never produce certificates.
- Batch prints enforce `batchScope` (manager scope) and a 400-document cap.
- Video completions are versioned and appended, keep `course_title` and have unique retake certificate IDs.

## Areas not conclusively tested
- Real `window.print()` and PDF output: the harness captured `#__printRoot` HTML only. The mobile print toolbar was not exercised.
- Manager-portal certificate visibility (`canSeeCertAs` 'manager') and the admin Certificates-tab UI filters were exercised only through the underlying functions.
- The location-override expiry mismatch (CRT-11) is code-traced only; no location profile was built in the harness.
- Pouring (`recordPouring`) and RN course paths were read in code, not run. They share CRT-01's `expires`-driven override exposure only through `applyCompletionsToRoster`, which is latest-wins and therefore safe.
- Online-course retake overwrite (CRT-07) is code-traced only; I didn't drive an online course player end to end.
- SCORM completion certificates (`recordScormCompletion`).
