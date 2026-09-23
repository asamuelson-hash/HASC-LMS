// Compliance surfaces / Staff Portal / manager screens regression suite (builder W5).
// Usage (from tools/):  node tests/surfaces.test.mjs [build.html]
// Each check drives the app through its own write paths or rendered screens and asserts the outcome.
import { boot, login, tab } from '../harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };
const { browser, page, errors } = await boot(FILE);
const warns = [];
page.on('console', m => { if (/never resolved/.test(m.text())) warns.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 200) => page.waitForTimeout(ms);
const main = async () => (await ev(() => (document.querySelector('#hasc-main-content') || document.body).innerText)).replace(/\s+/g, ' ');
const safe = async (id, name, fn) => { try { await fn(); } catch (e) { check(id, name, false, 'threw: ' + String(e && e.message || e).slice(0, 300)); } };
const kpi = (label) => ev(label => { const el = [...document.querySelectorAll('div')].find(d => d.children.length === 0 && d.textContent.trim().toLowerCase() === label.toLowerCase()); return el && el.previousElementSibling ? el.previousElementSibling.textContent.trim() : null; }, label);
const FUTURE = { date: 'Mon, Oct 5, 2026', when: 'Mon, Oct 5, 2026 · 9:00 AM–12:00 PM' };

await login(page, 'admin');

// CMP-07: a refresher orientation must not push the initial ART due date out.
await safe('CMP-07', 'refresher SDCH 1 leaves initial ART status and due date unchanged', async () => {
  const snap = () => ev(() => { const L = window.__hascLogic; const s = L.staffById('20379'); const x = L.artInitialDueInfo(s); return { st: L.effStatus(s, 'ART'), due: x.dueMDY || '', sdch1: s.dt.SDCH1 }; });
  const pre = await snap();
  await ev(() => { const L = window.__hascLogic; L.setState({ admStaff: '20379', compCourse: 'SDCH1', compDate: '9/20/26', compExp: '', compExpManual: false, compNote: 'refresher' }); }); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait(400);
  const post = await snap();
  check('CMP-07', 'refresher SDCH 1 leaves initial ART status and due date unchanged', post.sdch1 === '9/20/26' && pre.st === 'o' && post.st === pre.st && post.due === pre.due, { pre, post });
});

// CMP-11 / CMP-14: every % surface uses one aggregation that excludes info/na and includes location-added codes.
await safe('CMP-11', 'dashboard, rankings and records % equal a hand count that excludes info/N/A', async () => {
  const r = await ev(() => { const L = window.__hascLogic; const sys = L.systemAccountSet();
    const act = L.state.roster.filter(x => !sys.has(String(x.id)) && L.isActiveStaff(x));
    const count = (list) => { let met = 0, tot = 0, ok = 0; list.forEach(st => { let red = false; [...new Set(L.MATRIX_COLS.concat(L.locAddedCodesFor(st) || []))].forEach(c => { if (L.locReqSuppressed(st, c)) return; const l = L.effStatus(st, c); if (l === 'r') { tot++; red = true; } else if (['g', 'y', 'o', 'w'].includes(l)) { tot++; met++; } }); if (!red) ok++; }); return { met, tot, pct: tot ? Math.round(met / tot * 100) : 0, ok }; };
    const all = count(act); const agg = L._agencyAgg(L.MATRIX_COLS); const rank = L._locationPerformanceAgg();
    const rv = L._recordsView(L.MATRIX_COLS, '', '', 0, 50); const recs = count(L._activeRosterMemo());
    return { hand: all, agg: { tot: agg.aTotalCells, met: agg.aGreenCells, staffPct: agg.aStaffPct }, rankPct: rank.agencyPct, rankStaff: rank.activeStaff, act: act.length, recPct: rv.aPctFiltered, recHand: recs.pct, staffPctHand: act.length ? Math.round(all.ok / act.length * 100) : 0 }; });
  check('CMP-11', 'dashboard, rankings and records % equal a hand count that excludes info/N/A', r.agg.tot === r.hand.tot && r.agg.met === r.hand.met && r.rankPct === r.hand.pct && r.rankStaff === r.act && r.recPct === r.recHand, r);
  check('UX-05a', 'dashboard "staff fully compliant" = share of active staff with no overdue item', r.agg.staffPct === r.staffPctHand, r);
});

// UX-05: upcoming sessions count only future sessions; one active-staff count; staff-compliant KPI shown.
await safe('UX-05b', 'dashboard upcoming sessions and active staff counts', async () => {
  await ev(f => { const L = window.__hascLogic; L.setState({ sessions: [...L.state.sessions, { id: 'tst_future', code: 'CPR', title: 'CPR In Person', date: f.date, when: f.when, where: 'East 14th Street', instructor: 'Sara Schwedelson', capacity: 10, roster: [], certified: false, att: {}, pass: {} }] }); }, FUTURE); await wait();
  await tab(page, 'admin', 'dash'); await wait(400);
  const expected = await ev(() => { const L = window.__hascLogic; const t = new Date(); t.setHours(0, 0, 0, 0); return { up: L.state.sessions.filter(s => { const d = new Date(s.date); return !isNaN(d) && d >= t; }).length, act: L._locationPerformanceAgg().activeStaff }; });
  const up = await kpi('Upcoming sessions'), staff = await kpi('Active staff'), pctStaff = await kpi('Staff fully compliant');
  const txt = await main(); const m = txt.match(/([\d,]+) staff match/);
  check('UX-05b', 'upcoming sessions = sessions dated today or later; one active-staff count; staff-compliant KPI shown', up === String(expected.up) && staff === expected.act.toLocaleString() && !!pctStaff && m && m[1] === expected.act.toLocaleString(), { up, staff, pctStaff, widget: m && m[1], expected });
});

// QA-04: Reports KPI caption.
await safe('QA-04', 'Reports KPI caption renders', async () => {
  await tab(page, 'admin', 'reports'); await wait(600);
  check('QA-04', 'Reports KPI caption renders', /Active staff in scope/i.test(await main()), '');
});

// QA-03: Void modal related session label.
await safe('QA-03', 'Void modal shows a related-session value', async () => {
  const w0 = warns.length;
  await ev(() => { const L = window.__hascLogic; const rec = L.buildCompletionRecords().find(r => !r.voided); L.openVoidModal(rec.key); }); await wait(400);
  const v = await ev(() => { const el = [...document.querySelectorAll('div')].find(d => d.textContent.trim() === 'Related session'); return el && el.nextElementSibling ? el.nextElementSibling.textContent.trim() : null; });
  check('QA-03', 'Void modal shows a related-session value', !!v && !warns.slice(w0).some(x => /sessLabel/.test(x)), { v, warns: warns.slice(w0) });
  await ev(() => window.__hascLogic.closeModal()); await wait();
});

// QA-05: archived lookup is a memoized Set.
await safe('QA-05', 'active-roster filter is fast (memoized archived set)', async () => {
  const ms = await ev(() => { const L = window.__hascLogic; const ts = []; for (let i = 0; i < 3; i++) { const t = performance.now(); L.state.roster.filter(r => L.isActiveStaff(r)); ts.push(performance.now() - t); } return ts.sort((a, b) => a - b)[1]; });
  check('QA-05', 'active-roster filter is fast (memoized archived set)', ms < 20, ms.toFixed(1) + ' ms');
});

// QA-02: real in-app QA suite.
await safe('QA-02', 'in-app QA suite runs real outcome checks and all pass', async () => {
  const r = await ev(() => { const L = window.__hascLogic; const x = L.qaResults(); return { n: x.length, fail: x.filter(t => t.badge !== 'PASS').map(t => t.name + ': ' + t.actual) }; });
  check('QA-02', 'in-app QA suite runs real outcome checks and all pass', r.n >= 15 && r.fail.length === 0, r);
});

// Video fixture: one PA video with a one-question final quiz, assigned to 16796 and one other staff member.
const fx = await ev(async () => { const L = window.__hascLogic; const w = ms => new Promise(r => setTimeout(r, ms));
  const sr = 8000, n = sr * 12; const buf = new ArrayBuffer(44 + n * 2); const dv = new DataView(buf); const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true);
  await L._vtPutBlob('k1', new Blob([buf], { type: 'audio/wav' }));
  L.vtStartCreate(); await w(50);
  L.setState({ vtForm: { ...L.state.vtForm, title: 'PA Refresher Video', source_kind: 'local', localKey: 'k1', localName: 'x.wav', localMb: 0.2, compliance_code: 'PA', counts_toward_compliance: true, issue_certificate: true, add_to_transcript: true, classification: 'Mandatory', max_playback_rate: 4, questions: [{ q: 'What is 2+2?', opts: ['3', '4'], answer: 1, at: null, required: true }] } }); await w(50);
  L.vtSaveForm(); await w(100);
  const v = L.SS().vtVideos().find(x => x.title === 'PA Refresher Video');
  const me = L.staffById('16796');
  const D = window.HASC_DATA || {}; const mgr = (D.managers || []).find(m => L.managerAuthorizedRoster({ role: 'manager', empId: m.empId, name: m.name, email: m.email, assignedLocations: m.locations || [] }).some(r => String(r.id) === '16796'));
  const mcu = mgr ? { email: mgr.email, name: mgr.name, roleLabel: 'Manager', empId: mgr.empId, assignedLocations: mgr.locations || [] } : null;
  const other = mcu ? L.managerAuthorizedRoster({ role: 'manager', ...mcu }).find(r => String(r.id) !== '16796' && L.isActiveStaff(r)) : null;
  const outside = L.state.roster.find(r => L.isActiveStaff(r) && mcu && !L.managerAuthorizedRoster({ role: 'manager', ...mcu }).some(x => x.id === r.id));
  L.SS().vtAssign(v.id, [me, other, outside].filter(Boolean), { due: '2026-09-01', targetKind: 'staff', targetLabel: 'test' }, 'Admin'); await w(100);
  if (other) L.SS().vtAddWatch(v.id, String(other.id), [[0, 5]], 12);
  return { vid: v.id, mcu, other: other && String(other.id), outside: outside && String(outside.id) }; });

