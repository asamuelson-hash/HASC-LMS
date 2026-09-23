#!/usr/bin/env python3
"""Regenerate work/ISSUE_LEDGER.md from the audit reports + the status table below."""
import re, glob, collections
SEV_FIX = {'MGR-01': 'Critical', 'UX-01': 'High'}
# Duplicates: same defect reported by several auditors -> canonical ID
DUP = {'CRT-01': 'CMP-02', 'CRT-04': 'CMP-04', 'MGR-01': 'CMP-05', 'UX-02': 'CMP-05', 'SCH-05': 'CMP-03',
       'QA-01': 'CMP-06', 'IMP-01': 'CMP-06', 'ADM-10': 'CMP-09', 'CRT-11': 'CMP-09', 'ADM-03': 'ADM-03',
       'MGR-05': 'SEC-03', 'STF-04': 'SEC-04', 'UX-09': 'MGR-10', 'UX-04': 'UX-04', 'ADM-13': 'QA-02', 'STF-03': 'CRT-05',
       'QA-07': 'IMP-12', 'UX-01': 'STF-01', 'ADM-12': 'CMP-13'}
# id -> (owner, status, fix, verification)
S = {}
def st(ids, owner, status, fix='', ver=''):
    for i in ids.split(): S[i] = (owner, status, fix, ver)
