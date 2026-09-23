// Cross-tab persistence integrity suite (W6, IMP-08). Usage (from /home/user/HASC-LMS/tools):
//   node <worktree>/tools/tests/crosstab.test.mjs <build.html> [loops]
// Two admin tabs in ONE browser context (shared IndexedDB, each receives the other's `storage`
// events) make overlapping changes with varied timing; after both settle, a third fresh tab must
// show every change from both tabs, and the two working tabs must converge.
import { chromium } from '/home/user/HASC-LMS/tools/node_modules/playwright/index.mjs';
import path from 'node:path';
const FILE = path.resolve(process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html');
const LOOPS = Number(process.argv[3] || 5);
const OFFSETS = [0, 120, 350, 600, 900, 50, 250, 800];
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.route(/^https?:\/\//, r => r.abort());
const errors = [];
const open = async (name) => {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + FILE);
  await p.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 });
  await p.evaluate(() => { const L = window.__hascLogic; L.signIn('admin', L.ACCOUNTS.admin[0]); window.confirm = () => true; window.prompt = () => ''; window.alert = () => {}; });
  await p.waitForTimeout(1200); // startup seeding + first debounced persist
  return p;
};
const ev = (p, fn, arg) => p.evaluate(fn, arg).catch(e => ({ __err: String(e && e.message || e).slice(0, 300) }));
const fresh = async (q) => { const C = await open('C'); const r = await probe(C, q); await C.close(); return r; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SETTLE = 3000;

const A = await open('A'), B = await open('B');
// Staff used by the scenarios: active, distinct.
const staff = await ev(A, () => window.__hascLogic._activeRosterMemo().slice(40, 80).map(s => ({ id: String(s.id), name: s.name, loc: s.loc })));
const loc = staff[0].loc;

// Actions (run inside a tab).
const importStaff = (p, { id, file }) => ev(p, async ({ id, file, loc }) => { const L = window.__hascLogic;
  const csv = 'Employee Number,Last Name,First Name,Status,Location\n' + id + ',Crosstab,Person' + id + ',A,"' + loc + '"';
  await L.importEmpeon({ target: { files: [{ name: file, text: async () => csv }] } }); await L.applyImport(); return !!L.staffById(id); }, { id, file, loc });
const updateTitle = (p, { st, title, file }) => ev(p, async ({ st, title, file }) => { const L = window.__hascLogic; const [ln, fn] = String(st.name).split(',').map(v => v.trim());
  const csv = 'Employee Number,Last Name,First Name,Status,Position Title,Location\n' + st.id + ',"' + ln + '","' + (fn || 'X') + '",A,' + title + ',"' + st.loc + '"';
  await L.importEmpeon({ target: { files: [{ name: file, text: async () => csv }] } }); await L.applyImport(); return (L.staffById(st.id) || {}).pos; }, { st, title, file });
const audit = (p, tag) => ev(p, (tag) => { window.__hascLogic.logAudit('Crosstab ' + tag, { sev: 'Info', target: tag }); return true; }, tag);
const completion = (p, { sid, code, date, file }) => ev(p, async ({ sid, code, date, file }) => { const L = window.__hascLogic;
  L.analyzeTrainingImport('Employee ID,Course Code,Course Title,Completion Date\n' + sid + ',' + code + ',' + code + ',' + date, file); await new Promise(r => setTimeout(r, 30));
  const ready = (L.state.trainingImportRows || []).filter(r => r.status === 'Ready').length; L.applyTrainingImport(); return ready; }, { sid, code, date, file });
const editSession = (p, note) => ev(p, (note) => { const L = window.__hascLogic; const s = (L.state.sessions || [])[3]; L.setState(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, notes: note } : x) })); return s.id; }, note);
const voidOne = (p, { sid }) => ev(p, async ({ sid }) => { const L = window.__hascLogic; const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rec = L.buildCompletionRecords().find(r => String(r.staffId) === String(sid) && !r.voided && r.completionId); if (!rec) return { none: true };
  const before = new Set((L.state.docs.completionVoids || []).map(v => v.voidId));
  L.openVoidModal(rec.key, rec.completionId); await sleep(20); L.setState(s => ({ modal: { ...s.modal, reason: 'crosstab void', ack: true } })); await sleep(20); L.voidCompletion(); await sleep(20);
  return { ids: (L.state.docs.completionVoids || []).filter(v => !before.has(v.voidId)).map(v => v.voidId) }; }, { sid });
