// Admin preview of the Staff portal is read-only.  node tests/preview.test.mjs [build]
import { boot, login } from '../harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = []; const check = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
const { browser, page, errors } = await boot(FILE); await login(page, 'admin');
const ev = (fn, arg) => page.evaluate(fn, arg); const wait = (ms = 200) => page.waitForTimeout(ms);
const state = () => ev(() => { const L = window.__hascLogic, cu = L.state.currentUser; const sid = cu && cu.staffId; let pw = null; try { pw = localStorage.getItem('hasc_staff_pw:' + sid); } catch (e) {}
  return { role: L.state.role, viewAs: !!(cu && cu.viewAs), sid, name: cu && cu.name, comps: (L.state.docs.completions || []).filter(c => String(L.completionStaffId(c)) === String(sid)).length, pw, rec: JSON.stringify((L.state.roster.find(r => String(r.id) === String(sid)) || {}).dt || {}), toast: L.state.toast && (L.state.toast.msg || L.state.toast) }; });

await ev(() => window.__hascLogic.switchRole('staff')); await wait(400);
const before = await state();
check('PV-00', 'admin is previewing the Staff portal', before.role === 'staff' && before.viewAs && before.sid, before);
const tries = await ev(() => { const L = window.__hascLogic, cu = L.state.currentUser, sid = String(cu.staffId); const out = {};
  const run = (k, f) => { try { const r = f(); out[k] = (r && r.then) ? 'async' : String(r); } catch (e) { out[k] = 'threw ' + e.message; } };
  const video = (L.SS() && L.SS().vtVideos && L.SS().vtVideos()[0]) || { id: 'x', title: 'X', compliance_code: 'CPR', version_number: 1 };
  run('vtPostCompletion', () => L.vtPostCompletion(video, sid, 100, { id: 'pc1', counts_toward_compliance: true, watched_pct: 100, date: new Date().toISOString() }));
  run('recordScormCompletion', () => L.recordScormCompletion({ id: 'sc1', code: 'CPR', title: 'S', version: 1 }, sid, {}));
  run('postOnlineCompletion', () => L.postOnlineCompletion && L.postOnlineCompletion({ id: 'oc1', code: 'CPR', title: 'O' }, sid));
  run('finishOnlineCourse', () => L.finishOnlineCourse());
  run('vtFinishVideoCourse', () => L.vtFinishVideoCourse(video.id, sid));
  run('vtSubmitQuiz', () => L.vtSubmitQuiz(video.id, sid));
  run('vtGateSubmit', () => L.vtGateSubmit(video.id, sid));
  run('cpSimWatch', () => L.cpSimWatch());
  run('openCoursePlayer', () => L.openCoursePlayer('any'));
  run('vtOpen', () => L.vtOpen(video.id, sid));
  run('playVideoCourse', () => L.playVideoCourse(video.id, sid));
  L.setState({ pwSetup: { staffId: sid, name: cu.name }, pwNew1: 'NewPass123', pwNew2: 'NewPass123' }); run('savePwSetup', () => L.savePwSetup());
  return out; });
await wait(400);
const after = await state();
const opened = await ev(() => { const L = window.__hascLogic; return { vtPlayId: L.state.vtPlayId || null, coursePlayerId: L.state.coursePlayerId || null }; });
check('PV-01', 'no completion, roster date or password written to the previewed employee', after.comps === before.comps && after.rec === before.rec && !after.pw, { before, after, tries });
check('PV-02', 'no course/video player opened during preview', !opened.vtPlayId && !opened.coursePlayerId, opened);
check('PV-03', 'admin is told the preview is read-only', /read-only/i.test(JSON.stringify(after.toast || '')), after.toast);
const banner = await ev(() => document.body.innerText.match(/Admin preview[^\n]*/)?.[0] || '');
check('PV-04', 'preview banner states read-only', /Read-only/.test(banner), banner);

// A real staff sign-in is not affected by the guard.
await ev(() => window.__hascLogic.switchRole('admin')); await wait(300);
await ev(() => window.__hascLogic.logout()); await wait(300);
await login(page, 'staff');
const real = await ev(() => { const L = window.__hascLogic; return { ro: L.staffPreviewReadOnly ? L.staffPreviewReadOnly() : false, role: L.state.role }; });
check('PV-05', 'guard is off for a real staff sign-in', real.role === 'staff' && real.ro === false, real);

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e)); check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 600))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
