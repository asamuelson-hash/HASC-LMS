// Security / sessions / manager-scope regression suite (W3).
// Usage: node tools/tests/security.test.mjs [build.html]
// Each check drives the app's own entry points (doLogin, logout, switchRole, print handlers,
// audit-packet builder) and asserts on stored state, rendered text and captured print output.
import { boot, login } from '/home/user/HASC-LMS/tools/harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };
const { browser, page, errors } = await boot(FILE);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 200) => page.waitForTimeout(ms);
const safe = async (id, name, fn) => { try { await fn(); } catch (e) { check(id, name, false, 'threw: ' + String(e && e.message || e).slice(0, 200)); } };
// Real login form path: role picker -> email/password -> doLogin().
// (logout first and let HASCAuth's async SIGNED_OUT event settle, as it would between two people)
const formLogin = async (role, email, pw) => { await ev(() => { const L = window.__hascLogic; if (L.state.currentUser) L.logout(); }); await wait(150); await ev(([role, email, pw]) => { const L = window.__hascLogic; L.setState({ authStep: 'login', loginRole: role, loginEmail: email, loginPw: pw, loginError: '' }); L.doLogin(); }, [role, email, pw]); await wait(); return ev(() => { const L = window.__hascLogic; const cu = L.state.currentUser; return { name: cu && cu.name, role: cu && cu.role, err: L.state.loginError }; }); };
// Capture print output instead of opening the print sheet.
await ev(() => { const L = window.__hascLogic; window.__prints = []; L.printHTML = (html, type) => { window.__prints.push({ html: String(html), type }); }; window.__toasts = []; const t = L.toast.bind(L); L.toast = (m) => { window.__toasts.push(m); t(m); }; });
const MGR_PW = 'hascmanager1';

// ---- fixtures ----
const fx = await ev(() => { const L = window.__hascLogic; const D = window.HASC_DATA;
  const nach = D.managers.find(m => m.empId === '18150');
  const cu = { role: 'manager', empId: nach.empId, assignedLocations: nach.locations, id: nach.email, name: nach.name };
  const scope = new Set(L.managerAuthorizedRoster(cu).map(r => String(r.id)));
  const act = L._activeRosterMemo().filter(r => !scope.has(String(r.id)));
  const byLoc = {}; act.forEach(r => { (byLoc[r.loc] = byLoc[r.loc] || []).push(r); });
  const loc = Object.keys(byLoc).find(l => byLoc[l].length >= 3 && L.audAllowedLocations().includes(l)) || Object.keys(byLoc)[0];
  return { nach, outLoc: loc, outIds: byLoc[loc].slice(0, 3).map(r => String(r.id)), outNames: byLoc[loc].slice(0, 3).map(r => L.dispName(r)) }; });

// SEC-01: an admin's audit packet (and other working state) must not survive logout into the next session.
await safe('SEC-01', 'audit packet + selections cleared on logout/sign-in', async () => {
  await formLogin('admin', 'asamuelson@hasccenter.org', 'hascadmin1');
  await ev(fx => { const L = window.__hascLogic; L.setState({ audLoc: fx.outLoc, audReq: { transcript: true }, audStaff: fx.outIds, trxSearch: 'zz-admin-search', certSelectedIds: fx.outIds }); }, fx); await wait();
  await ev(() => window.__hascLogic.audGenerate()); await wait();
  const gen = await ev(() => !!window.__hascLogic.state.audPacket);
  const r = await formLogin('manager', fx.nach.email, MGR_PW);
  const st = await ev(() => { const S = window.__hascLogic.state; return { pkt: !!S.audPacket, audStaff: (S.audStaff || []).length, audLoc: S.audLoc, trx: S.trxSearch, sel: (S.certSelectedIds || []).length }; });
  await ev(() => { window.__prints = []; const L = window.__hascLogic; L.audPrintPacket(); if (L.state.audPacket) L.audPrintOne(L.state.audPacket.employees[0].id, L.state.audPacket.employees[0].docs[0].key); });
  const printed = await ev(fx => window.__prints.some(p => fx.outNames.some(n => p.html.includes(n))), fx);
  check('SEC-01', 'audit packet + selections cleared on logout/sign-in', gen && r.role === 'manager' && !st.pkt && st.audStaff === 0 && !st.audLoc && !st.trx && st.sel === 0 && !printed, { gen, r, st, printed });
});