// State probes.
const probe = (p, q) => ev(p, (q) => { const L = window.__hascLogic; const d = L.state.docs;
  const has = (sid, code, date) => (d.completions || []).some(c => String(L.completionStaffId(c)) === String(sid) && L.completionComplianceCode(c) === code && L.compDateVal(L.completionDate(c)) === L.compDateVal(date));
  return { staff: (q.staff || []).map(id => !!L.staffById(id)), audits: (q.audits || []).map(t => (L.state.auditLog || []).some(e => e.target === t)),
    comps: (q.comps || []).map(c => has(c.sid, c.code, c.date)), voids: (q.voids || []).map(v => (d.completionVoids || []).some(x => x.voidId === v)),
    session: q.session ? ((L.state.sessions || []).find(s => s.id === q.session.id) || {}).notes === q.session.note : null,
    title: q.title ? (L.staffById(q.title) || {}).pos : null }; }, q);
const allTrue = r => r && !r.__err && [...r.staff, ...r.audits, ...r.comps, ...r.voids].every(Boolean) && r.session !== false;

const offset = (i, k) => OFFSETS[(i * 3 + k * 2) % OFFSETS.length];
for (let i = 0; i < LOOPS; i++) {
  // 1) IMP-08: A applies a staff import while B logs an audit entry (B first, then A after an offset).
  { const off = offset(i, 0), id = String(99991000 + i), file = 'xt_imp_' + i + '.csv', tag = 'B-audit-' + i;
    const pb = audit(B, tag); await sleep(off); const pa = importStaff(A, { id, file }); await Promise.all([pa, pb]); await sleep(SETTLE);
    const q = { staff: [id], audits: [tag, file] }; const c = await fresh(q), a = await probe(A, q), b = await probe(B, q);
    check('XT-1.' + i, 'staff import in A + audit entry in B (offset ' + off + 'ms): fresh tab shows the new staff and both audit entries; A and B converge', allTrue(c) && allTrue(a) && allTrue(b), { c, a, b }); }
  // 2) A adds a completion while B records a different completion and edits a session.
  { const off = offset(i, 1), sa = staff[2 + i], sb = staff[12 + i], date = '9/' + (1 + i) + '/2026', note = 'crosstab note ' + i;
    const pa = completion(A, { sid: sa.id, code: 'FA', date, file: 'xa' + i + '.csv' }); await sleep(off);
    const pb = (async () => { const r1 = await completion(B, { sid: sb.id, code: 'CPR', date, file: 'xb' + i + '.csv' }); await sleep(off / 3); const sid = await editSession(B, note); return { r1, sid }; })();
    const [ra, rb] = await Promise.all([pa, pb]); await sleep(SETTLE);
    const q = { comps: [{ sid: sa.id, code: 'FA', date }, { sid: sb.id, code: 'CPR', date }], session: { id: rb.sid, note } };
    const c = await fresh(q), a = await probe(A, q), b = await probe(B, q);
    check('XT-2.' + i, 'completion in A + completion and session edit in B (offset ' + off + 'ms): all three persist and both tabs converge', ra === 1 && rb.r1 === 1 && allTrue(c) && allTrue(a) && allTrue(b), { ra, rb, c, a, b }); }
  // 3) Same staff row edited in both tabs: the later change wins, and every tab agrees.
  { const off = offset(i, 2) + 300, st = staff[25 + (i % 10)], tA = 'XtTitleA' + i, tB = 'XtTitleB' + i;
    const pa = updateTitle(A, { st, title: tA, file: 'xta' + i + '.csv' }); await sleep(off); const pb = updateTitle(B, { st, title: tB, file: 'xtb' + i + '.csv' });
    await Promise.all([pa, pb]); await sleep(SETTLE);
    const q = { title: st.id }; const c = await fresh(q), a = await probe(A, q), b = await probe(B, q);
    check('XT-3.' + i, 'same staff row edited in A then B (' + off + 'ms later): B (the later change) wins everywhere', c.title === tB && a.title === tB && b.title === tB, { c: c.title, a: a.title, b: b.title }); }
  // 4) A voids a completion while B adds a completion for another staff member.
  { const off = offset(i, 3), sb = staff[22 + (i % 3)], date = '9/' + (10 + i) + '/2026';
    const vsid = await ev(A, (skip) => { const L = window.__hascLogic; const rec = L.buildCompletionRecords().find(r => !r.voided && r.completionId && !skip.includes(String(r.staffId))); return rec ? String(rec.staffId) : null; }, staff.map(s => s.id));
    const pb = completion(B, { sid: sb.id, code: 'CPR', date, file: 'xv' + i + '.csv' }); await sleep(off); const pa = voidOne(A, { sid: vsid });
    const [va, rb] = await Promise.all([pa, pb]); await sleep(SETTLE);
    const q = { voids: (va && va.ids) || ['(none)'], comps: [{ sid: sb.id, code: 'CPR', date }] }; const c = await fresh(q), a = await probe(A, q), b = await probe(B, q);
    check('XT-4.' + i, 'void in A + completion in B for another staff member (offset ' + off + 'ms): both persist and both tabs converge', va && va.ids && va.ids.length && rb === 1 && allTrue(c) && allTrue(a) && allTrue(b), { va, rb, c, a, b }); }
}
// Archived ids (array of primitives): A archives one person while B archives another.
{ const sa = staff[36], sb = staff[37];
  const arch = (p, id) => ev(p, (id) => window.__hascLogic.setArchived(id, true, { confirmed: true }), id);
  const pa = arch(A, sa.id); await sleep(150); const pb = arch(B, sb.id); await Promise.all([pa, pb]); await sleep(SETTLE);
  const q = p => ev(p, ([x, y]) => { const a = (window.__hascLogic.state.docs.archived || []).map(String); return [a.includes(x), a.includes(y)]; }, [sa.id, sb.id]);
  const C = await open('C'); const c = await q(C); await C.close(); const a = await q(A), b = await q(B);
  check('XT-6', 'staff archived in A and another archived in B: both stay archived everywhere', [...c, ...a, ...b].every(Boolean), { c, a, b }); }

