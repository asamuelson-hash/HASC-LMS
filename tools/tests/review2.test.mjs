// Findings from the combined-build review (work/audit/review2.md), asserted via the reviewer's
// own reproduction scripts in tests/review2/.  node tests/review2.test.mjs [build]
import { execFileSync } from 'node:child_process';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review2');
const run = (f) => { try { return execFileSync('node', [path.join(dir, f), FILE], { cwd: path.join(dir, '..', '..'), encoding: 'utf8', timeout: 300000 }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const json = (s) => { const i = s.indexOf('{'); try { return JSON.parse(s.slice(i, s.lastIndexOf('}') + 1)); } catch (e) { return null; } };
const results = []; const check = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
const pr = json(run('probe.mjs')) || {};
check('R2-03a', 'reinstated void no longer moves the ART anchor', pr.P1 && pr.P1.afterReinstate === pr.P1.afterAdd && pr.P1.anchorAfterReinstate === pr.P1.anchorAfterAdd, pr.P1);
check('R2-03b', 'id-targeted void does not hide a same-date re-entry', pr.P2 && pr.P2.firstO2 === '4/6/20', pr.P2);
check('R2-02', 'training-import undo keeps credit from a same-day EMT card', pr.P3 && pr.P3.after && pr.P3.after.CPR === 'g', pr.P3);
check('R2-05', 'renamed instructor keeps access to their sessions', pr.P4 && pr.P4.visibleAfterLogin === pr.P4.accessBefore, pr.P4);
check('R2-04', 'cancelling a scheduled location rule keeps the rule in effect', pr.P5 && pr.P5.inEffectAfterCancellingScheduled === pr.P5.inEffectAfterScheduling, pr.P5);
check('R2-08', 'rule diagnostic labels a scheduled rule as scheduled', pr.P6 && /^Scheduled/.test(pr.P6.diagOverrideText || ''), pr.P6 && pr.P6.diagOverrideText);
const rs = run('restore.mjs'); const m1 = rs.match(/LEGACY RESTORE (\{.*\})/), m2 = rs.match(/AFTER RELOAD (\{.*\})/);
const a = m1 && JSON.parse(m1[1]), b = m2 && JSON.parse(m2[1]);
check('R2-01', 'legacy restore retracts credit from completions not in the restored records (and after reload)', a && a.after.st !== 'g' && b && b.st !== 'g' && b.transcript.length === 0, { a, b });
const idr = run('idor.mjs'); check('R2-06', 'certificate cannot be built from another staff member’s completion', !/April 11, 2010/.test(idr), idr.slice(-300));
const mg = run('mgr.mjs'); const h2 = mg.match(/HOME after mLoc (\{.*\})/); const hh = h2 && JSON.parse(h2[1]);
check('R2-07', 'manager Home ignores the Color Report location filter', hh && /^1950 staff/.test(hh.teamLine), hh);
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 400))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