// SEC-01c: packet preview/print re-checks scope (admin hops to Manager with a packet still in state).
await safe('SEC-01c', 'packet print filtered by canViewStaffMember', async () => {
  await formLogin('admin', 'asamuelson@hasccenter.org', 'hascadmin1');
  await ev(fx => { const L = window.__hascLogic; L.setState({ audLoc: fx.outLoc, audReq: { transcript: true }, audStaff: fx.outIds }); }, fx); await wait();
  await ev(() => window.__hascLogic.audGenerate()); await wait();
  await ev(() => { window.__prints = []; const L = window.__hascLogic; const pkt = L.state.audPacket; L.switchRole('manager'); if (!L.state.audPacket) L.setState({ audPacket: pkt }); }); await wait();
  const who = await ev(() => { const L = window.__hascLogic; const cu = L.state.currentUser; return { role: cu.role, emp: cu.empId, inScope: (L.state.audPacket.employees || []).filter(e => L.canViewStaffMember(L.staffById(e.id))).length }; });
  await ev(() => { const L = window.__hascLogic; const e = L.state.audPacket.employees[0]; L.audPrintPacket(); L.audPrintOne(e.id, e.docs[0].key); });
  const leaked = await ev(fx => window.__prints.filter(p => fx.outNames.some(n => p.html.includes(n))).length, fx);
  check('SEC-01c', 'packet print filtered by canViewStaffMember', who.role === 'manager' && who.inScope === 0 && leaked === 0, { who, leaked });
  await ev(() => window.__hascLogic.logout());
});

// SEC-05: first-login password setup state cleared on logout; cannot set another person's password.
await safe('SEC-05', 'pwSetup cleared on logout', async () => {
  const st = await ev(() => { const L = window.__hascLogic; return L.state.roster.find(r => L.isEmploymentActive(r) && /^\d+$/.test(String(r.id)) && (() => { try { return !localStorage.getItem('hasc_staff_pw:' + r.id); } catch (e) { return true; } })()); });
  const last = await ev(n => window.__hascLogic.nameParts(n).last, st.name);
  const r = await formLogin('staff', String(st.id), last);
  const during = await ev(() => !!window.__hascLogic.state.pwSetup);
  await ev(() => window.__hascLogic.logout()); await wait();
  const after = await ev(() => window.__hascLogic.state.pwSetup);
  await ev(() => { const L = window.__hascLogic; L.setState({ pwNew1: 'attacker1', pwNew2: 'attacker1' }); L.savePwSetup(); });
  const stored = await ev(id => { try { return localStorage.getItem('hasc_staff_pw:' + id); } catch (e) { return null; } }, st.id);
  check('SEC-05', 'pwSetup cleared on logout; no password written afterwards', r.role === 'staff' && during && after == null && !stored, { r, during, after, stored });
});