L1 = 'Lead (batch 1)'
st('CMP-02 CRT-01', L1, 'Fixed (verified)', 'Single replay: only latest completion drives date/expiry; recordCompletion post-map removed', 'compliance.test CMP-02 + RELOAD (baseline FAIL → PASS)')
st('CMP-03 SCH-05', L1, 'Fixed (verified)', 'Replay clears override when winning completion has none; certify routes through replay', 'compliance.test CMP-03a/b, SCH-05')
st('CMP-04 CRT-04', L1, 'Fixed (verified) — compliance part', 'Replay applies satisfiedRequirements; compound codes split; ext-cert writers store primary code. Transcript/partial-void display → W2', 'compliance.test CMP-04a + RELOAD')
st('CMP-01', L1, 'Fixed (verified)', 'Required-but-missing → due/overdue from hire + due window (policy 2026-09-22); legacy toggle; ruleDiagnostic text', 'compliance.test CMP-01a/b/c; agency 85.4% → 77.2%')
st('CMP-05 MGR-01 UX-02', L1, 'Fixed (verified)', 'Manager KPIs/staff cards/Register note from effStatus', 'rules.test MGR-01 (0 shown vs 233 → match)')
st('CMP-06 IMP-01 IMP-02 IMP-03 QA-01', L1, 'Fixed (verified)', 'Strict parseMDY/importDate; completionDateError on all manual entry paths + import rows', 'compliance.test CMP-06a/b; rules.test IMP-01a/b, QA-01')
st('ADM-01', L1, 'Fixed (verified)', 'Catalog merge never copies interval/audience onto built-in codes', 'rules.test ADM-01/01b')
st('ADM-03', L1, 'Fixed (code)', 'Compliance memo deps include courseInfo, complianceRules, customCourses, onlineCourses, day', 'covered by W4 CRT-08 preview test')
st('VOID-01', L1, 'Fixed (verified)', 'Void falls back to preserved imported date (baseDt / Sept-15 reference) instead of deleting', 'compliance.test VOID-01')
W1='W1 scheduling'; W2='W2 certs'; W3='W3 security'; W4='W4 admin/import'; W5='W5 surfaces'
FV='Fixed (verified)'
st('SCH-01', W1, FV, 'parseSessionDate reads ISO dates as local calendar days (sessionDateObj/parseSessionStart/edit compare)', 'scheduling.test (America/New_York) 1/20 → 20/20')
st('SCH-02 SCH-03 SCH-04 SCH-09 SCH-12', W1, FV, 'Calendar header month detection; trailing AM/PM; trailing At/Via location; multi-day entries flagged', 'scheduling.test')
st('SCH-06', W1, FV, 'Re-publish keeps admin edits, never resurrects cancelled rows; Changes-to-review box', 'scheduling.test')
st('SCH-07 SCH-08 SCH-11', W1, FV, 'Admin-only cancel (not certified/past); certified date edits blocked, request snapshots refreshed; roster result synced on correction', 'scheduling.test')
st('SCH-10', W1, 'Fixed (verified) — partial', 'Waitlist promotion on capacity increase; overlapping same-course double booking blocked. Promotion on request denial not done', 'scheduling.test')
st('CRT-02 CRT-03 CRT-05 STF-03 CRT-06 CRT-07 CRT-09 CRT-10 CRT-12', W2, FV, 'Per-row expiry; id-targeted voids; resolveCompletion + stable certIdFor; retakes appended; certHistory; certificateBlockReason; append-only reinstatement', 'certs.test 1/15 → 15/15')
st('CMP-08', W2, 'Fixed (verified) — policy: EPP stays one-time', 'isOneTime(): admin-configured renewal consulted before one NOEXP list', 'certs.test')
st('CMP-09 ADM-10 CRT-11 CMP-10', W2, FV, 'addIntervalDate shared by status and display; expiryIntervalDays honours location overrides', 'certs.test')
st('SEC-01 SEC-02 SEC-03 MGR-05 SEC-05 SEC-08 SEC-09', W3, FV, 'Per-user state reset; hop keeps real admin + audited; inactive managers refused; pwSetup bound; URL allow-list; import guards', 'security.test 1/18 → 18/18')
st('MGR-02 MGR-12', W3, 'Fixed (verified) — policy: locations + reporting chain', 'HASCPolicy uses the app scope resolver; header states the rule', 'security.test (policy 1075 = app 1075)')
st('MGR-03 MGR-04 MGR-09 MGR-10 UX-09 MGR-14 MGR-15 STF-05', W3, FV, 'Directory drives scope + rename alias; print-all exact set; ambiguous email refused; Deny hidden; scope fixes; cert view guard', 'security.test')
st('ADM-02 ADM-04 ADM-05 ADM-06 ADM-08', W4, FV, 'Scheduled location rules; validated full backup/restore with pre-restore undo; instructor rename carries sessions; flush on pagehide; archive confirmation', 'admin_import.test 1/26 → 26/26')
st('CRT-08', W4, 'Fixed (verified) — policy: apply to all with preview', 'Impact preview (N staff change / X overdue) + audit entry before saving a renewal change', 'admin_import.test')
st('IMP-05 IMP-06 IMP-07 IMP-09 IMP-10 IMP-11 IMP-12 QA-07 IMP-13', W4, FV, '70% coverage + typed confirm; supervisors/emails kept; scoped undo; leading-zero IDs; 1904 dates; Needs-review codes; batch undo; re-check dupes', 'admin_import.test')
st('CMP-07', W5, FV, 'Initial ART anchors on first completion of each pathway code', 'surfaces.test 1/19 → 19/19')
st('CMP-11 CMP-14 UX-05', W5, FV, 'complianceSummary() shared by every % surface; info/na excluded; upcoming = today+; Staff fully compliant KPI', 'surfaces.test')
st('STF-01 UX-01 STF-02 STF-06 STF-07', W5, FV, 'My required trainings list with working actions; quiz never reveals answers; dedup videos; signature must match name', 'surfaces.test')
st('UX-03 UX-04 MGR-06 MGR-07 MGR-11', W5, FV, 'Manager Out-of-compliance card; Register sorts needs first; scoped video tiles/filters; capped lists say so', 'surfaces.test')
st('QA-02 ADM-13 QA-03 QA-04 QA-05 QA-08', W5, FV, 'In-app QA suite restored (22 checks); void modal session; KPI caption; archived Set; duplicate key', 'surfaces.test')
st('IMP-04', L1, FV, 'Expiry years >= 2051 import as No expiration; computed expiries not overrides', 'review1.test IMP-04')
st('UX-11', 'Lead', FV, 'Phone: wrapping tabs, compact header, instructor cards with Pass/Fail, transcript fits', 'phone.test 2/5 → 5/5')
st('IMP-08', 'W6 persistence', 'Fixed (verified)', 'Three-way merge inside one IndexedDB transaction for operational state and docs; revision markers; import/undo re-apply at commit; audit ids; restore = replace; re-sync on pageshow/visible', 'crosstab.test 25/31 → 31/31 (5/5 runs); review3.test 4/4; independent re-review: no data-loss regression vs baseline after RR-01 fix')
st('SEC-04 STF-04 SEC-06 SEC-10 CMP-15', 'Architecture', "Deferred — needs server auth", 'Inherent to browser-only prototype; requires Supabase Auth/RLS (SUPABASE_MIGRATION.md)', '')
st('QA-06', 'Ops/data', 'Deferred — data', 'All seeded sessions are past; load the real upcoming calendar', '')

