import { boot, login } from '/home/user/HASC-LMS/tools/harness.mjs';
const { browser, page, errors } = await boot((process.argv[2]||'/home/user/HASC-LMS/work/out_fix.html'));
await login(page, 'admin');
const ev = (fn, a) => page.evaluate(fn, a);
const r = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const A = L._activeRosterMemo().find(s => L.requiredFor(s, 'CPR') && L.effStatus(s, 'CPR') === 'r'); const id = A.id; const dt0 = A.dt.CPR;
  const legacy = JSON.parse(JSON.stringify(L.state.docs)); // what a baseline "Export records" produced (bare docs)
  const k = (L.sessionCourses().find(c => c.code === 'CPR' && /PERSON/i.test(c.key)) || L.sessionCourses().find(c => c.code === 'CPR')).key;
  L.setState({ admStaff: id, compCourse: k, compDate: '9/1/26', compExp: '', compExpManual: false, compNote: 'after export' }); await sl(50); L.recordCompletion(); await sl(150);
  const mid = { dt: L.staffById(id).dt.CPR, st: L.effStatus(L.staffById(id), 'CPR') };
  const plan = L.backupRestorePlan(legacy); if (plan.error) return { err: plan.error };
  await L.applyBackupRestore(plan, 'legacy.json'); await sl(300);
  const st = L.staffById(id); const hasComp = (L.state.docs.completions || []).some(c => String(c.staffId) === String(id) && c.date === '9/1/26');
  return { id, dt0, mid, after: { dt: st.dt.CPR, st: L.effStatus(st, 'CPR') }, completionStillInDocs: hasComp, kind: plan.kind };
});
console.log('LEGACY RESTORE', JSON.stringify(r));
// reload: does the stale roster date persist?
await page.waitForTimeout(1500); await page.reload(); await page.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 }); await login(page, 'admin');
const r2 = await ev(([id]) => { const L = window.__hascLogic; const st = L.staffById(id); return { dt: st.dt.CPR, st: L.effStatus(st, 'CPR'), transcript: L.buildTranscript(st).filter(x => x.code === 'CPR').map(x => x.completed) }; }, [r.id]);
console.log('AFTER RELOAD', JSON.stringify(r2));
console.log('ERRORS', errors.filter(e => !/permissions policy|ERR_FAILED/.test(e)).slice(0, 8));
await browser.close();
