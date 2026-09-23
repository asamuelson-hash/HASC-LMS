# HASC LMS — builder brief (implementation batch 2)

You are a builder working in an ISOLATED GIT WORKTREE (your cwd). Paths below are relative to
your worktree root unless absolute. Read `work/AGENT_BRIEF.md` for the system overview, and the
audit reports in `work/audit/*.md` for the full detail of the findings you own.

## Source of truth and build
- Edit ONLY `work/template.html` (the extracted app). Never edit the .html bundles.
- Build: `python3 tools/bundle.py build HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html work/template.html work/out_fix.html`
- Baseline build for reproducing bugs: `/home/user/HASC-LMS/work/out.html` (unmodified original).
- Harness: import from the MAIN repo so playwright resolves:
  `import { boot, login, tab } from '/home/user/HASC-LMS/tools/harness.mjs';`
  and pass YOUR build's absolute path to boot(). Run node scripts from `/home/user/HASC-LMS/tools`
  (e.g. `cd /home/user/HASC-LMS/tools && node <your-worktree>/tools/tests/x.test.mjs <your-worktree>/work/out_fix.html`).
- Existing suites that must keep passing on your build:
  `node <wt>/tools/tests/compliance.test.mjs <wt>/work/out_fix.html` and `rules.test.mjs`.
- The app has no demo clock: "today" is the real date (2026-09-22). For timezone bugs, create a
  browser context with `timezoneId:'America/New_York'` (see work/scratch/scheduling/h.mjs in the
  main repo for an example) — HASC is in New York.

## Rules (from the lead architect)
- Before changing a feature, establish its current behavior (reproduce the bug on the baseline).
- Preserve all working functionality. No feature deletion, no broad rewrites; targeted fixes.
- Backward compatible with existing stored data (staff, completions, sessions, certificates,
  config). Never silently discard imported or historical data.
- Business rules belong in admin-configurable settings where practical; don't add new hard-coding.
- Match surrounding code style (dense one-line methods are normal here); keep comments sparse
  and about *why*.
- The lead already changed: applyCompletionsToRoster / applyVoidsToRoster (single replay),
  effStatus + initialDueInfo (missing-required policy), parseMDY (strict), importDate (strict),
  completionDateError/isFutureDate, _mgrMatrixView KPIs, staffStatus, catalog merge (ADM-01).
  Build on these; don't revert them. Do NOT touch functions owned by another builder (listed in
  your task) — if a fix needs one, describe it in your report instead.
- Add a test file `tools/tests/<area>.test.mjs` (same style as compliance.test.mjs: PASS/FAIL
  lines + exit code) whose checks FAIL on the baseline and PASS on your build. Run it both ways.
- Commit your work on your worktree branch with a clear message (end the message with the two
  trailer lines below). Do not push.
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_015agHCfeQaHkzjjwWbootyT
- If a finding turns out not to be real, or needs a policy decision, skip it and say so.

## Report
Final message (≤ 40 lines): your branch name + commit hash, each finding ID → fixed / skipped
(why), what you verified at runtime (baseline FAIL → build PASS), and any risk the reviewer
should look at.
