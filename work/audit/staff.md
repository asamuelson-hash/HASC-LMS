# Staff Portal audit (STF-)

Build: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html` (read from `work/template.html`, runtime tests on `work/out.html`).
Scripts: `work/scratch/staff/s1–s6.mjs`. Screenshots: `work/shots/staff_*.png`.
Clock: the app uses the real browser clock (`todayDate(){ return new Date(); }`, l.7965). There is no fixed demo clock. Runtime date was 2026-09-22.

Seed state: 4,053 roster rows, 2,734 employment-active. There are 0 upcoming sessions, 0 requests, 0 video courses and 0 online courses. To test Upcoming Sessions and the video flow I created a session, a registration and a video course from the admin side during the test.

---

## STF-01: "My Trainings" does not show requirement or compliance status. Staff never see overdue in-person requirements
- **Portal/module:** Staff › My Trainings · l.1926-2131 (template), l.15465-15482 (`sBuild`, `sCoursesAll`, `sActions`, `sHeroLine`), l.16316 (`sOnline`)
- **Current:** The tab lists only assigned video and online courses. The compliance list is built with the same engine that admin and manager use (`buildStaffCourses` → `effStatus`), but nothing renders it: `sCourses`, `sActions`, `sHeroLine`, `sPct`, `sUp` and `sTotal` have zero `{{ }}` bindings (grep). **VERIFIED-RUNTIME:**
  - Melana Matatov (16796): the engine says `PA:red CPR:red FA:red SCIPR:white DIABP:white`. My Trainings says "No online trainings are assigned to you right now."
  - Hoda Abbas (20443): the engine says `ART:red`. ART appears nowhere in her portal, because the transcript is completed-only and she has never completed ART.
  - Overdue items that have an old completion only appear as a transcript "Overdue" pill.
- **Expected:** Staff should see their required trainings with the same status the manager matrix shows (overdue, due soon, not started), plus the next step ("contact manager" or "registered for …").
- **Severity:** High. Staff get a silently incomplete picture of their compliance, and the page header implies they are fine.
- **Root cause:** The staff portal was cut down to a "limited personal-records portal" (comment at l.15489). The computed model was kept but its markup was removed. The `sBuild` actions are also dead: "Start module"/"Renew online" use `onAction=()=>{}`, and "Completed" is a no-op.
- **Fix:** Add a "My Requirements" section (or restore it in the trainings tab) bound to `sCourses`/`sActions`/`sHeroLine`. Replace the no-op `onAction` with real targets: open the matching video assignment, or show "Contact your manager".
- **Regression risk:** Low (view only).
- **Test:** Log in as 16796. PA/CPR/FA should show Overdue, matching the manager matrix cells for the same staff member.

## STF-02: A failed quiz shows the correct answers, and re-selecting locally enables "Continue" without a recorded pass. This leads to a dead end at the final step
- **Portal/module:** Staff › My Trainings › course player · `cpSubmitQuiz` l.9021, quiz VM in the `cp` build (~l.16345: `quizQs` styles, `canNext = cpQuizShown && quizPass`), `finishOnlineCourse` l.9048
- **Current (VERIFIED-RUNTIME, s5.mjs):**
  1. The staff member answers wrong and clicks Submit. The attempt is recorded (1/3) and scores 0%.
  2. The options are then restyled with the correct answer bordered green (`rgb(31,157,85)`) and the wrong pick red.
  3. Clicking the correct option (no resubmit) enables **Continue**, because `quizPass` uses local `cpQuizAns`, not the stored attempt. The staff member moves through attestation and the certificate step.
  4. "Finish & post completion" then toasts "Course cannot be submitted yet: passing quiz score". There is no Back button, so the only way out is to close and restart.
  5. On restart the staff member already knows the answers, and attempt 2 passes.
- **Expected:** Do not show correct answers after a failed attempt. `canNext` must use the recorded attempt (`vtProgressFor(...).passed_at`, or the score from the last `vtSubmitQuiz` result). After a failure, show "Try again" (a new attempt) rather than letting the staff member re-pick.
- **Severity:** High. It undermines assessment integrity for mandatory compliance courses (PA in the test), and it creates a dead-end workflow.
- **Root cause:** The player's quiz UI was built for local simulated courses. The VT path records attempts in the store but still reads local state for navigation and styling.
- **Fix:** In the `cp` VM, for `pc.vtVideoId`, set `quizPass = !!vtProgressFor(vid,sid).passed_at`. Only highlight correct answers when passed (or never). On a fail, reset `cpQuizAns` and `cpQuizShown` and show the attempts left.
- **Regression risk:** Medium (shared by online courses and VT courses).
- **Test:** Fail the quiz once. Continue must stay disabled, no green answer should be shown, and the attempts counter should drop.

## STF-03: The same certificate shows two different Verification IDs and two different course names
- **Portal/module:** My Certificates / My Transcript vs the View / Print certificate · `buildTranscript` l.14210 (dedupe `_seen` by `code|date`), l.15487/15504 (`certId` fallback `HASC-<id>-<code>-<date>`), cert modal l.15913, `printOneCert` l.8269
- **Current (VERIFIED-RUNTIME):** After the video completion posts PA 9/22/26:
  - The card and transcript show **Verification ID `HASC-16796-PA-92226`**.
  - "View" and "Download / Print" show **`HASC-16796-VTUKYLWCD-V1`**, which is the real `completion.certificate_id`.
  - On-screen View says course "PA Refresher Video", while the printed PDF says "Positive Approaches to Challenging Behaviors".
- **Why:** The roster `dt.PA` row is emitted first with no `certId`. The docs completion row that carries the real certificate ID is then dropped as a duplicate of `PA|9/22/26`. The card then synthesizes an ID. The modal uses `documentCourseName(code,cm)`, which prefers the completion's `displayCourseTitle`, but print uses the row without the completion.
- **Expected:** One canonical certificate ID and one title everywhere (card, transcript, view, print, verification).
- **Severity:** High. A verification ID printed on the transcript would not match the ID on the certificate itself.
- **Fix:** When deduping in `buildTranscript`, merge the matching completion's `certId`, `completionId` and `source` into the existing base row instead of discarding it. Pass `completionId` through `sCerts` so view and print resolve the same record.
- **Regression risk:** Medium (affects admin and manager transcripts too).
- **Test:** Complete a compliance video. The card ID, the transcript ID, the View ID and the Print ID must all be equal.

## STF-04: The temporary password (last name) works permanently on any other device; the set password is stored only in this browser's localStorage
- **Portal/module:** Login · `doLogin` l.8139-8166, `savePwSetup` l.8126-8136
- **Current (VERIFIED-CODE, runtime on the same browser):**
  - The chosen password is saved only as `localStorage['hasc_staff_pw:<id>']`. After it is set, this browser correctly rejects the last name ("Incorrect password.").
  - On any other browser or device, `stored` is null, so the last name logs straight in and the "set password" prompt appears again. Anyone who knows a staff ID (a sequential number that appears on transcripts, certificates and manager screens) plus the surname can open that person's records.
  - The set-password modal cannot be dismissed. That is fine, but it gives the staff member a false sense of security.
- **Expected:** Credentials stored on the server (Supabase Auth), and a first-login password change enforced server-side.
- **Severity:** Critical as a production control. It is marked "DEMO AUTH ONLY" on the role picker, so as a demo it is known-by-design, but it must be a go-live blocker.
- **Fix:** Move to `HASCAuth` or Supabase `signInWithPassword`. Until then, store the hash in shared persisted state rather than per-browser localStorage.
- **Test:** Set a password in profile A. In a fresh profile B the last name must be rejected.

## STF-05: Presentation does not check permission. A staff session can render another employee's certificate and transcript
- **Portal/module:** `openCertFor` l.14132 (no `canViewStaffMember`), cert modal VM l.15913 (renders any `md.staffId`), staff portal VM trusts `currentUser.staffId` (l.15473)
- **Current (VERIFIED-RUNTIME, s6.mjs):**
  - Signed in as 16796, calling `openCertFor('20443','SDCH1')` renders "THIS CERTIFIES THAT Hoda Abbas … SDCH Part 1".
  - `printStaffCerts` and `printOneCert` are correctly blocked ("You do not have permission…").
  - Setting `currentUser.staffId='20443'` shows Hoda Abbas's full transcript.
- **Expected:** Every view path checks the same guard. Production enforces this with RLS.
- **Severity:** Medium. This is client-side, all data is already in the page, and the comments state that RLS is required. The inconsistency is still a defense-in-depth gap: print is guarded but view is not.
- **Fix:** Add `if(!this.canViewStaffMember(this.staffById(staffId))) return toast` to `openCertFor`, `openVideoCert` and `openCert`, and the same check in the cert-modal VM. Keep RLS as the real control.
- **Test:** From a staff session, call `openCertFor` for another ID. Nothing should render.

## STF-06: Each assigned video course appears twice on My Trainings, and the two copies can show different statuses
- **Portal/module:** `sVtRows` (l.13742, "Assigned video training") and `sOnline.push(...)` for every VT assignment (l.16320-16333, "Online courses")
- **Current (VERIFIED-RUNTIME):** "PA Refresher Video" is listed under both headers, with two start buttons ("Start" and "Start course"). The completion logic also differs between the two lists:
  - `sVtRows` uses `vtCompletionFor(version)`.
  - `sOnline` counts done if `passed_at`, *or* course progress, *or any completion for the compliance code from any source* (`_videoCompletionPresence`). A staff member with an in-person PA completion would see the video as "Completed" in one list and "Not started" in the other (VERIFIED-CODE).
  - The "Online courses" header only appears when video courses exist.
- **Severity:** Medium (confusing UX and contradictory status).
- **Fix:** Remove the VT push from `sOnline` (keep `sOnline` for `ocFor` courses), or remove the `sVtRows` section. Use one status rule for both.
- **Test:** Assign one video. It should appear exactly once.

## STF-07: The attestation signature accepts any text
- **Portal/module:** `finishOnlineCourse` l.9050, `vtFinishVideoCourse` l.13232
- **Current:** VERIFIED-RUNTIME. Signing "Someone Else" for Melana Matatov posted the completion and generated a certificate.
- **Expected:** The typed name matches the signed-in staff name (normalized, case- and order-insensitive), or at least first and last name tokens.
- **Severity:** Medium (weak evidence of attestation on mandatory records).
- **Fix:** Compare the normalized signature against `nameParts(st.name)` and require both first and last names.

## STF-08: The temporary-password rule is ambiguous for compound surnames and suffixes
- **Portal/module:** `doLogin` l.8157 (`last = nameParts(rec.name).last`), hint l.15402
- **Current:** VERIFIED-RUNTIME. For "Acevedo de Reyes, Flerida", entering "Acevedo" fails and "Acevedo de Reyes" works. Suffixes become part of the password: "Dawson Jr", "Cunningham II".
- **Why it matters:** The hint only says "your last name", so these staff members get locked out.
- **Severity:** Medium (login dead end for a real population).
- **Fix:** Strip suffixes (Jr, Sr, II, III, IV) and compare with spaces, hyphens and apostrophes removed. Optionally also accept the first surname token. Update the hint to say "full last name exactly as on your paystub, without Jr/Sr".

## STF-09: Login error messages reveal account status, and staff with short IDs cannot use Staff ID login
- **Current (VERIFIED-RUNTIME):**
  - An inactive or archived ID gets "No active staff member with that Staff ID". The same person's derived email gets "Incorrect email or password".
  - A wrong password on an ID with no set password gets "First-time login: your temporary password is your last name." This confirms the ID is valid and active, and restates the password rule.
  - The roster contains a placeholder active record `id:'1', name:'SA, Client'`. It cannot log in by ID because the ID regex requires 3 or more digits (`/^\d{3,}$/`). It also appears to be a test record in the live roster.
- **Severity:** Low.
- **Fix:** Use one generic failure message, loosen the ID regex to `/^\d+$/`, and remove or flag the "SA, Client" record.

## STF-10: Login-card footer text is wrong for staff
- **Portal/module:** l.1842 "Use your HASC Center work email and password." is shown on the Staff login.
- **Current:** Staff actually sign in with Staff ID (or a derived email) plus their last name, or the password they set.
- **Severity:** Low (UX).
- **Fix:** Make the footer role-specific.

## STF-11: No self-service registration or session request. Every entry point says "contact your manager"
- **Portal/module:** `staffRequest` l.14265 (inert stub), PERMISSIONS l.8213
- **Current:** There is no way for staff to request a session or register. Upcoming Sessions is read-only. This is intentional per the comments.
- **Inconsistency:** The PERMISSIONS comment says "online-course taking … intentionally NOT granted", but the array grants `take_online_course` and the portal does offer course taking.
- **Severity:** Low (product decision). It is listed because the task asked about it. Combined with STF-01, staff have no in-app path from "overdue" to "registered".
- **Fix:** Either add a "Request a session" action that creates a `pendingMgr` request (the manager flow already handles that status), or update the comment and help text to match.

## STF-12: A cancelled session stays under "needs rescheduling" indefinitely and shows no reason
- **Portal/module:** `sNeedsReschedule` l.15513
- **Current (VERIFIED-RUNTIME):**
  - After the admin cancels, staff see "A training session needs to be rescheduled", with the old date and "TBD". The cancellation reason ("Instructor ill") is not shown.
  - The entry never ages out if the admin never reschedules or denies it.
  - Removal from a roster correctly drops the session from the list (request status becomes `removed`).
- **Severity:** Low.
- **Fix:** Show `cancelReason` from the `cancelledSessions` snapshot. Hide or archive the entry after N days or when the admin closes the request.

---

## What works (verified)
- **Login through the real form:** ID login and case/whitespace-tolerant last name work. Mandatory first-login password setup works: it enforces at least 6 characters, a matching confirmation, and a password different from the last name. After setup, the last name is rejected in this browser.
- **Duplicate names:** Two active staff who share a derived email (89 collisions) get a clear message to use their Staff ID.
- **Inactive and archived staff:** They are blocked at login. If an active session later becomes inactive, the portal shows "Account unavailable" (`sAccountInactive`).
- **Session handling:** A reload drops the session.
- **Upcoming Sessions:** Shows Registered, Pending and Waitlisted correctly, and drops sessions after removal.
- **Video player:** Watch tracking works: the watched percentage is credited only for played time, at 2× speed.
- **Posting a completion:** Posts to transcript and certificates, and turns PA green in `effStatus`.
- **Certificates:** View and print work. "Print all" produces a batch. Print paths enforce `canViewStaffMember`.

## Areas not conclusively tested
- Bunny Stream playback (offline harness), in-video gate questions, and the training-update acknowledgement flow (code read only).
- The SCORM or legacy `onlineCourses` player (no seed courses).
- Real `window.print` or PDF output on mobile (print was stubbed and only the generated DOM was captured).
- Whether PA really should be "No expiration" (the compliance-engine owner should check).
- Behavior when data hydration finishes after the user clicks Sign In (`__pendingLoginAttempt`); read in code only.