// R3-01: B saves two completions while A's staff import is awaiting its saves; the import must not
// delete B's first completion when it commits (review3 e10b).
for (const [n, [startGap, gap]] of [[0, 100], [50, 150], [150, 250], [0, 50], [100, 200], [0, 250]].slice(0, Math.max(3, LOOPS)).entries()) {
  const id = String(99992000 + n), file = 'xt_r301_' + n + '.csv';
  const pImp = importStaff(A, { id, file }); await sleep(startGap);
  const ids = [];
  for (let k = 0; k < 2; k++) { ids.push(await ev(B, ({ sid, tag }) => { const L = window.__hascLogic, d = L.state.docs; const cid = tag + '-' + Date.now(); L.saveDocs({ ...d, completions: [...d.completions, { id: cid, staffId: sid, code: 'CPR', complianceCode: 'CPR', date: '9/8/2026', source: 'Manual Admin Entry' }] }); return cid; }, { sid: staff[5 + k].id, tag: 'xt-r301-' + n + '-' + k })); await sleep(gap); }
  await pImp; await sleep(SETTLE);
  const q = p => ev(p, ([ids, id]) => { const L = window.__hascLogic, c = L.state.docs.completions; return { comps: ids.map(x => c.some(y => y.id === x)), staff: !!L.staffById(id) }; }, [ids, id]);
  const C = await open('C'); const c = await q(C); await C.close(); const a = await q(A), b = await q(B);
  const ok = [c, a, b].every(r => r && r.staff && r.comps.every(Boolean));
  check('XT-7.' + n, 'B saves two completions during A\'s staff import (start ' + startGap + ' ms, gap ' + gap + ' ms): both completions and the new staff survive everywhere', ok, { c, a, b }); }