rows = []
for f in sorted(glob.glob('work/audit/*.md')):
    if 'review' in f: continue
    txt = open(f).read()
    for p in re.split(r'\n(?=#{2,3} (?:\*\*)?[A-Z]{2,3}-\d+)', txt)[1:]:
        head = p.split('\n', 1)[0]
        m = re.match(r'#{2,3} (?:\*\*)?([A-Z]{2,3}-\d+)\W*(.*)', head); iid, title = m.group(1), m.group(2)
        sev = SEV_FIX.get(iid)
        if not sev:
            for s in ['Critical', 'High', 'Medium', 'Low']:
                if re.search(r'\b' + s + r'\b', head): sev = s; break
        if not sev:
            mm = re.search(r'\*\*(Critical|High|Medium|Low)', p[:1500]) or re.search(r'Severity:?\**\s*(Critical|High|Medium|Low)', p[:1500]) or re.search(r'\b(Critical|High|Medium|Low)\b', p[:800]); sev = mm.group(1) if mm else '?'
        title = re.sub(r'\*\*.*$', '', title).strip(' ·—-*:'); title = re.sub(r'\s+[·—-]\s+(Critical|High|Medium|Low).*$', '', title)
        owner, status, fix, ver = S.get(iid, ('—', 'Open', '', ''))
        dup = DUP.get(iid); 
        if dup and dup != iid: title += f' _(same defect as {dup})_'
        rows.append((iid, title.replace('|', '/')[:150], sev, owner, status, fix, ver))
order = {'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3, '?': 4}
rows.sort(key=lambda r: (order[r[2]], r[0]))
rows.append(('R2-01..09','Combined-build review (work/audit/review2.md): legacy restore credit, import-undo voids, void-aware ART anchor, scheduled-rule cancel, instructor rename access, cert id check, manager filter, diagnostic, reinstatement guard','High','Lead','Fixed (verified)','Commits 18ff44d, fe059b5','review2.test 0/9 → 9/9'))
rows.append(('QA2-01..05','QA regression sweep 2 (work/audit/qa2.md): no functional regressions; follow-ups','Low','Lead','Fixed (verified) — 01, 04, 05; 02 (22 of 56 in-app checks) and 03 (report print freeze, pre-existing) open','Commit 0c9bbc4','runtime checks + all suites'))
rows.append(('R3-01..06, RR-01','Independent reviews of the IMP-08 persistence change (work/audit/review3.md): import could delete another tab’s completions; audit-log duplication on restore; unload flush abort; stale-tab overwrite; cross-tab deletes not honoured','Critical','W6 + Lead','Fixed (verified)','Commits 30b2a02 (W6) and the RR-01 deletion-inference fix (lead)','crosstab.test 31/31; review3.test 4/4 (RR-01 fails on the pre-fix build 2/2)'))
rows.append(('PV-01','Admin preview of the Staff portal could write to the real employee record (user request)','High','Lead','Fixed (verified)','staffPreviewReadOnly guard on all entry points and final writers; banner says read-only','preview.test 3/7 → 7/7'))
rows.append(('R1-01..14','Independent review of batch 1 (work/audit/review1.md)','Medium','Lead','Fixed (verified) — 01,02,04,06,07,08,09,11; 10/05 via W2; 03 via W4 ADM-02; 12,13,14 Low deferred','See commit 9cff283','review1.test'))
c = collections.Counter(r[2] for r in rows); cs = collections.Counter((r[2], r[4].split(' ')[0]) for r in rows)
out = ['# HASC LMS — Issue Ledger (production-readiness review, 2026-09-22)', '',
       'Baseline: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html`. Regenerate with `python3 tools/ledger.py`.',
       'Full evidence, root cause, fix and test plan for each ID: `work/audit/<area>.md`.', '',
       f"**{len(rows)} findings** — " + ', '.join(f'{k}: {c[k]}' for k in ['Critical', 'High', 'Medium', 'Low']), '',
       '| ID | Description | Sev | Owner | Status | Fix implemented | Verification |', '|---|---|---|---|---|---|---|']
out += ['| ' + ' | '.join(r) + ' |' for r in rows]
open('work/ISSUE_LEDGER.md', 'w').write('\n'.join(out) + '\n')
print(len(rows), dict(c)); print({k: v for k, v in cs.items()})
