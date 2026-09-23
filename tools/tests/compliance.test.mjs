// Compliance regression suite. Usage (from tools/):  node tests/compliance.test.mjs [build.html]
// Each scenario reproduces an audit finding end to end through the app's own write paths and
// asserts the resulting stored state and status, including after a page reload.
import { boot, login } from '../harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };
const { browser, page, errors } = await boot(FILE);
await login(page, 'admin');
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 150) => page.waitForTimeout(ms);
const snap = (id, code) => ev(([id, code]) => { const L = window.__hascLogic; const s = L.state.roster.find(r => String(r.id) === String(id)); return { dt: s.dt[code] || null, eo: (s.expOverride || {})[code] || null, st: L.effStatus(s, code), exp: L.expirationFor(s, code, s.dt[code]) }; }, [id, code]);
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 }); await login(page, 'admin'); };
// wait for debounced persistence to flush before reloading
const flush = () => wait(1500);

// ---- pick fixtures from live data ----
const fx = await ev(() => { const L = window.__hascLogic; const act = L._activeRosterMemo();
  const greenCPR = act.find(s => L.requiredFor(s, 'CPR') && L.effStatus(s, 'CPR') === 'g' && s.dt.CPR && L.compDateVal(s.dt.CPR) > new Date(2026,0,1).getTime());
  const redCPR = act.filter(s => L.requiredFor(s, 'CPR') && L.effStatus(s, 'CPR') === 'r' && s.dt.CPR && L.compDateVal(s.dt.CPR) < new Date(2024, 8, 5).getTime());
  const redFA = act.find(s => L.requiredFor(s, 'FA') && L.effStatus(s, 'FA') === 'r' && s.id !== redCPR[0].id);
  const comps = L.state.docs.completions || [];
  const backed = new Set(comps.map(c => L.completionStaffId(c) + '|' + L.completionComplianceCode(c) + '|' + L.completionDate(c)));
  const rosterOnly = act.find(s => s.dt.O1 && !backed.has(String(s.id) + '|O1|' + s.dt.O1) && !(window.HASC_COMPLETION_REFERENCE_20260915||[]).some(r=>String(r.id)===String(s.id)));
  const rosterOnly2 = act.find(s => s.dt.O1 && !backed.has(String(s.id) + '|O1|' + s.dt.O1) && s !== rosterOnly);
  return { green: greenCPR && greenCPR.id, red1: redCPR[0].id, red2: redCPR[1].id, red3: redCPR[2].id, redFA: redFA.id, rosterOnly: (rosterOnly||rosterOnly2).id, rosterOnlyO1: (rosterOnly||rosterOnly2).dt.O1 }; });

// CMP-02 / CRT-01: backfilling an older completion must not lower a current one.
{ const before = await snap(fx.green, 'CPR');
  await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'CPR_IN_PERSON', compDate: '1/10/22', compExp: '', compExpManual: false, compNote: 'backfill' }); }, fx.green); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const after = await snap(fx.green, 'CPR');
  check('CMP-02', 'backfilled older CPR leaves current status/expiry unchanged', after.st === before.st && after.dt === before.dt && after.exp === before.exp && !after.eo, { before, after }); }

// CMP-03: a stale manual override must not survive a newer completion.
{ await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'CPR_IN_PERSON', compDate: '9/5/24', compExp: '10/1/24', compExpManual: true, compNote: 'manual override' }); }, fx.red1); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const mid = await snap(fx.red1, 'CPR');
  await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'CPR_IN_PERSON', compDate: '9/15/26', compExp: '', compExpManual: false, compNote: 'renewal' }); }, fx.red1); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const after = await snap(fx.red1, 'CPR');
  check('CMP-03a', 'newer completion clears stale override (independent path)', mid.eo === '10/1/24' && after.st === 'g' && after.dt === '9/15/26' && !after.eo && after.exp === '9/15/28', { mid, after }); }

// CMP-03 + SCH-05 via session certification.
const mkSession = (id, date, when, staffIds) => ev(([id, date, when, staffIds]) => { const L = window.__hascLogic; const att = {}, pass = {}; staffIds.forEach(s => { att[s] = 'present'; pass[s] = true; });
  L.setState({ sessions: [...L.state.sessions, { id, code: 'CPR', title: 'CPR In Person', date, when, where: 'East 14th Street', instructor: 'Sara Schwedelson', capacity: 10, roster: staffIds.map(s => ({ staffId: s, waitlist: false })), certified: false, att, pass }] }); }, [id, date, when, staffIds]);
{ // red2: give it a stale manual override first, then certify a newer session
  await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'CPR_IN_PERSON', compDate: '9/5/24', compExp: '10/1/24', compExpManual: true, compNote: 'override' }); }, fx.red2); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  await mkSession('tst_s1', 'Tue, Sep 15, 2026', 'Tue, Sep 15, 2026 · 9:00 AM–12:00 PM', [fx.red2]); await wait();
  await ev(() => window.__hascLogic.certify('tst_s1')); await wait();
  const a = await snap(fx.red2, 'CPR');
  check('CMP-03b', 'certified session clears stale override', a.st === 'g' && a.dt === '9/15/26' && !a.eo, a);
  // red3: newer independent completion, then an OLDER session certified late
  await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'CPR_IN_PERSON', compDate: '9/10/26', compExp: '', compExpManual: false, compNote: 'x' }); }, fx.red3); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  await mkSession('tst_s2', 'Wed, Jun 17, 2026', 'Wed, Jun 17, 2026 · 9:00 AM–12:00 PM', [fx.red3]); await wait();
  await ev(() => window.__hascLogic.certify('tst_s2')); await wait();
  const b = await snap(fx.red3, 'CPR');
  check('SCH-05', 'late-certified older session does not move date backwards', b.dt === '9/10/26' && b.st === 'g', b); }

