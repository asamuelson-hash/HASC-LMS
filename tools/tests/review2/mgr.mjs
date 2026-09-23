import { boot, login, tab } from '/home/user/HASC-LMS/tools/harness.mjs';
const FILE = process.argv[2] || (process.argv[2]||'/home/user/HASC-LMS/work/out_fix.html');
const { browser, page, errors } = await boot(FILE);
const ev = (fn, a) => page.evaluate(fn, a);
const acct = await ev(() => { const D = window.HASC_DATA; const m = (D.managers || []).find(x => /Resnick/i.test(x.name)); return { email: m.email, name: m.name, roleLabel: 'Manager', empId: m.empId, assignedLocations: m.locations || [] }; });
await login(page, 'manager', acct);
await tab(page, 'manager', 'home'); await page.waitForTimeout(800);
const r = await ev(() => { const L = window.__hascLogic; const cu = L.state.currentUser; const scope = L.managerAuthorizedRoster(cu); const ids = new Set(scope.map(s => String(s.id)));
  const v = L.renderVals ? null : null;
  const ooc = L.followUpRows({ list: scope });
  const sum = L.complianceSummary(scope, L.MATRIX_COLS);
  // staff red only on a location-added code outside MATRIX_COLS
  const locOnly = scope.filter(s => { const add = (L.locAddedCodesFor(s) || []).filter(c => !L.MATRIX_COLS.includes(c)); return add.some(c => L.effStatus(s, c) === 'r'); }).length;
  const txt = document.body.innerText; const m = txt.match(/([\d,]+) of ([\d,]+) staff have at least one overdue/);
  const teamLine = (txt.match(/\d[\d,]* staff \(assigned locations[^)]*\)/) || [])[0];
  return { scope: scope.length, oocRows: ooc.length, oocOutside: ooc.filter(x => !ids.has(x.id)).length, summaryRedStaff: sum.redStaff, locAddedOnlyRed: locOnly, oocLine: m && m[0], teamLine, canReadAll: scope.slice(0, 200).every(s => window.HASCPolicy ? window.HASCPolicy.canReadStaff({ role: 'manager', email: cu.email, empId: cu.empId, assignedLocations: cu.assignedLocations }, s) : true) }; });
console.log('HOME', JSON.stringify(r));
// Now apply a location filter on the Needs tab, come back Home
const r2 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms)); const scope = L.managerAuthorizedRoster(L.state.currentUser); const loc = L.canonicalLocName(scope[0]);
  L.setState({ tab: { ...L.state.tab, manager: 'needs' }, mLoc: loc }); await sl(500); L.setState({ tab: { ...L.state.tab, manager: 'home' } }); await sl(700);
  const txt = document.body.innerText; return { loc, teamLine: (txt.match(/\d[\d,]* staff \(assigned locations[^)]*\)/) || [])[0], oocLine: (txt.match(/([\d,]+) of ([\d,]+) staff have at least one overdue[^.]*/) || [])[0], kpiRed: (txt.match(/(\d[\d,]*)\s*\n\s*Overdue/) || [])[1] }; });
console.log('HOME after mLoc', JSON.stringify(r2));
// Video training tiles/locations scope
const r3 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms)); const keys = (L.NAV_BY_ROLE && L.NAV_BY_ROLE.manager || []).map(x => x[0] || x.id || x); return { keys }; });
console.log('NAV', JSON.stringify(r3));
console.log('ERRORS', errors.filter(e => !/permissions policy|ERR_FAILED/.test(e)).slice(0, 8));
await browser.close();