// SEC-02: portal hop keeps the real admin, audits the hop, attributes actions, restores the admin.
await safe('SEC-02', 'portal hop keeps real admin identity', async () => {
  await formLogin('admin', 'adershowitz@hasccenter.org', 'hascadmin1');
  await ev(() => window.__hascLogic.switchRole('manager')); await wait();
  const mid = await ev(() => { const L = window.__hascLogic; L.logAudit('Test action while hopped', { notes: 'x' }); return { cu: L.state.currentUser.name, a0: L.state.auditLog[0], hopLogged: L.state.auditLog.slice(0, 5).some(a => /hop/i.test(a.action)), body: document.body.innerText.includes('Atara Dershowitz') }; });
  await ev(() => window.__hascLogic.switchRole('staff')); await wait();
  await ev(() => window.__hascLogic.switchRole('admin')); await wait();
  const back = await ev(() => { const L = window.__hascLogic; return { name: L.state.currentUser.name, role: L.state.currentUser.role, sess: window.HASCSession && window.HASCSession.name() }; });
  check('SEC-02', 'hop: actor stays admin, hop audited, banner shown, return restores same admin', mid.a0.user === 'Atara Dershowitz' && mid.hopLogged && mid.body && back.name === 'Atara Dershowitz' && back.role === 'admin' && back.sess === 'Atara Dershowitz', { mid: { cu: mid.cu, user: mid.a0.user, hopLogged: mid.hopLogged, body: mid.body }, back });
  await ev(() => window.__hascLogic.logout());
});

// SEC-03 / MGR-05: inactive/archived or unknown managers cannot sign in; active ones can.
await safe('SEC-03', 'inactive / missing managers refused', async () => {
  const D = await ev(() => { const D = window.HASC_DATA; const f = e => D.managers.find(m => m.empId === e); return { rachel: f('18535'), naomi: f('4137'), leah: f('15286') }; });
  const a = await formLogin('manager', D.rachel.email, MGR_PW);
  const b = await formLogin('manager', D.naomi.email, MGR_PW);
  const c = await formLogin('manager', D.leah.email, MGR_PW);
  check('SEC-03', 'inactive (18535) and missing (4137) managers refused; active manager signs in', !a.name && !b.name && c.name === 'Leah Friedman' && /inactive/i.test(a.err), { a, b, c });
  await ev(() => window.__hascLogic.logout());
});

// MGR-09: a derived email shared by two managers is refused instead of opening the first account.
await safe('MGR-09', 'ambiguous derived manager email refused', async () => {
  const a = await formLogin('manager', 'asacks@hasccenter.org', MGR_PW);
  const b = await formLogin('manager', 'avisacks@gmail.com', MGR_PW);
  check('MGR-09', 'asacks@ (Alyssa+Abraham) refused; exact email opens Abraham', !a.name && /email/i.test(a.err) && b.name === 'Abraham Sacks', { a, b });
  await ev(() => window.__hascLogic.logout());
});

// MGR-04: "Print all matching" with zero matches prints nothing (manager and admin).
await safe('MGR-04', 'print-all with zero matches prints nothing', async () => {
  await formLogin('manager', 'frmnlea@gmail.com', MGR_PW);
  const mgr = await ev(() => { const L = window.__hascLogic; window.__prints = []; L.setState({ tab: { ...L.state.tab, manager: 'transcripts' }, trxSearch: 'zzzzqqq' }); const v = L.renderVals(); v.onPrintAllTrx && v.onPrintAllTrx(); L.setState({ tab: { ...L.state.tab, manager: 'certificates' }, certSearch: 'zzzzqqq' }); const w = L.renderVals(); w.onPrintAllCerts && w.onPrintAllCerts(); return { n: window.__prints.length, lbl: v.trxPrintAllLabel }; });
  await formLogin('admin', 'asamuelson@hasccenter.org', 'hascadmin1');
  const adm = await ev(() => { const L = window.__hascLogic; window.__prints = []; L.printAllTranscripts('', []); L.printAllCerts('', []); return window.__prints.length; });
  const one = await ev(() => { const L = window.__hascLogic; window.__prints = []; const id = L.batchScope('')[0].id; L.printAllTranscripts('', [id]); const h = (window.__prints[0] || {}).html || ''; return (h.match(/trx-staff/g) || []).length; });
  check('MGR-04', 'zero matches -> 0 prints (manager & admin); one match -> exactly one transcript', mgr.n === 0 && adm === 0 && one === 1, { mgr, adm, one });
  await ev(() => window.__hascLogic.logout());
});

