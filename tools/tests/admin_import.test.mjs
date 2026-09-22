// Admin configuration & data-import integrity suite (W4). Usage (from /home/user/HASC-LMS/tools):
//   node <worktree>/tools/tests/admin_import.test.mjs <build.html>
// Each check drives the app's own entry points (saveLocReq, saveCourseInformation, importData,
// saveInstructor, setArchived, importEmpeon/applyImport/undoLastStaffImport, training import).
import { boot, login } from '/home/user/HASC-LMS/tools/harness.mjs';
import fs from 'node:fs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };
const { browser, page, errors } = await boot(FILE);
await login(page, 'admin');
const ev = (fn, arg) => page.evaluate(fn, arg).catch(e => ({ __err: String(e && e.message || e).slice(0, 300) }));
const wait = (ms = 150) => page.waitForTimeout(ms);
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 }); await login(page, 'admin'); };
// Dialog control inside the page: record messages, answer from window.__answers (default: accept).
const dialogs = () => ev(() => { window.__dlg = []; window.__answers = window.__answers || {}; window.confirm = m => { window.__dlg.push(String(m)); return window.__answers.confirm !== false; }; window.prompt = m => { window.__dlg.push(String(m)); return window.__answers.prompt == null ? '' : window.__answers.prompt; }; window.alert = m => { window.__dlg.push(String(m)); }; });
await dialogs();

// ---------- ADM-02: future-dated location rule does not apply before its effective date ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    let loc = null, staff = null;
    for (const l of (L.state.locations || []).filter(l => !l.archived && l.active)) { const st = L.locStaffActive(l.id).filter(s => L.requiredFor(s, 'CPR')); if (st.length > 3) { loc = l; staff = st; break; } }
    const before = staff.map(s => L.effStatus(s, 'CPR'));
    L.startLocReq(loc.id, 'CPR'); await sleep(30); L.setLocReqField('req', 'remove'); L.setLocReqField('effMode', 'future'); L.setLocReqField('effDate', '12/31/26'); L._reasonDraft = 'test future'; await sleep(30);
    L.saveLocReq(); await sleep(150);
    const after = staff.map(s => L.effStatus(s, 'CPR')), reqNow = L.requiredFor(staff[0], 'CPR');
    const gridNow = L._complianceGrid().byId[String(staff[0].id)].CPR;
    L.todayDate = () => new Date(2027, 0, 2);   // clock passes the effective date
    const reqLater = L.requiredFor(staff[0], 'CPR'), gridLater = L._complianceGrid().byId[String(staff[0].id)].CPR, effLater = L.effStatus(staff[0], 'CPR');
    delete L.todayDate; const gridBack = L._complianceGrid().byId[String(staff[0].id)].CPR;
    L.removeLocReqOverride(loc.id, 'CPR'); await sleep(50);
    return { same: JSON.stringify(before) === JSON.stringify(after), reqNow, reqLater, gridNow, gridLater, effLater, gridBack, first: before[0] }; });
  check('ADM-02a', 'future-dated "not required" rule leaves status and requirement unchanged today', r.same && r.reqNow === true && r.gridNow === r.first, r);
  check('ADM-02b', 'rule takes effect once the clock reaches the effective date (grid memo rolls over)', r.reqLater === false && r.gridLater === r.effLater && r.gridBack === r.first, r); }

// ---------- CRT-08: renewal change shows an impact preview computed with effStatus, and is audited ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const act = L._activeRosterMemo(); const before = act.map(s => L.effStatus(s, 'FA'));
    window.__dlg = []; L.setState({ ciCode: 'FA', ciRenewMode: 'annual', ciCustomDays: '', ciAfterFirst: false }); await sleep(80);
    const preview = document.body.innerText.includes('staff will change status');
    L.saveCourseInformation(); await sleep(250);
    const after = L._activeRosterMemo().map(s => L.effStatus(s, 'FA'));
    let changed = 0, overdue = 0; before.forEach((b, i) => { if (b !== after[i]) { changed++; if (after[i] === 'r') overdue++; } });
    const msg = (window.__dlg || []).join('\n'); const m = msg.match(/(\d+) staff will change status \((\d+) become overdue/);
    const audit = (L.state.auditLog || [])[0] || {};
    L.resetCourseInformation(); await sleep(150);
    return { changed, overdue, shown: m ? [+m[1], +m[2]] : null, auditAction: audit.action, auditNotes: String(audit.notes || '').slice(0, 160), preview }; });
  check('CRT-08a', 'confirm shows "N staff will change status (X become overdue)" matching the real recalculation', r.shown && r.shown[0] === r.changed && r.shown[1] === r.overdue && r.changed > 0, r);
  check('CRT-08b', 'renewal change is written to the audit log with its impact', /renewal/i.test(r.auditAction || '') && /staff will change status/.test(r.auditNotes), r); }