// R3-02: a backup restore (and its undo) after a cross-tab merge must not duplicate audit entries.
{ const dups = p => ev(p, () => { const m = new Map(); (window.__hascLogic.state.auditLog || []).forEach(e => { const k = JSON.stringify(e); m.set(k, (m.get(k) || 0) + 1); }); return [...m.values()].filter(v => v > 1).length; });
  // simultaneous changes in both tabs make each tab's next save a real merge
  for (let k = 0; k < 6; k++) { await Promise.all([audit(A, 'r302-a' + k), audit(B, 'r302-b' + k)]); await sleep(SETTLE); if (await ev(B, () => !!window.__hascLogic._opsAlt)) break; }
  const before = await dups(B);
  const res = await ev(B, async () => { const L = window.__hascLogic; const plan = L.backupRestorePlan(JSON.parse(JSON.stringify(L.backupPayload()))); if (plan.error) return plan.error; return L.applyBackupRestore(plan, 'xt'); });
  await sleep(SETTLE); const C = await open('C'); const afterC = await dups(C); await C.close(); const afterA = await dups(A);
  await ev(B, () => window.__hascLogic.undoLastRestore()); await sleep(SETTLE);
  const C2 = await open('C'); const undoC = await dups(C2); await C2.close();
  check('XT-8', 'backup restore and undo-restore after a cross-tab merge add no duplicate audit entries', res === true && afterC === before && afterA === before && undoC === before, { before, res, afterC, afterA, undoC }); }

// R3-03: the pagehide flush fired while this tab's previous debounced save is still committing must
// commit in its own transaction (a retry would not run while the page unloads).
{ const P = await ctx.newPage(); P.on('dialog', d => d.accept());
  await P.addInitScript(() => { window.__txlog = []; const o = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (k === 'operational') { const tx = this.transaction; if (!tx.__t) { tx.__t = 1; tx.addEventListener('complete', () => window.__txlog.push('complete')); tx.addEventListener('abort', () => window.__txlog.push('abort')); } } const r = o.call(this, v, k); if (k === 'operational' && window.__onPut) { const f = window.__onPut; window.__onPut = null; f(); } return r; }; });
  await P.goto('file://' + FILE); await P.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 }); await P.evaluate(() => { const L = window.__hascLogic; L.signIn('admin', L.ACCOUNTS.admin[0]); }); await sleep(1500);
  const runs = [];
  for (let n = 0; n < 4; n++) runs.push(await ev(P, async (n) => { const L = window.__hascLogic; window.__txlog = []; L.logAudit('XT inflight 1', { target: 'xt-if1-' + n });
    await new Promise(res => { window.__onPut = () => queueMicrotask(() => { L.logAudit('XT inflight 2', { target: 'xt-if2-' + n }); setTimeout(() => { L._flushPendingPersist(); res(); }, 0); }); L._flushPendingPersist(); });
    await new Promise(r => setTimeout(r, 1500)); const s = await L._opsGet('operational'); const has = t => (s.auditLog || []).some(e => e.target === t);
    return { tx: window.__txlog.slice(), stored: [has('xt-if1-' + n), has('xt-if2-' + n)] }; }, n));
  await P.close();
  check('XT-9', 'the unload flush during an in-flight save commits first time (no abort + retry) and both changes are stored', runs.every(r => r && r.tx && !r.tx.includes('abort') && r.stored.every(Boolean)), runs); }

// ADM-06 still holds with two tabs open: a change made shortly before a reload is flushed on pagehide.
for (const [n, d] of [40, 80, 150].entries()) {
  const pre = await ev(A, (t) => { const L = window.__hascLogic; L.logAudit('Crosstab flush', { target: t }); return { rev: L._opsRev, extra: !!L.__opsExtra, alt: !!L._opsAlt, hyd: L._hydratingOps }; }, 'xt-flush-' + n); await sleep(d);
  await A.reload(); await A.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 }); await sleep(1200);
  const a = await probe(A, { audits: ['xt-flush-' + n] }); check('XT-5.' + n, 'a change made ' + d + ' ms before reload is flushed (pagehide) while another tab is open', allTrue(a), { a, pre }); }

await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id + ' ' + r.name + (r.ok ? '' : '\n     ' + JSON.stringify(r.detail).slice(0, 700))); }
if (errors.length) console.log('page errors:', errors.slice(0, 5));
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