// MGR-02 / MGR-12: HASCPolicy agrees with the app's scope; header states assigned locations + chain.
await safe('MGR-02', 'HASCPolicy scope == app scope; header accurate', async () => {
  await formLogin('manager', 'avisacks@gmail.com', MGR_PW); await wait(400);
  const r = await ev(() => { const L = window.__hascLogic; const p = window.HASCSession.principal(); const app = L.managerAuthorizedRoster(L.state.currentUser); const pol = L.state.roster.filter(s => window.HASCPolicy.canReadStaff(p, s)).length; const hdr = document.querySelector('.hasc-user-summary'); return { app: app.length, pol, hdr: hdr ? hdr.innerText : '' }; });
  check('MGR-02', 'HASCPolicy.canReadStaff count equals managerAuthorizedRoster', r.app === r.pol && r.app > 0, { app: r.app, pol: r.pol });
  check('MGR-12', 'header lists assigned locations and the reporting-line extra', /Assigned locations: Camp after Camp, Day Hab East 14th, General and Admin/.test(r.hdr) && /reporting line/.test(r.hdr), r.hdr.slice(0, 300));
  await ev(() => window.__hascLogic.logout());
});

// MGR-15: a string assignedLocations must not crash scope resolution.
await safe('MGR-15', 'string assignedLocations works', async () => {
  const r = await ev(() => { const L = window.__hascLogic; const cu = { role: 'manager', id: 'x@x', name: 'X', empId: null, assignedLocations: 'Afterschool - Lev Tova' }; return L.managerAuthorizedRoster(cu).length; });
  check('MGR-15', 'string assignedLocations resolves to that location\'s staff', r > 0, r);
});

// MGR-03: Location Directory assignment drives scope; rename keeps an alias so re-imported staff stay in scope.
await safe('MGR-03', 'directory assignment + rename alias', async () => {
  await formLogin('manager', 'frmnlea@gmail.com', MGR_PW);
  const before = await ev(() => window.__hascLogic.managerAuthorizedRoster().length);
  await formLogin('admin', 'asamuelson@hasccenter.org', 'hascadmin1');
  const locId = await ev(() => { const L = window.__hascLogic; const l = L.state.locations.find(x => x.name === 'Afterschool - Lev Tova'); L.startEditLocation(l.id); L.setState({ locForm: { ...L.state.locForm, name: 'Afterschool - Lev Tova Renamed' } }); L.saveLocationEdit(); return l.id; }); await wait();
  // simulate an Empeon re-import that now writes the new name on the staff records
  await ev(() => { const L = window.__hascLogic; L.setState({ roster: L.state.roster.map(r => r.loc === 'Afterschool - Lev Tova' ? { ...r, loc: 'Afterschool - Lev Tova Renamed' } : r) }); }); await wait();
  await formLogin('manager', 'frmnlea@gmail.com', MGR_PW);
  const renamed = await ev(() => window.__hascLogic.managerAuthorizedRoster().length);
  // harness-style sign-in with the old HASC_DATA name must also still resolve (alias)
  await ev(() => window.__hascLogic.logout()); await login(page, 'manager', { email: 'frmnlea@gmail.com', name: 'Leah Friedman', roleLabel: 'Manager', empId: '15286', assignedLocations: ['Afterschool - Lev Tova'] });
  const viaOld = await ev(() => window.__hascLogic.managerAuthorizedRoster().length);
  await formLogin('admin', 'asamuelson@hasccenter.org', 'hascadmin1');
  await ev(id => window.__hascLogic.toggleLocManager(id, '15286'), locId); await wait();
  await formLogin('manager', 'frmnlea@gmail.com', MGR_PW);
  const revoked = await ev(() => { const L = window.__hascLogic; return { n: L.managerAuthorizedRoster().length, tree: L.managerScopeRoster('15286').length }; });
  check('MGR-03', 'rename keeps scope (alias); removing manager in directory revokes location access', renamed === before && viaOld === before && revoked.n === revoked.tree && revoked.n < before, { before, renamed, viaOld, revoked });
  await ev(() => window.__hascLogic.logout());
});