// Staff portal as Melana Matatov (16796).
await ev(() => window.__hascLogic.logout()); await wait();
await login(page, 'staff', { email: '16796@staff.hasccenter.org', name: 'Matatov, Melana', roleLabel: 'Staff', staffId: '16796' });
await tab(page, 'staff', 'trainings'); await wait(400);

await safe('STF-01', 'My Trainings lists required trainings with status, overdue first, with a summary', async () => {
  const exp = await ev(() => { const L = window.__hascLogic; const s = L.staffById('16796'); const req = L.buildStaffCourses(s).filter(c => L.requiredFor(s, c.code)); return { over: req.filter(c => L.effStatus(s, c.code) === 'r').map(c => c.name), total: req.length }; });
  const txt = await main();
  const m = txt.match(/You have (\d+) overdue training/);
  const firstOver = exp.over.length ? txt.indexOf(exp.over[0]) : -1, firstCurrent = txt.indexOf(' Current ');
  check('STF-01', 'My Trainings lists required trainings with status, overdue first, with a summary', m && +m[1] === exp.over.length && exp.over.every(n => txt.includes(n)) && firstOver > 0 && (firstCurrent < 0 || firstOver < firstCurrent) && /Overdue/.test(txt), { m: m && m[0], exp });
  await page.getByRole('button', { name: 'Find a session' }).first().click(); await wait(200);
  const toast = await ev(() => window.__hascLogic.state.toast || '');
  check('STF-01b', 'the next-step button on an overdue in-person training does something real', /manager/i.test(toast), toast);
});

