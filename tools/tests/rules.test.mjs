// Manager KPI / course-library / import-date regression checks.  node tests/rules.test.mjs [build]
import { boot, login, tab } from '../harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = []; const check = (id, name, ok, detail) => results.push({ id, name, ok: !!ok, detail });
const { browser, page, errors } = await boot(FILE);
const ev = (fn, arg) => page.evaluate(fn, arg);

// MGR-01 / CMP-05: Manager Home "With overdue" equals the effStatus count for the same team.
await login(page, 'manager'); await tab(page, 'manager', 'home');
{ const r = await ev(() => { const L = window.__hascLogic; const txt = document.body.innerText; const m = txt.match(/(\d+)\s*\n\s*With overdue/i); const d = txt.match(/(\d+)\s*\n\s*Due soon/i);
    const cu = L.state.currentUser; const mv = L._mgrMatrixView(cu.empId || 'mgr', L._memo ? L.state.roster.filter(s => L.canViewStaffMember(s) && L.isActiveStaff(s)) : [], '', '', L.state.repShow, true);
    return { shown: m && +m[1], due: d && +d[1], engine: mv.team.filter(r => L.MATRIX_COLS.some(c => L.effStatus(r, c) === 'r')).length, team: mv.team.length }; });
  check('MGR-01', 'Manager Home overdue count matches the compliance engine', r.shown != null && r.shown === r.engine && r.engine > 0, r); }
await ev(() => window.__hascLogic.setState({ currentUser: null, role: null, authStep: 'select' }));

// ADM-01: a Course Library course mapped onto built-in PA must not change PA rules.
await login(page, 'admin');
{ const r = await ev(() => { const L = window.__hascLogic; const act = L._activeRosterMemo().filter(s => L.requiredFor(s, 'PA') && s.dt.PA);
    const count = () => { const m = {}; act.forEach(s => { const l = L.effStatus(s, 'PA'); m[l] = (m[l] || 0) + 1; }); return JSON.stringify(m); };
    const before = count(), ivBefore = L.catalogIntervalDays('PA');
    L.state.customCourses = [...(L.state.customCourses || []), { key: 'PA_REFRESH', code: 'PA', label: 'PA Refresher Workshop', expiration: 'Annual', complianceRequirement: true, requiredFor: 'All Staff' }];
    L.__memo = {}; const after = count(), ivAfter = L.catalogIntervalDays('PA');
    // a genuinely new custom compliance course keeps its own interval
    L.state.customCourses = [...L.state.customCourses, { key: 'NEWC', code: 'NEWC', label: 'New Annual Course', expiration: 'Annual', complianceRequirement: true, requiredFor: 'All Staff' }]; L.__memo = {};
    const newIv = L.catalogIntervalDays('NEWC');
    return { before, after, ivBefore, ivAfter, newIv }; });
  check('ADM-01', 'mapped library course leaves built-in PA statuses and interval unchanged', r.before === r.after && r.ivBefore === r.ivAfter, r);
  check('ADM-01b', 'new unmapped Annual compliance course keeps a 365-day interval', r.newIv === 365, r); }

// IMP-01/02/03: import date parsing is strict; future completions are blocked.
{ const r = await ev(() => { const L = window.__hascLogic; const cases = ['Scheduled 10/30/26', 'Due 11/1/2026', '10/26', '2025', '85', 'Pending 1', '02/30/2026', '1/5/2026', '2026-01-05', '46027', 'Jan 5, 2026', '5-Jan-2026', 'September 3 2025', '1/5/26 10:30 AM'];
    return cases.map(c => [c, L.importDate(c)]); });
  const want = { 'Scheduled 10/30/26': '', 'Due 11/1/2026': '', '10/26': '', '2025': '', '85': '', 'Pending 1': '', '02/30/2026': '', '1/5/2026': '1/5/26', '2026-01-05': '1/5/26', '46027': '1/5/26', 'Jan 5, 2026': '1/5/26', '5-Jan-2026': '1/5/26', 'September 3 2025': '9/3/25', '1/5/26 10:30 AM': '1/5/26' };
  const bad = r.filter(([c, v]) => want[c] !== v);
  check('IMP-01a', 'importDate rejects non-dates and parses real formats', bad.length === 0, bad);
  const row = await ev(() => { const L = window.__hascLogic; const st = L._activeRosterMemo()[0]; return ['1/5/2031', '1/5/2026'].map(d => L.trainingImportBuildRow({ staffId: st.id, rawCode: 'CPR', rawDate: d }, new Set(), new Set()).status); });
  check('IMP-01b', 'training import blocks a future completion date', row[0] === 'Blocked' && row[1] !== 'Blocked', row); }

// QA-01: pouring / RN paths reject future and out-of-range years.
{ const r = await ev(() => { const L = window.__hascLogic; if (!L.completionDateError) return ['n/a']; return ['12/1/2026', '3/3/2126', '1/1/1920', '9/1/2026'].map(d => L.completionDateError(d)); });
  check('QA-01', 'completionDateError rejects future and unrepresentable years', r[0] && r[1] && r[2] && !r[3], r); }

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
