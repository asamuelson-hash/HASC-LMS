# HASC LMS audit — shared brief for all agents

## The system
HASC Center LMS: a single-file, self-unpacking HTML app (staff training/compliance LMS for a
human-services agency; ~4,053 staff, ~77 sessions, 4 portals: Staff, Manager, Instructor, Admin).

- Current build (baseline, DO NOT EDIT): `/home/user/HASC-LMS/HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html`
- Extracted app document (what you read/grep): `/home/user/HASC-LMS/work/template.html` (~17k lines).
  - Lines ~33/38: embedded roster + data (huge single lines — never print them whole; use `cut -c1-300`).
  - The main app is a `class Component extends DCLogic { ... }` inside `<script type="text/x-dc">`
    starting around line 7150; the x-dc HTML template (views/bindings) is above it (~line 1790-7150).
    Other `<script>` blocks hold services: HASC_CONFIG, HASCAuth, HASCIdentity, HASCSession,
    HASCPolicy, HASCRepo, LMSDataService, HASCStore, compliance engine, etc.
  - Portal tabs: `NAV_BY_ROLE` (~line 7348). Router: `go(tab)`.
- Prior audit context (older build): `/home/user/HASC-LMS/AUDIT_REPORT.md`, `SUPABASE_MIGRATION.md`.
  Some fixes there may have regressed in this newer build — check.

## Rules
- **READ-ONLY on work/template.html and the bundle.** Do not modify them. The lead architect
  applies fixes. Put any scratch scripts/files in `/home/user/HASC-LMS/work/scratch/<your-area>/`.
- Inspect the actual implementation. Don't speculate from labels. Trace input → processing →
  stored state → UI/output. Verify behavior at runtime with the harness whenever practical.
- Today's date is 2026-09-22 (check whether the app uses a fixed "demo clock"; note it).

## Runtime harness (headless Chromium, offline, fresh profile per boot)
`/home/user/HASC-LMS/work/out.html` is an unmodified build of the baseline.
```js
// save as /home/user/HASC-LMS/work/scratch/<area>/x.mjs, run with:
//   cd /home/user/HASC-LMS/tools && node ../work/scratch/<area>/x.mjs
import { boot, login, tab } from '/home/user/HASC-LMS/tools/harness.mjs';
const { browser, page, errors } = await boot('/home/user/HASC-LMS/work/out.html');
await login(page, 'admin');   // 'manager' | 'instructor' | 'staff'; or login(page,'staff',{email,name,roleLabel:'Staff',staffId:'123'})
await tab(page, 'admin', 'records');       // switch tab (keys from NAV_BY_ROLE)
const r = await page.evaluate(() => { const L = window.__hascLogic; /* component instance: L.state, L.<methods>() */ return L.state.roster.length; });
console.log(r, errors.filter(e=>!e.includes('permissions policy')));
await browser.close();
```
`window.__hascLogic` is the live Component instance (call methods, read state, setState).
You can also click real UI via Playwright (`page.getByText(...)`, `page.click(...)`), read
`document.body.innerText`, and screenshot to `/home/user/HASC-LMS/work/shots/`.
Boot takes ~3 s. Keep scripts focused.

## Report format
Write your findings to `/home/user/HASC-LMS/work/audit/<your-area>.md`. For each issue:
- **ID** (prefix given in your task, e.g. CMP-01), **Title**
- Portal/module · File location (template.html line numbers + function names)
- Current behavior (with evidence: code excerpt and/or runtime result)
- Expected behavior
- Severity: Critical / High / Medium / Low (Critical = wrong compliance determinations, data
  loss/corruption, security/permission failure; silent incorrect results rank high)
- Likely root cause
- Recommended fix (concrete: which function, what change)
- Regression risk
- How to test the fix
Also mark each finding **VERIFIED-RUNTIME**, **VERIFIED-CODE** (traced, certain), or
**SUSPECTED**. Order most severe first. Finish with a short "areas not conclusively tested"
list. Quality over quantity: no padding, no duplicate issues, no style nitpicks unless UX is
your area. Your final message back should be a compact summary (top issues with IDs and
severity, ≤ 40 lines) — the full detail lives in the file.