await safe('STF-06', 'assigned video appears once on My Trainings', async () => {
  const txt = await main(); const n = (txt.match(/PA Refresher Video/g) || []).length;
  check('STF-06', 'assigned video appears once on My Trainings', n === 1, n);
});

await safe('STF-02', 'failed quiz reveals no answers, cannot continue without a recorded pass, and offers a retake', async () => {
  await ev(v => window.__hascLogic.playVideoCourse(v, '16796'), fx.vid); await wait(800);
  const qi = await ev(() => { const L = window.__hascLogic; const i = L.state.vtCourse.modules.findIndex(m => m.type === 'quiz'); L.setState({ cpStep: i, cpQuizAns: {}, cpQuizShown: false }); return i; }); await wait(300);
  const opt = (t) => page.locator('button', { hasText: new RegExp('^' + t + '$') }).last();
  const cont = page.locator('button', { hasText: /^Continue$/ }).last();
  await opt('3').click(); await wait(100); await page.getByRole('button', { name: 'Submit quiz' }).click(); await wait(300);
  const leak = await ev(() => [...document.querySelectorAll('button')].filter(b => ['3', '4'].includes(b.innerText.trim())).some(b => /#1F9D55|rgb\(31, 157, 85\)/i.test(b.getAttribute('style') || '')));
  await opt('4').click(); await wait(200);
  const contAfterRepick = !(await cont.isDisabled());
  const retake = page.getByRole('button', { name: 'Retake quiz' }); const hasRetake = (await retake.count()) > 0;
  if (hasRetake) { await retake.click(); await wait(200); await opt('4').click(); await wait(100); await page.getByRole('button', { name: 'Submit quiz' }).click(); await wait(300); }
  const contAfterPass = !(await cont.isDisabled());
  const passed = await ev(v => !!(window.__hascLogic.SS().vtProgressFor(v, '16796') || {}).passed_at, fx.vid);
  check('STF-02', 'failed quiz reveals no answers, cannot continue without a recorded pass, and offers a retake', qi >= 0 && !leak && !contAfterRepick && hasRetake && contAfterPass && passed, { qi, leak, contAfterRepick, hasRetake, contAfterPass, passed });
});

await safe('STF-07', 'attestation signature must match the staff name', async () => {
  const run = (sig) => ev(([v, sig]) => { const L = window.__hascLogic; L.SS().vtAddWatch(v, '16796', [[0, 12]], 12); const i = L.state.vtCourse.modules.findIndex(m => m.type === 'attestation'); L.setState({ cpStep: i >= 0 ? i : L.state.cpStep, cpAttest: true, cpSig: sig }); return new Promise(r => setTimeout(() => { L.finishOnlineCourse(); setTimeout(() => r((L.state.docs.completions || []).filter(c => String(c.staffId || c.staff_id) === '16796' && (c.videoId || c.video_id) === v).length), 400); }, 100)); }, [fx.vid, sig]);
  const bad = await run('Someone Else');
  const good = bad === 0 ? await run('Matatov, Melana') : -1;
  check('STF-07', 'attestation signature must match the staff name', bad === 0 && good >= 1, { bad, good });
  await ev(() => { const L = window.__hascLogic; L.closeModal(); L.closeCoursePlayer(); }); await wait();
});

// Manager checks.
await ev(() => window.__hascLogic.logout()); await wait();
await login(page, 'manager', fx.mcu || undefined);

await safe('UX-03', 'manager Home lists out-of-compliance staff, count matches the KPI', async () => {
  await tab(page, 'manager', 'home'); await wait(500);
  const txt = await main(); const red = await kpi('With overdue'); const m = txt.match(/([\d,]+) of ([\d,]+) staff have at least one overdue required training/);
  check('UX-03', 'manager Home lists out-of-compliance staff, count matches the KPI', /Out of compliance/.test(txt) && m && m[1] === red && /\d+ overdue/.test(txt), { red, m: m && m[0] });
});

await safe('MGR-06', 'Video Training tiles and location options are scoped to the manager', async () => {
  await tab(page, 'manager', 'vtrain'); await wait(500);
  const r = await ev(v => { const L = window.__hascLogic; const cu = L.state.currentUser; const mine = new Set(L.managerAuthorizedRoster(cu).map(x => String(x.id))); const rows = L.SS().vtRows(); return { scoped: new Set(rows.filter(x => mine.has(String(x.staff_id))).map(x => String(x.staff_id))).size, all: new Set(rows.map(x => String(x.staff_id))).size, locs: [...new Set(rows.filter(x => mine.has(String(x.staff_id))).map(x => x.location).filter(Boolean))] }; }, fx.vid);
  const am = (await main()).match(/(\d+) Staff assigned/i); const assigned = am && am[1];
  const opts = await ev(() => [...document.querySelectorAll('select')].map(s => [...s.options].map(o => o.textContent.trim())).find(o => o[0] === 'All locations') || []);
  check('MGR-06', 'Video Training tiles and location options are scoped to the manager', assigned === String(r.scoped) && r.scoped < r.all && opts.slice(1).every(o => r.locs.includes(o)), { assigned, r, opts });
});

await safe('MGR-07', 'completed video is not overdue and the status filters match', async () => {
  const rowText = async () => (await main());
  const all = await rowText();
  await ev(() => window.__hascLogic.vtSetFilter('vtFilterStatus', 'passed')); await wait(300); const passed = await rowText();
  await ev(() => window.__hascLogic.vtSetFilter('vtFilterStatus', 'watching')); await wait(300); const watching = await rowText();
  await ev(() => window.__hascLogic.vtSetFilter('vtFilterStatus', '')); await wait(200);
  const names = await ev(o => { const L = window.__hascLogic; return { me: L.staffById('16796').name, other: o ? L.staffById(o).name : null }; }, fx.other);
  check('MGR-07', 'completed video is not overdue and the status filters match', !/Overdue · Completed/.test(all) && passed.includes(names.me) && /Completed/.test(passed) && (!names.other || watching.includes(names.other)), { names, passedHas: passed.includes(names.me), watchingHas: names.other && watching.includes(names.other) });
});

await safe('UX-04', 'Register lists staff who need the course first', async () => {
  await ev(f => { const L = window.__hascLogic; if (!L.state.sessions.some(s => s.id === 'tst_future')) L.setState({ sessions: [...L.state.sessions, { id: 'tst_future', code: 'CPR', title: 'CPR In Person', date: f.date, when: f.when, where: 'East 14th Street', instructor: 'Sara Schwedelson', capacity: 10, roster: [], certified: false, att: {}, pass: {} }] }); }, FUTURE); await wait();
  await tab(page, 'manager', 'register'); await ev(() => window.__hascLogic.setState({ mRegSession: 'tst_future', mRegSel: {}, regWindowStart: 0 })); await wait(500);
  const notes = await ev(() => [...document.querySelectorAll('span')].map(s => s.textContent).filter(t => / · (Needs this training|Optional refresh|Not required for this role|Current · optional refresh)$/.test(t)).map(t => /Needs this training$/.test(t) ? 1 : 0));
  const firstNon = notes.indexOf(0), lastNeed = notes.lastIndexOf(1);
  const needCount = await ev(() => { const L = window.__hascLogic; return L.managerAuthorizedRoster(L.state.currentUser).filter(r => L.requiredFor(r, 'CPR') && ['r', 'o', 'y'].includes(L.effStatus(r, 'CPR'))).length; });
  check('UX-04', 'Register lists staff who need the course first', notes.length > 0 && notes[0] === (needCount ? 1 : 0) && (firstNon < 0 || lastNeed < firstNon), { n: notes.length, needCount, firstNon, lastNeed });
});

await safe('MGR-11', 'capped lists say "showing first N of M" (large team)', async () => {
  const big = await ev(() => { const L = window.__hascLogic; const D = window.HASC_DATA || {}; let best = null, n = 0; (D.managers || []).forEach(m => { const cu = { role: 'manager', email: m.email, name: m.name, roleLabel: 'Manager', empId: m.empId, assignedLocations: m.locations || [] }; const k = L.managerAuthorizedRoster(cu).length; if (k > n) { n = k; best = cu; } }); return { cu: best, n }; });
  await ev(() => window.__hascLogic.logout()); await wait();
  await login(page, 'manager', big.cu); await tab(page, 'manager', 'home'); await wait(600);
  const txt = await main();
  check('MGR-11', 'capped lists say "showing first N of M" (large team)', big.n <= 300 || /Showing first 300 of/.test(txt), { n: big.n });
});

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 600))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