// ---------- ADM-04: backup import validation, confirmation, pre-restore copy, round trip ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const run = async (obj, name) => { await L.importData({ target: { files: [new File([typeof obj === 'string' ? obj : JSON.stringify(obj)], name || 'x.json', { type: 'application/json' })], value: '' } }); await sleep(300); };
    const n0 = L.state.docs.completions.length;
    window.__dlg = []; await run({ hello: 'world' }, 'junk.json');
    const junk = { n: L.state.docs.completions.length, msg: L.state.backupMsg, asked: window.__dlg.length };
    // a full backup round trip: compliance and record counts identical, pre-restore copy kept
    if (typeof L.backupPayload !== 'function') return { junk, n0, noBackupPayload: true };
    const sample = L._activeRosterMemo().slice(0, 300); const sig = () => sample.map(s => { const x = L.staffById(s.id); return ['CPR', 'FA', 'O1', 'ART'].map(c => L.effStatus(x, c)).join(''); }).join('|');
    const s0 = sig(), payload = JSON.parse(JSON.stringify(L.backupPayload()));
    window.__answers.confirm = false; window.__dlg = []; await run(payload, 'backup.json'); const cancelled = { asked: window.__dlg.length, preview: /Completions: \d+ now/.test(window.__dlg[0] || ''), msg: L.state.backupMsg };
    window.__answers.confirm = true; await run(payload, 'backup.json');
    const pre = await L._opsGet('preRestoreBackup');
    return { junk, n0, cancelled, n1: L.state.docs.completions.length, same: sig() === s0, pre: !!(pre && pre.payload && pre.payload.format === 'hasc-lms-backup'), inc: Object.keys(payload).filter(k => ['docs', 'operational', 'locReqProfiles', 'courseLibrary', 'store'].includes(k)).length, rosterN: payload.operational && payload.operational.roster.length, msg: L.state.backupMsg.slice(0, 120) }; });
  check('ADM-04a', 'non-LMS JSON is rejected without changing completions or asking to restore', r.junk && r.junk.n === r.n0 && /not an HASC LMS/i.test(r.junk.msg || '') && r.junk.asked === 0, r.junk);
  check('ADM-04b', 'restore shows what will be replaced and cancelling changes nothing', r.cancelled && r.cancelled.asked === 1 && r.cancelled.preview && /nothing was changed/i.test(r.cancelled.msg || ''), r.cancelled || r);
  check('ADM-04c', 'full export includes docs, roster/ops, location rules, course library and store; round trip is identical and a pre-restore copy is kept', r.inc === 5 && r.rosterN > 1000 && r.n1 === r.n0 && r.same && r.pre, r); }

// ---------- ADM-05: instructor rename carries sessions and survives reload without duplicates ----------
const ren = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
  const has = (s, n) => (s.instructor || '').split(',').map(x => x.trim()).includes(n);
  const it = L.state.instructors.find(i => L.state.sessions.some(s => has(s, i.fullName)) && /Tseytin/.test(i.fullName)) || L.state.instructors.find(i => L.state.sessions.some(s => has(s, i.fullName)));
  const old = it.fullName, nw = old + ' Jr', n = L.state.sessions.filter(s => has(s, old)).length;
  L.startEditInstructor(it.instructorId); await sleep(30); L.setState({ instrForm: { ...L.state.instrForm, fullName: nw } }); await sleep(30); L.saveInstructor(); await sleep(150);
  return { old, nw, id: it.instructorId, n, moved: L.state.sessions.filter(s => has(s, nw)).length, left: L.state.sessions.filter(s => has(s, old)).length }; });
check('ADM-05a', 'renaming an instructor moves their sessions to the new name', ren.n > 0 && ren.moved === ren.n && ren.left === 0, ren);

// ---------- ADM-06: a change made just before reload is not lost ----------
await ev(() => { const L = window.__hascLogic; L.setState({ instrForm: { fullName: 'Quick Save Person', email: '', phone: '', specialties: '', notes: '' } }); });
await wait(40); await ev(() => window.__hascLogic.addInstructor()); await wait(120);
await reload(); await dialogs();
{ const r = await ev(([old, nw]) => { const L = window.__hascLogic; const ids = L.state.instructors.map(i => i.instructorId); return { quick: L.state.instructors.some(i => i.fullName === 'Quick Save Person'), oldBack: L.state.instructors.filter(i => i.fullName === old).length, nw: L.state.instructors.filter(i => i.fullName === nw).length, dupIds: ids.length - new Set(ids).size }; }, [ren.old, ren.nw]);
  check('ADM-06', 'instructor added ~120 ms before reload is still there after reload', r.quick, r);
  check('ADM-05b', 'after reload the old name is not re-created and no instructor IDs are duplicated', r.oldBack === 0 && r.nw === 1 && r.dupIds === 0, r); }