// MGR-03b: a directory saved before a HASC_DATA assignment existed (no entry, no explicit removal) keeps the seed assignment.
await safe('MGR-03b', 'stale directory keeps seed assignment', async () => {
  const r = await ev(() => { const L = window.__hascLogic; const l = L.state.locations.find(x => (x.managers || []).includes('2278') && !x.mergedInto); L.setState({ locations: L.state.locations.map(x => x.id === l.id ? { ...x, managers: x.managers.filter(e => e !== '2278') } : x) }); return { loc: l.name, locs: L.directoryLocationsFor ? L.directoryLocationsFor('2278', window.HASC_DATA.managers.find(m => m.empId === '2278').locations) : null }; });
  check('MGR-03b', 'manager missing from a saved directory entry keeps that HASC_DATA location', r.locs && r.locs.includes(r.loc), r);
});

// MGR-14: audit-packet history shows a manager only staff in their own scope.
await safe('MGR-14', 'packet history filtered by staff scope', async () => {
  const pick = await ev(() => { const L = window.__hascLogic; const D = window.HASC_DATA; const m = D.managers.find(x => x.empId === '2278');
    const cu = { role: 'manager', empId: m.empId, assignedLocations: m.locations, id: m.email, name: m.name }; const ids = new Set(L.managerAuthorizedRoster(cu).map(r => String(r.id)));
    const locs = [...new Set(L.managerAuthorizedRoster(cu).map(r => r.loc))]; const act = L._activeRosterMemo();
    for (const loc of locs) { const at = act.filter(r => r.loc === loc); const i = at.find(r => ids.has(String(r.id))), o = at.find(r => !ids.has(String(r.id))); if (i && o) return { loc: L.canonicalLocName(i) || loc, inId: String(i.id), outId: String(o.id), outName: L.dispName(o) }; } return null; });
  if (!pick) { check('MGR-14', 'packet history filtered by staff scope', false, 'no partial location found'); return; }
  await formLogin('admin', 'asamuelson@hasccenter.org', 'hascadmin1');
  await ev(p => { const L = window.__hascLogic; const docs = { ...L.state.docs, auditPacketHistory: [{ id: 'apTest', at: new Date().toISOString(), atLabel: 'now', loc: p.loc, by: 'Admin', role: 'admin', staff: [{ id: p.inId, name: 'IN' }, { id: p.outId, name: p.outName }], requests: ['Transcript'], docCount: 2, printedAt: '' }, ...((L.state.docs.auditPacketHistory) || [])] }; L.setState({ docs }); }, pick); await wait();
  await formLogin('manager', 'avisacks@gmail.com', MGR_PW);
  const rows = await ev(() => { const L = window.__hascLogic; const v = L._audVals('manager', 'auditpkt'); return (v.audHistRows || []).map(h => h.staff).join(' | '); });
  check('MGR-14', 'out-of-scope staff name not listed in manager packet history', rows.includes('IN') && !rows.includes(pick.outName), { rows: rows.slice(0, 200), out: pick.outName });
  await ev(() => window.__hascLogic.logout());
});

