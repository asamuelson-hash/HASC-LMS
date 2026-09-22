// Follow-ups from the independent review of batch 1.  node tests/review1.test.mjs [build]
import { boot, login } from '../harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = []; const check = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
const { browser, page, errors } = await boot(FILE); await login(page, 'admin');
const ev = (fn, arg) => page.evaluate(fn, arg); const wait = (ms = 150) => page.waitForTimeout(ms);
const snap = (id, code) => ev(([id, code]) => { const L = window.__hascLogic; const s = L.state.roster.find(r => String(r.id) === String(id)); return { dt: s.dt[code] || null, eo: (s.expOverride || {})[code] || null, st: L.effStatus(s, code) }; }, [id, code]);

// R1-01: internal document "post" goes through validation + replay (older doc can't lower current)
{ const fx = await ev(() => { const L = window.__hascLogic; const s = L._activeRosterMemo().find(s => L.requiredFor(s, 'CPR') && L.effStatus(s, 'CPR') === 'g'); const types = Object.keys(L.INTERNAL_DOC_TYPES || {}); return { id: s.id, dt: s.dt.CPR, cprType: (L.state.icTypeOpts || []).length, t: (typeof L.internalLinkCode === 'function') ? ['CPR Card','CPR','CPR Certificate','CPR/FA'].find(x => L.internalLinkCode(x) === 'CPR') : null }; });
  if (fx.t) {
    const before = await snap(fx.id, 'CPR');
    await ev(([id, t]) => { const L = window.__hascLogic; L.setState({ certStaffId: id, icType: t, icFile: 'data:application/pdf;base64,AA==', icFileName: 'x.pdf', icDate: '1/5/21', icExp: '', icAction: 'post' }); }, [fx.id, fx.t]); await wait();
    await ev(() => window.__hascLogic.uploadInternalDoc()); await wait();
    const after = await snap(fx.id, 'CPR');
    await ev(([id, t]) => { const L = window.__hascLogic; L.setState({ certStaffId: id, icType: t, icFile: 'data:application/pdf;base64,AA==', icFileName: 'y.pdf', icDate: '2/30/27', icExp: '', icAction: 'post' }); }, [fx.id, fx.t]); await wait();
    const n0 = await ev(() => (window.__hascLogic.state.docs.internalDocs || []).length);
    await ev(() => window.__hascLogic.uploadInternalDoc()); await wait();
    const n1 = await ev(() => (window.__hascLogic.state.docs.internalDocs || []).length);
    check('R1-01', 'older internal doc does not lower current CPR; impossible date rejected', after.st === before.st && after.dt === before.dt && n1 === n0, { before, after, n0, n1 });
  } else check('R1-01', 'internal doc type for CPR found', false, fx); }

// R1-04: voiding AMAP Day 2 also voids the AMAP row it satisfied
{ const r = await ev(() => { const L = window.__hascLogic; const s = L._activeRosterMemo().find(s => !s.dt.AMAP && !s.dt.AMAP2);
    const docs = { ...L.state.docs, completions: [...L.state.docs.completions, { id: 'tstA2', staffId: s.id, course: 'AMAP2', complianceCode: 'AMAP2', date: '9/1/26', by: 'admin' }] };
    let roster = L.applyCompletionsToRoster(L.applyVoidsToRoster(L.state.roster, docs), docs); const mid = roster.find(r => r.id === s.id).dt.AMAP;
    const docs2 = { ...docs, completionVoids: [{ key: L.completionKey(s.id, 'AMAP2', '9/1/26'), staffId: s.id, code: 'AMAP2', completionDate: '9/1/26' }] };
    roster = L.applyCompletionsToRoster(L.applyVoidsToRoster(roster, docs2), docs2); const after = roster.find(r => r.id === s.id).dt.AMAP;
    return { mid, after: after || null }; });
  check('R1-04', 'AMAP2 void removes derived AMAP date', r.mid === '9/1/26' && r.after === null, r); }

// R1-06 / R1-07: future Form received date and bad expirations rejected
{ const r = await ev(() => { const L = window.__hascLogic; if (!L.expirationDateError) return []; return [L.expirationDateError('1/1/2055', '9/1/26'), L.expirationDateError('Dec 2027', '9/1/26'), L.expirationDateError('1/1/26', '9/1/26'), L.expirationDateError('9/1/28', '9/1/26')]; });
  check('R1-07', 'expiration validation: >2050, non-date, before completion rejected; valid accepted', r[0] && r[1] && r[2] && !r[3], r); }

// R1-08 / R1-09: import formats
{ const r = await ev(() => { const L = window.__hascLogic; return ['Monday, January 5, 2026', 'Mon, Jan 5, 2026', 'Jan-5-2026', 'Mon Jan 05 2026 00:00:00 GMT-0500 (Eastern Standard Time)', '1/5/1945', '12/31/2099'].map(x => L.importDate(x)); });
  check('R1-08', 'importDate accepts long/weekday/JS-date forms; rejects unrepresentable years', JSON.stringify(r) === JSON.stringify(['1/5/26', '1/5/26', '1/5/26', '1/5/26', '', '']), r); }

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e)); check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