// ---------- ADM-08: archive confirms with consequences; reactivation says what was not restored ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const s = L._activeRosterMemo().find(x => !(L.state.docs.archived || []).includes(x.id)); const n0 = (L.state.docs.archived || []).length;
    window.__answers.confirm = false; window.__dlg = []; L.setArchived(s.id, true); await sleep(100);
    const cancel = { n: (L.state.docs.archived || []).length, asked: window.__dlg[0] || '' };
    window.__answers.confirm = true; window.__dlg = []; L.setArchived(s.id, true); await sleep(100); const archivedN = (L.state.docs.archived || []).length;
    window.__dlg = []; L.setArchived(s.id, false); await sleep(100); const react = window.__dlg[0] || '';
    return { n0, cancel, archivedN, react: react.slice(0, 300), final: (L.state.docs.archived || []).length }; });
  check('ADM-08a', 'archive asks first, lists the consequences, and cancel changes nothing', r.cancel && r.cancel.n === r.n0 && /session seat/.test(r.cancel.asked) && /reminder/.test(r.cancel.asked) && r.archivedN === r.n0 + 1, r);
  check('ADM-08b', 'reactivation states that withdrawn seats/requests/assignments are not restored', /NOT restored/i.test(r.react || '') && r.final === r.n0, r); }

// ---------- IMP-05 / IMP-06: department-only active file with full-roster sync ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const arch = new Set((L.state.docs.archived || []).map(String));
    const sup = L._activeRosterMemo().filter(x => x.mgrId && L.staffById(x.mgrId) && L.isEmploymentActive(L.staffById(x.mgrId)) && !arch.has(String(x.mgrId)) && !x.supervisorPlaceholder);
    const pool = sup.slice(0, 60); const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const H = ['EmployeeNumber', 'LastName', 'FirstName', 'PositionTitle', 'SupervisorNumber', 'Email', 'HomeLocationCode', 'LoginLocationCode', 'Flag', 'DateOfHire', 'DisplayName'];
    const lines = [H.join(',')].concat(pool.map(x => { const [ln, fn] = String(x.name).split(',').map(s => s.trim()); return [x.id, ln, fn || 'X', x.pos, x.mgrId, '', x.loc, x.loc, 'A', x.h || '1/1/20', ''].map(q).join(','); }));
    L.setState({ archiveMissing: true }); await sleep(20);
    await L.importEmpeon({ target: { files: [{ name: 'intelex_active_dept.csv', text: async () => lines.join('\n') }] } });
    const p = L.state.pendingImport; const mgrChanges = p.updatedStaff.filter(u => (u.changes || []).some(c => c.key === 'mgrId')).length;
    const out = { profile: p.profileKey, cov: p.fullRosterCoverage, eligible: p.fullRosterEligible, archIds: p.archiveIds.length, mgrChanges };
    L.cancelImport(); L.setState({ archiveMissing: false }); await sleep(20); return out; });
  check('IMP-05a', 'partial active-only file (low coverage) cannot archive the rest of the roster', r.eligible === false && r.archIds === 0, r);
  check('IMP-06a', 'supervisors missing from a partial active-only file are not replaced by placeholders', r.mgrChanges === 0, r); }

// ---------- IMP-06 / IMP-13 / IMP-09: blank cells keep existing values; leading-zero IDs match ----------
const tgt = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
  const s = L._activeRosterMemo().find(x => x.mgrId && L.staffById(x.mgrId) && L.isEmploymentActive(L.staffById(x.mgrId)) && !x.supervisorPlaceholder && /^\d+$/.test(String(x.id)) && x.loc && x.pos);
  L.setState({ roster: L.state.roster.map(r => String(r.id) === String(s.id) ? { ...r, email: 'keep.me@hasccenter.org' } : r) }); await sleep(30);
  const [ln, fn] = String(s.name).split(',').map(v => v.trim());
  const row = (id) => 'Employee Number,Last Name,First Name,Status,Supervisor Number,Hire Date,Email,Position Title,Location\n' + id + ',"' + ln + '","' + (fn || 'X') + '",A,,,,' + '"' + s.pos + '","' + s.loc + '"';
  const run = async (id, name) => { await L.importEmpeon({ target: { files: [{ name, text: async () => row(id) }] } }); const p = L.state.pendingImport; const u = (p.updatedStaff || []).find(x => String(x.id) === String(s.id));
    const o = { created: (p.addActive || []).map(x => x.id), blocked: p.blockedCount, changes: u ? u.changes.map(c => c.key + ':' + c.from + '>' + c.to) : [], matched: !!u || (p.unchanged > 0) }; L.cancelImport(); await sleep(20); return o; };
  return { id: s.id, mgr: s.mgrId, exact: await run(String(s.id), 'blank_cells.csv'), zero: await run('0' + s.id, 'leading_zero.csv') }; });