// CMP-06: future and impossible dates rejected.
{ const before = await snap(fx.redFA, 'FA');
  await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'FA', compDate: '9/22/2030', compExp: '', compExpManual: false, compNote: '' }); }, fx.redFA); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const after = await snap(fx.redFA, 'FA');
  const p = await ev(() => { const L = window.__hascLogic; return ['2/30/26', '13/5/26', '9/0/26', '2/29/24', '2026-09-22', '9/22/26'].map(x => { const d = L.parseMDY(x); return d ? L.formatMDY(d) : null; }); });
  check('CMP-06a', 'future-dated completion rejected', after.st === before.st && after.dt === before.dt, { before, after });
  check('CMP-06b', 'impossible dates rejected, valid/ISO dates parsed', JSON.stringify(p) === JSON.stringify([null, null, null, '2/29/24', '9/22/26', '9/22/26']), p); }

// CMP-04: EMT card satisfies CPR + FA and survives reload.
const emtStaff = fx.redFA;
{ await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, xcCourse: 'EMT', xcDate: '9/1/26', xcExp: '9/1/28', xcFile: 'data:application/pdf;base64,AA==', xcFileName: 'emt.pdf' }); }, emtStaff); await wait();
  await ev(() => window.__hascLogic.recordExtCertDirect()); await wait();
  const live = { cpr: await snap(emtStaff, 'CPR'), fa: await snap(emtStaff, 'FA') };
  check('CMP-04a', 'EMT card turns CPR and FA green (live)', live.cpr.st === 'g' && live.fa.st === 'g' && live.cpr.exp === '9/1/28', live); }

// Void fallback: voiding a completion that superseded an imported roster-only date restores that date.
{ await ev(id => { const L = window.__hascLogic; L.setState({ admStaff: id, compCourse: 'O1', compDate: '9/1/26', compExp: '', compExpManual: false, compNote: 'x' }); }, fx.rosterOnly); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const mid = await snap(fx.rosterOnly, 'O1');
  await ev(id => { const L = window.__hascLogic; const rec = L.buildCompletionRecords().find(r => String(r.staffId) === String(id) && r.code === 'O1' && r.date === '9/1/26'); L.setState({ modal: { type: 'void', rec, reason: 'test', ack: true } }); L.voidCompletion(); }, fx.rosterOnly); await wait();
  const after = await snap(fx.rosterOnly, 'O1');
  check('VOID-01', 'voiding newer completion falls back to imported date instead of erasing it', mid.dt === '9/1/26' && after.dt === fx.rosterOnlyO1, { mid, after, expected: fx.rosterOnlyO1 }); }

// CMP-01: required-but-missing courses are no longer counted compliant.
{ const r = await ev(() => { const L = window.__hascLogic; const s = L.state.roster.find(x => String(x.id) === '3294'); return { DIABP: L.effStatus(s, 'DIABP'), WCO: L.effStatus(s, 'WCO'), WCI: L.effStatus(s, 'WCI'), why: (L.ruleDiagnostic(s, 'WCO') || {}).why };});
  check('CMP-01a', 'staff 3294 missing DIABP/WCO/WCI are red with an explanation', r.DIABP === 'r' && r.WCO === 'r' && r.WCI === 'r' && /initial due date/i.test(r.why || ''), r);
  const agg = await ev(() => { const L = window.__hascLogic; const act = L._activeRosterMemo(); let reqW = 0; act.forEach(s => L.MATRIX_COLS.forEach(c => { if (c !== 'ART' && L.requiredFor(s, c) && L.effStatus(s, c) === 'w') { const x = L.initialDueInfo ? L.initialDueInfo(s, c) : null; if (!x || !x.due || L.daysUntil(x.due) <= 90) reqW++; } })); return reqW; });
  check('CMP-01b', 'no required non-ART cell is white unless >90 days from its initial due date', agg === 0, agg);
  const legacy = await ev(() => { const L = window.__hascLogic; const s = L.state.roster.find(x => String(x.id) === '3294'); L.state.docs.complianceRules = { missingRequired: 'legacy' }; const v = L.effStatus(s, 'WCO'); delete L.state.docs.complianceRules; return v; });
  check('CMP-01c', 'legacy mode setting restores previous white behavior', legacy === 'w', legacy); }

// Persistence: everything above survives a reload.
await flush(); await reload();
{ const a = await snap(fx.green, 'CPR'), b = await snap(fx.red1, 'CPR'), c = await snap(emtStaff, 'CPR'), d = await snap(emtStaff, 'FA'), e = await snap(fx.rosterOnly, 'O1'), f = await snap(fx.red3, 'CPR');
  check('RELOAD', 'all scenario results identical after reload', a.eo === null && b.st === 'g' && !b.eo && c.st === 'g' && d.st === 'g' && e.dt === fx.rosterOnlyO1 && f.dt === '9/10/26', { a, b, c, d, e, f }); }

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
