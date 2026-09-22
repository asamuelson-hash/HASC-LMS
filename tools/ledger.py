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
for i in 'SCH-01 SCH-02 SCH-03 SCH-04 SCH-06 SCH-07 SCH-08 SCH-09 SCH-10 SCH-11'.split(): S.setdefault(i,(W1,'In progress','',''))
for i in 'CRT-02 CRT-03 CRT-05 CRT-06 CRT-07 CRT-09 CRT-10 CRT-12 CMP-08 CMP-09 CMP-10 ADM-10 CRT-11 STF-03'.split(): S.setdefault(i,(W2,'In progress','',''))
for i in 'SEC-01 SEC-02 SEC-03 MGR-05 SEC-05 SEC-08 SEC-09 MGR-02 MGR-03 MGR-04 MGR-09 MGR-10 UX-09 MGR-12 MGR-14 MGR-15 STF-05'.split(): S.setdefault(i,(W3,'In progress','',''))
for i in 'ADM-02 ADM-04 ADM-05 ADM-06 ADM-08 CRT-08 IMP-05 IMP-06 IMP-07 IMP-09 IMP-10 IMP-11 IMP-12 QA-07 IMP-13'.split(): S.setdefault(i,(W4,'In progress','',''))
for i in 'CMP-07 CMP-11 CMP-14 UX-05 STF-01 UX-01 STF-02 STF-06 STF-07 UX-03 UX-04 MGR-06 MGR-07 MGR-11 QA-05 QA-03 QA-04 QA-08 QA-02 ADM-13'.split(): S.setdefault(i,(W5,'In progress','',''))
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
c = collections.Counter(r[2] for r in rows); cs = collections.Counter((r[2], r[4].split(' ')[0]) for r in rows)
out = ['# HASC LMS — Issue Ledger (production-readiness review, 2026-09-22)', '',
       'Baseline: `HASC_LMS_v5_ATTENDANCE_DESCRIPTIONS_2026-09-22.html`. Regenerate with `python3 tools/ledger.py`.',
       'Full evidence, root cause, fix and test plan for each ID: `work/audit/<area>.md`.', '',
       f"**{len(rows)} findings** — " + ', '.join(f'{k}: {c[k]}' for k in ['Critical', 'High', 'Medium', 'Low']), '',
       '| ID | Description | Sev | Owner | Status | Fix implemented | Verification |', '|---|---|---|---|---|---|---|']
out += ['| ' + ' | '.join(r) + ' |' for r in rows]
open('work/ISSUE_LEDGER.md', 'w').write('\n'.join(out) + '\n')
print(len(rows), dict(c)); print({k: v for k, v in cs.items()})