check('IMP-09', 'ID with leading zero (0' + tgt.id + ') matches existing staff instead of creating a duplicate', tgt.zero && tgt.zero.created.length === 0 && tgt.zero.matched, tgt.zero || tgt);
check('IMP-06b', 'blank Supervisor cell keeps the existing valid supervisor', tgt.exact && tgt.exact.matched && !tgt.exact.changes.some(c => /^mgrId:/.test(c)), tgt.exact || tgt);
check('IMP-13', 'blank Email cell does not wipe the existing email', tgt.exact && tgt.exact.matched && !tgt.exact.changes.some(c => /^email:/.test(c)), tgt.exact || tgt);

// ---------- IMP-07: undoing a staff import keeps later training records; refuses when it would lose work ----------
{ const r = await ev(async (sid) => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const s = L.staffById(sid); const [ln, fn] = String(s.name).split(',').map(v => v.trim()); const oldPos = s.pos;
    const csv = 'Employee Number,Last Name,First Name,Status,Position Title,Location\n' + sid + ',"' + ln + '","' + (fn || 'X') + '",A,Undo Test Title,"' + s.loc + '"';
    await L.importEmpeon({ target: { files: [{ name: 'undo1.csv', text: async () => csv }] } }); await L.applyImport(); await sleep(400);
    const posAfter = L.staffById(sid).pos;
    L.analyzeTrainingImport('Employee ID,Course Code,Course Title,Completion Date\n' + sid + ',FA,First Aid,9/2/2026\n' + sid + ',CPR,CPR,9/3/2026', 't.csv');
    L.applyTrainingImport(); await sleep(300); const nComp = L.state.docs.completions.length, tb = (L.state.docs.importBatches || []).length;
    await L.undoLastStaffImport(); await sleep(500);
    const a = { posAfter, posUndone: L.staffById(sid).pos, oldPos, nComp, nAfter: L.state.docs.completions.length, kept: L.state.docs.completions.filter(c => String(c.staffId) === String(sid) && c.date === '9/2/26').length, tb, tbAfter: (L.state.docs.importBatches || []).length };
    // second import creates a person; a later completion for that person must block the undo
    const csv2 = 'Employee Number,Last Name,First Name,Status,Position Title,Location\n99990077,Zzundo,Newperson,A,DSP,"' + s.loc + '"';
    await L.importEmpeon({ target: { files: [{ name: 'undo2.csv', text: async () => csv2 }] } }); await L.applyImport(); await sleep(400);
    L.analyzeTrainingImport('Employee ID,Course Code,Course Title,Completion Date\n99990077,FA,First Aid,9/2/2026', 't2.csv'); L.applyTrainingImport(); await sleep(300);
    await L.undoLastStaffImport(); await sleep(400);
    a.refused = { stillThere: !!L.staffById('99990077'), msg: String(L.state.empeonMsg || '').slice(0, 200) };
    return a; }, tgt.id);
  check('IMP-07a', 'undo reverts the import but keeps training completions recorded afterwards', r.posAfter === 'Undo Test Title' && r.posUndone === r.oldPos && r.nAfter === r.nComp && r.kept === 1 && r.tbAfter === r.tb, r);
  check('IMP-07b', 'undo is refused with a clear message when it would orphan later training records', r.refused && r.refused.stillThere && /not available/i.test(r.refused.msg), r); }

// ---------- IMP-05b: high-impact archive requires a typed confirmation ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pool = L._activeRosterMemo().filter(x => /^\d+$/.test(String(x.id)) && x.loc).slice(100, 400); const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = ['Employee Number,Last Name,First Name,Status,Location'].concat(pool.map(x => { const [ln, fn] = String(x.name).split(',').map(s => s.trim()); return [x.id, ln, fn || 'X', 'Terminated', x.loc].map(q).join(','); }));
    await L.importEmpeon({ target: { files: [{ name: 'term.csv', text: async () => lines.join('\n') }] } });
    const p = L.state.pendingImport, n0 = (L.state.docs.archived || []).length;
    window.__answers.prompt = ''; window.__dlg = []; await L.applyImport(); await sleep(300);
    const typed = window.__dlg.some(m => /Type ARCHIVE \d+/.test(m)), n1 = (L.state.docs.archived || []).length; L.cancelImport(); window.__answers.prompt = null;
    return { planned: p.archiveIds.length, highRisk: p.archiveHighRisk, typed, n0, n1 }; });
  check('IMP-05b', 'archiving >10% of active staff needs a typed confirmation; a blank answer changes nothing', r.planned >= 250 && r.typed && r.n1 === r.n0, r); }