// MGR-10: managers do not get a Deny button that always fails.
await safe('MGR-10', 'no dead Deny button for managers', async () => {
  await formLogin('manager', 'frmnlea@gmail.com', MGR_PW);
  const r = await ev(() => { const L = window.__hascLogic; const st = L.managerAuthorizedRoster().find(r => L.isActiveStaff(r));
    L.setState({ requests: [...(L.state.requests || []), { id: 'rqTest', staffId: st.id, code: 'CPR', status: 'pendingMgr', source: 'manager_request', by: 'manager' }], tab: { ...L.state.tab, manager: 'home' } });
    return st.name; }); await wait(400);
  const home = await ev(() => { const t = document.body.innerText; return { fwd: /Forward to admin/.test(t), deny: /\bDeny\b/.test(t) }; });
  check('MGR-10', 'Home shows Forward but no Deny for a manager', home.fwd && !home.deny, home);
  await ev(() => { const L = window.__hascLogic; L.setState({ requests: (L.state.requests || []).filter(r => r.id !== 'rqTest') }); L.logout(); });
});

// STF-05: a staff session cannot render another employee's certificate.
await safe('STF-05', 'cert view checks canViewStaffMember', async () => {
  await login(page, 'staff');
  const r = await ev(() => { const L = window.__hascLogic; const other = L.state.roster.find(s => String(s.id) !== String(L.state.currentUser.staffId) && s.dt && Object.keys(s.dt).length); const code = Object.keys(other.dt)[0];
    L.openCertFor(other.id, code); const m1 = L.state.modal && L.state.modal.type === 'cert';
    L.setState({ modal: { type: 'cert', staffId: other.id, code } }); return { m1, name: L.dispName(other) }; }); await wait(300);
  const shown = await ev(n => document.body.innerText.includes(n), r.name);
  check('STF-05', 'openCertFor refused and cert modal does not render another staff member', !r.m1 && !shown, { ...r, shown });
  await ev(() => { const L = window.__hascLogic; L.setState({ modal: null }); L.logout(); });
});

// SEC-08: training-update asset URL must be http(s).
await safe('SEC-08', 'asset URL scheme validated', async () => {
  await login(page, 'admin');
  const r = await ev(() => { const L = window.__hascLogic; const orig = L.SS(); const pubs = []; L.SS = () => Object.assign(Object.create(orig), { vtVideoById: () => ({ id: 'v1', title: 'Test video' }), vtPublishContentUpdate: (id, f) => { pubs.push(f.asset_url); return { ok: true, assigned: 0, id: 'u' + pubs.length }; } });
    L.setState({ vtUpdId: 'v1', vtUpdForm: { kind: 'note', title: 'T', body: 'B', asset_url: 'javascript:alert(1)', asset_data_url: '' } }); L.vtPublishUpdate();
    L.setState({ vtUpdId: 'v1', vtUpdForm: { kind: 'note', title: 'T', body: 'B', asset_url: 'https://example.org/a.pdf', asset_data_url: '' } }); L.vtPublishUpdate();
    delete L.SS; return pubs; });
  check('SEC-08', 'javascript: asset rejected, https accepted', r.length === 1 && r[0] === 'https://example.org/a.pdf', r);
  await ev(() => window.__hascLogic.logout());
});

// SEC-09: staff import handlers refuse non-admins.
await safe('SEC-09', 'import handlers guarded', async () => {
  await formLogin('manager', 'frmnlea@gmail.com', MGR_PW);
  const r = await ev(async () => { const L = window.__hascLogic; const n0 = L.state.roster.length; L.setState({ csvText: 'Name,ID,Location\nTest Person,999999,Nowhere' }); L.importCsvStaff();
    const file = new File(['EmployeeNumber,LastName,FirstName\n999998,Zed,Ann\n'], 'x.csv', { type: 'text/csv' });
    await L.importEmpeon({ target: { files: [file] } }); await new Promise(r => setTimeout(r, 300));
    return { grew: L.state.roster.length !== n0 || L.state.roster.some(r => String(r.id) === '999999'), pending: !!L.state.pendingImport, msg: L.state.empeonMsg || '' }; });
  check('SEC-09', 'manager cannot run CSV staff import or Empeon analysis', !r.grew && !r.pending && !/Reading|analyz/i.test(r.msg), r);
  await ev(() => window.__hascLogic.logout());
});

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