// ---------- IMP-11: unknown course code is flagged for review, not silently legacy ----------
{ const r = await ev((sid) => { const L = window.__hascLogic; L.analyzeTrainingImport('Employee ID,Course Code,Course Title,Completion Date\n' + sid + ',CRP,,9/1/2026\n' + sid + ',OLD101,Prior legacy training,6/15/18', 'codes.csv'); const rows = L.state.trainingImportRows; const out = rows.map(x => [x.code, x.status, x.reason.slice(0, 80)]); L.clearTrainingImport(); return out; }, tgt.id);
  check('IMP-11', 'typo code CRP is "Needs review" (suggesting CPR), not Ready as legacy', r[0] && r[0][1] !== 'Ready' && /CPR/.test(r[0][2]), r); }

// ---------- IMP-12 / QA-07: training import duplicates rechecked at apply; batch undo via voids ----------
{ const r = await ev(async () => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
    const ss = L._activeRosterMemo().filter(x => L.requiredFor(x, 'CPR') && L.effStatus(x, 'CPR') === 'r').slice(0, 3); const ids = ss.map(x => x.id);
    const before = ids.map(id => L.effStatus(L.staffById(id), 'CPR'));
    const csv = 'Employee ID,Course Code,Course Title,Completion Date\n' + ids.map(id => id + ',CPR,CPR,9/10/2026').join('\n');
    L.analyzeTrainingImport(csv, 'batch.csv'); const saved = L.state.trainingImportRows.map(x => ({ ...x }));
    L.applyTrainingImport(); await sleep(250); const n1 = L.state.docs.completions.length, mid = ids.map(id => L.effStatus(L.staffById(id), 'CPR'));
    L.setState({ trainingImportRows: saved }); await sleep(30); L.applyTrainingImport(); await sleep(250); const n2 = L.state.docs.completions.length;
    const batch = (L.state.docs.importBatches || []).find(b => b.type === 'training-records' && b.fileName === 'batch.csv');
    const voids0 = (L.state.docs.completionVoids || []).length;
    const ok = typeof L.undoTrainingImport === 'function' ? L.undoTrainingImport(batch.id) : false; await sleep(250);
    const after = ids.map(id => L.effStatus(L.staffById(id), 'CPR'));
    return { before, mid, after, n1, n2, voids: (L.state.docs.completionVoids || []).length - voids0, audit: ((L.state.auditLog || [])[0] || {}).action, undone: !!(L.state.docs.importBatches || []).find(b => b.id === batch.id && b.undoneAt) }; });
  check('QA-07a', 'applying the same analyzed rows twice does not duplicate completions', r.n2 === r.n1, r);
  check('IMP-12', 'undo of a training import voids its completions, restores statuses and is audited', r.mid && r.mid.every(x => x === 'g') && JSON.stringify(r.after) === JSON.stringify(r.before) && r.voids >= 3 && /undone/i.test(r.audit || '') && r.undone, r); }

// ---------- IMP-10: 1904 date-system workbook ----------
{ const b64 = fs.readFileSync('/home/user/HASC-LMS/work/scratch/import/t1904.xlsx').toString('base64');
  const r = await ev(async (b64) => { const L = window.__hascLogic; const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await L.importTrainingRecordFile({ target: { files: [new File([u], 't1904.xlsx')], value: '' } }); await new Promise(r => setTimeout(r, 200));
    const rows = (L.state.trainingImportRows || []).map(x => x.completed); L.clearTrainingImport(); return rows; }, b64);
  check('IMP-10', '1904-date-system serial 44804 reads as 9/1/26', Array.isArray(r) && r[0] === '9/1/26', r); }

// ---------- persistence after reload ----------
await wait(1200); await reload();
{ const r = await ev(() => { const L = window.__hascLogic; return { tb: (L.state.docs.importBatches || []).filter(b => b.type === 'training-records' && b.fileName === 'batch.csv' && b.undoneAt).length }; });
  check('RELOAD', 'training-import undo persisted across reload', r.tb === 1, r); }

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 600))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
