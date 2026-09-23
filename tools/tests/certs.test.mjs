// Certificates / transcripts / expiration-display regression suite.
// Usage: node tools/tests/certs.test.mjs [build.html]   (baseline: /home/user/HASC-LMS/work/out.html)
// Each scenario drives the app's own write paths and checks what the transcript, the Completions
// list, the certificate resolver and the compliance engine report.
import { boot, login } from '/home/user/HASC-LMS/tools/harness.mjs';
const FILE = process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html';
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };
const { browser, page, errors } = await boot(FILE);
await login(page, 'admin');
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms = 150) => page.waitForTimeout(ms);
const safe = async (id, name, fn) => { try { await fn(); } catch (e) { check(id, name, false, 'threw: ' + String(e && e.message || e).slice(0, 300)); } };

// In-page helpers installed once.
await ev(() => {
  const L = window.__hascLogic;
  window.__t = {
    key: code => (L.sessionCourses().find(c => c.code === code && /PERSON|^FA$|^CPR$/i.test(c.key)) || L.sessionCourses().find(c => c.code === code)).key,
    indep(id, code, date, exp) { L.setState({ admStaff: id, compCourse: this.key(code), compDate: date, compExp: exp || '', compExpManual: !!exp, compNote: 'test' }); },
    rows(id, code) { const st = L.staffById(id); return L.buildTranscript(st).filter(r => r.code === code).map(r => ({ completed: r.completed, expires: r.expires, certId: r.certId, completionId: r.completionId, hasCert: r.hasCert })); },
    recs(id, code) { return L.buildCompletionRecords([L.staffById(id)]).filter(r => r.code === code).map(r => ({ date: r.date, expires: r.expires, voided: r.voided, certId: r.certId, completionId: r.completionId, hasCert: r.hasCert, key: r.key })); },
    voidRec(id, code, date, pick) { const all = L.buildCompletionRecords([L.staffById(id)]).filter(r => r.code === code && r.date === date && !r.voided); const rec = pick ? all.find(pick) : all[0]; if (!rec) return false; L.setState({ modal: { type: 'void', rec, reason: 'test void', ack: true } }); L.voidCompletion(); return true; },
    printed(fn) { const old = document.getElementById('__printRoot'); if (old) old.remove(); const op = L.openPreparedPrint; let html = null; L.openPreparedPrint = root => { html = root.innerHTML; }; try { fn(); } finally { L.openPreparedPrint = op; } return html; },
  };
});

// ---- fixtures ----
const fx = await ev(() => { const L = window.__hascLogic; const act = L._activeRosterMemo(); const comps = L.state.docs.completions || [];
  const backed = new Set(comps.map(c => L.completionStaffId(c) + '|' + L.completionComplianceCode(c) + '|' + L.completionDate(c)));
  const pick = (code, n, not = []) => act.filter(s => L.requiredFor(s, code) && L.effStatus(s, code) === 'g' && s.dt[code] && backed.has(String(s.id) + '|' + code + '|' + s.dt[code]) && L.compDateVal(s.dt[code]) < new Date(2026, 7, 1).getTime() && !not.includes(s.id)).slice(0, n).map(s => ({ id: s.id, dt: s.dt[code] }));
  const cpr = pick('CPR', 6); const fa = pick('FA', 6, cpr.map(x => x.id));
  return { cpr, fa }; });

// CRT-02: an older row keeps its own expiry after a newer completion with a manual expiry.
await safe('CRT-02', 'older transcript/Completions row shows its own expiry', async () => {
  const s = fx.cpr[0];
  await ev(([id]) => window.__t.indep(id, 'CPR', '9/1/26', '9/15/28'), [s.id]); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const r = await ev(([id, d]) => { const L = window.__hascLogic; const st = L.staffById(id); return { rows: window.__t.rows(id, 'CPR'), recs: window.__t.recs(id, 'CPR'), own: L.formatMDY(L.addYearsDate(d, 2)) }; }, [s.id, s.dt]);
  const oldRow = r.rows.find(x => x.completed === s.dt), oldRec = r.recs.find(x => x.date === s.dt), newRow = r.rows.find(x => x.completed === '9/1/26');
  check('CRT-02', 'older transcript/Completions row shows its own expiry', oldRow && oldRec && newRow && oldRow.expires !== '9/15/28' && oldRec.expires !== '9/15/28' && oldRow.expires === r.own && newRow.expires === '9/15/28', { s, r });
});

// CMP-09 / ADM-10 / CRT-11: location override drives the displayed expiration too.
await safe('CMP-09', 'location intervalDays / oneTime change displayed expiry like status', async () => {
  const s = fx.cpr[1];
  const r = await ev(async ([id]) => { const L = window.__hascLogic; const st = L.staffById(id); const locId = L.getLocationIdForStaff(st); const d = st.dt.CPR;
    const set = ov => { const profs = { ...(L.state.locReqProfiles || {}) }; profs[locId] = { ...(profs[locId] || {}), overrides: { ...((profs[locId] || {}).overrides || {}), CPR: ov } }; L.setState({ locReqProfiles: profs, locReqVer: (L.state.locReqVer || 0) + 1 }); };
    set({ req: 'add', intervalDays: 365 }); await new Promise(r => setTimeout(r, 100));
    const s1 = L.staffById(id); const a = { exp: L.expirationFor(s1, 'CPR', d), want: L.formatMDY(L.addYearsDate(d, 1)), st: L.effStatus(s1, 'CPR'), row: (L.buildTranscript(s1).find(r => r.code === 'CPR') || {}).expires };
    set({ req: 'add', oneTime: true }); await new Promise(r => setTimeout(r, 100));
    const s2 = L.staffById(id); const b = { exp: L.expirationFor(s2, 'CPR', d) };
    const profs = { ...(L.state.locReqProfiles || {}) }; delete profs[locId]; L.setState({ locReqProfiles: profs, locReqVer: (L.state.locReqVer || 0) + 1 });
    return { d, a, b }; }, [s.id]);
  check('CMP-09', 'location intervalDays / oneTime change displayed expiry like status', r.a.exp === r.a.want && r.a.row === r.a.want && r.b.exp === 'No expiration', r);
});

// CMP-10: status and displayed expiry use the same calendar-year rule (leap years, 2/29).
await safe('CMP-10', 'status and display agree across leap years; 2/29 -> 2/28', async () => {
  const r = await ev(() => { const L = window.__hascLogic; const t = L.todayDate(); const d3 = (t.getMonth() + 1) + '/' + t.getDate() + '/' + String(t.getFullYear() - 3).slice(2);
    const st = { id: 'x', dt: {}, rec: {}, expOverride: {} };
    return { d3, exp3: L.expirationFor(st, 'DD', d3), s3: L.statusFromDate(d3, 1095), leap: L.expirationFor(st, 'ART', '2/29/24'), leapS: L.statusFromDate('2/29/24', 365), ext: L.addYears('2/29/24', 2), calc: L.calcExpiry('CPR', '2/29/24') }; });
  // Expires today (both sides): status must be due-soon, not overdue.
  check('CMP-10', 'status and display agree across leap years; 2/29 -> 2/28', r.s3 === 'o' && r.leap === '2/28/25' && r.ext === '2/28/26' && r.calc === '2/28/26', r);
});

// CMP-08: an admin-configured renewal flows to every expiration writer; EPP stays one-time by default.
await safe('CMP-08', 'configured EPP renewal reaches independent rule + display; default one-time', async () => {
  const s = fx.cpr[2];
  const r = await ev(async ([id]) => { const L = window.__hascLogic; const st = L.staffById(id);
    const before = { rule: L.independentCourseExpiryRule('EPP', id).kind, exp: L.expirationFor(st, 'EPP', '8/1/25') };
    L.setState({ ciCode: 'EPP', ciRenewMode: 'annual', ciDesc: '', ciNotes: '', ciAfterFirst: false }); L.saveCourseInformation(); await new Promise(r => setTimeout(r, 100));
    const after = { rule: L.independentCourseExpiryRule('EPP', id).kind, indep: L.independentExpirationFor('EPP', '8/1/26', id), exp: L.expirationFor(L.staffById(id), 'EPP', '8/1/25') };
    L.setState({ ciCode: 'EPP' }); L.resetCourseInformation(); await new Promise(r => setTimeout(r, 100));
    return { before, after }; }, [s.id]);
  check('CMP-08', 'configured EPP renewal reaches independent rule + display; default one-time', r.before.rule === 'none' && r.before.exp === 'No expiration' && r.after.rule === 'timed' && r.after.indep === '8/1/27' && r.after.exp === '8/1/26', r);
});

// CRT-03: a completion re-entered after a void is visible everywhere.
await safe('CRT-03', 'void then re-enter same course/date: one voided + one active row, transcript row, cert', async () => {
  const s = fx.fa[0];
  await ev(([id]) => window.__t.indep(id, 'FA', '9/1/26', '9/1/29'), [s.id]); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  await ev(([id]) => window.__t.voidRec(id, 'FA', '9/1/26'), [s.id]); await wait();
  await ev(([id]) => window.__t.indep(id, 'FA', '9/1/26'), [s.id]); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const r = await ev(([id]) => { const L = window.__hascLogic; const st = L.staffById(id); const recs = window.__t.recs(id, 'FA').filter(x => x.date === '9/1/26'); const rows = window.__t.rows(id, 'FA').filter(x => x.completed === '9/1/26');
    const html = window.__t.printed(() => L.printOneCert(id, 'FA', '9/1/26')); return { dt: st.dt.FA, eff: L.effStatus(st, 'FA'), recs, rows, printed: !!html, exp: L.expirationFor(st, 'FA', st.dt.FA) }; }, [s.id]);
  check('CRT-03', 'void then re-enter same course/date: one voided + one active row, transcript row, cert', r.dt === '9/1/26' && r.recs.filter(x => x.voided).length === 1 && r.recs.filter(x => !x.voided).length === 1 && r.rows.length === 1 && r.printed && r.exp === '9/1/28', r);
});

// CRT-05 / STF-03: the printed certificate uses the completion being printed; one ID everywhere.
await safe('CRT-05', 'printed cert ID/dates come from the row, and match card/transcript/list', async () => {
  const s = fx.fa[1];
  await ev(([id]) => { const L = window.__hascLogic; L.setState({ admStaff: id, xcCourse: 'FA', xcDate: '1/5/20', xcExp: '', xcFile: 'data:application/pdf;base64,AA==', xcFileName: 'old-fa.pdf', xcNote: '' }); }, [s.id]); await wait();
  await ev(() => window.__hascLogic.recordExtCertDirect()); await wait();
  const r = await ev(([id, d]) => { const L = window.__hascLogic; const st = L.staffById(id); const row = L.buildTranscript(st).find(x => x.code === 'FA' && x.completed === d); const rec = L.buildCompletionRecords([st]).find(x => x.code === 'FA' && x.date === d && !x.voided);
    const facts = L.certFacts(st, 'FA', d, row && row.completionId ? L.completionRecordById(row.completionId) : null); const html = window.__t.printed(() => L.printOneCert(id, 'FA', d)) || '';
    const ext = (L.state.docs.extCerts || []).filter(x => String(x.staffId) === String(id)).slice(-1)[0];
    return { rowId: row && row.certId, recId: rec && rec.certId, factsId: facts.certId, meta: facts.meta, extId: ext && ext.id, printedHasExt: !!(ext && html.includes(ext.id)), printedHasOldDate: html.includes('1/5/20') }; }, [s.id, s.dt]);
  check('CRT-05', 'printed cert ID/dates come from the row, and match card/transcript/list', r.rowId && r.rowId === r.recId && r.rowId === r.factsId && !r.printedHasExt && !r.printedHasOldDate, r);
});

// CRT-06: two completions whose dates share digits (1/12/25, 11/2/25) get different, stable IDs.
await safe('CRT-06', 'colliding legacy certificate numbers are made unique and stay stable', async () => {
  const s = fx.fa[2];
  const before = await ev(([id, d]) => (window.__t.recs(id, 'FA').find(x => x.date === d) || {}).certId, [s.id, s.dt]);
  for (const d of ['11/2/25', '1/12/25']) { await ev(([id, d]) => window.__t.indep(id, 'FA', d), [s.id, d]); await wait(); await ev(() => window.__hascLogic.recordCompletion()); await wait(); }
  const r = await ev(([id, d]) => { const recs = window.__t.recs(id, 'FA'), rows = window.__t.rows(id, 'FA'); const g = (l, k, v) => (l.find(x => x[k] === v) || {}).certId; return { a: g(recs, 'date', '11/2/25'), b: g(recs, 'date', '1/12/25'), cur: g(recs, 'date', d), ra: g(rows, 'completed', '11/2/25'), rb: g(rows, 'completed', '1/12/25') }; }, [s.id, s.dt]);
  check('CRT-06', 'colliding legacy certificate numbers are made unique and stay stable', r.a && r.b && r.a !== r.b && r.cur === before && r.ra === r.a && r.rb === r.b, { before, r });
});

// CRT-07 + R1-02: an online retake is appended (history + new cert number) and runs the replay.
await safe('CRT-07', 'online retake appends a new completion with its own certificate number', async () => {
  const s = fx.cpr[3];
  const r = await ev(([id]) => { const L = window.__hascLogic;
    L.postOnlineCompletion({ staffId: id, code: 'ART', displayTitle: 'ART Online', date: '9/1/25', version: 1, courseId: 'ocTest', certId: 'CERT-ocTest-v1-' + id });
    L.postOnlineCompletion({ staffId: id, code: 'ART', displayTitle: 'ART Online', date: '9/20/26', version: 1, courseId: 'ocTest', certId: 'CERT-ocTest-v1-' + id });
    const mine = (L.state.docs.completions || []).filter(c => String(c.staffId) === String(id) && c.courseId === 'ocTest');
    return { n: mine.length, ids: mine.map(c => c.certId), dates: mine.map(c => c.date) }; }, [s.id]);
  check('CRT-07', 'online retake appends a new completion with its own certificate number', r.n === 2 && r.ids[0] !== r.ids[1] && r.dates.includes('9/1/25'), r);
});
await safe('R1-02', 'online completion clears a stale manual override (single replay)', async () => {
  const s = fx.cpr[4];
  await ev(([id]) => window.__t.indep(id, 'CPR', '9/5/24', '10/1/26'), [s.id]); await wait();
  await ev(() => window.__hascLogic.recordCompletion()); await wait();
  const r = await ev(([id]) => { const L = window.__hascLogic; const t = L.formatMDY(L.todayDate());
    L.postOnlineCompletion({ staffId: id, code: 'CPR', displayTitle: 'CPR Online', date: t, version: 1, courseId: 'ocCPR' });
    const st = L.staffById(id); return { dt: st.dt.CPR, eo: (st.expOverride || {}).CPR || null, st: L.effStatus(st, 'CPR'), t }; }, [s.id]);
  check('R1-02', 'online completion clears a stale manual override (single replay)', r.dt === r.t && !r.eo && r.st === 'g', r);
});

// CRT-09: turning a course certificate off only affects completions recorded afterwards.
await safe('CRT-09', 'certificate toggle affects future completions only', async () => {
  const s = fx.cpr[5];
  const r = await ev(async ([id]) => { const L = window.__hascLogic; const count = () => L.buildCompletionRecords().filter(x => x.code === 'CPR' && x.hasCert).length;
    const before = count(); const cfgOn = L.issuesCertificate('CPR'); L.toggleCourseCert('CPR'); await new Promise(r => setTimeout(r, 100));
    const after = count(); window.__t.indep(id, 'CPR', '9/10/26'); await new Promise(r => setTimeout(r, 100)); L.recordCompletion(); await new Promise(r => setTimeout(r, 100));
    const fresh = L.buildCompletionRecords([L.staffById(id)]).find(x => x.code === 'CPR' && x.date === '9/10/26');
    L.toggleCourseCert('CPR'); await new Promise(r => setTimeout(r, 100));
    return { cfgOn, before, after, freshCert: fresh && fresh.hasCert }; }, [s.id]);
  check('CRT-09', 'certificate toggle affects future completions only', r.cfgOn && r.before === r.after && r.freshCert === false, r);
});

// CRT-10: every direct print/open path refuses a voided completion.
await safe('CRT-10', 'print/open functions refuse voided completions', async () => {
  const s = fx.fa[3];
  await ev(([id, d]) => window.__t.voidRec(id, 'FA', d), [s.id, s.dt]); await wait();
  const r = await ev(([id, d]) => { const L = window.__hascLogic; const rec = L.buildCompletionRecords([L.staffById(id)]).find(x => x.code === 'FA' && x.date === d && x.voided);
    const a = window.__t.printed(() => L.printOneCert(id, 'FA', d)); const b = window.__t.printed(() => L.printCertificateRow(id, 'FA', d, rec && rec.completionId)); const c = rec && rec.completionId ? window.__t.printed(() => L.printCompletionCert(rec.completionId)) : null;
    L.setState({ modal: null }); L.openCertFor(id, 'FA', rec && rec.completionId, d); const opened = !!(L.state.modal && L.state.modal.type === 'cert'); L.setState({ modal: null });
    return { voided: !!rec, a: !!a, b: !!b, c: !!c, opened }; }, [s.id, s.dt]);
  check('CRT-10', 'print/open functions refuse voided completions', r.voided && !r.a && !r.b && !r.c && !r.opened, r);
});

// CRT-12: correcting attendance back to Pass appends a reinstatement instead of deleting the void.
await safe('CRT-12', 'attendance correction to Pass keeps void history (append-only)', async () => {
  const s = fx.fa[4];
  const r = await ev(async ([id]) => { const L = window.__hascLogic; const sid = 'tst_crt12';
    L.setState({ sessions: [...L.state.sessions, { id: sid, code: 'FA', title: 'First Aid', date: 'Tue, Sep 15, 2026', when: 'Tue, Sep 15, 2026 · 9:00 AM–12:00 PM', where: 'East 14th Street', instructor: 'Sara Schwedelson', capacity: 10, roster: [{ staffId: id, waitlist: false }], certified: true, att: { [id]: 'present' }, pass: { [id]: true } }] });
    const docs = { ...L.state.docs, completions: [...L.state.docs.completions, { id: 'ccT12', staffId: String(id), course: 'FA', complianceCode: 'FA', sessionId: sid, date: '9/15/26', source: 'In-person session', certGenerated: true }] }; L.saveDocs(docs);
    await new Promise(r => setTimeout(r, 100));
    L.correctCertifiedAttendance(sid, id, { pass: false }, 'failed skills check'); await new Promise(r => setTimeout(r, 100));
    const n1 = (L.state.docs.completionVoids || []).length, v1 = L.isCompVoided(id, 'FA', '9/15/26');
    L.correctCertifiedAttendance(sid, id, { pass: true }, 'retest passed'); await new Promise(r => setTimeout(r, 100));
    const voids = L.state.docs.completionVoids || []; const st = L.staffById(id);
    return { n1, v1, n2: voids.length, stillThere: voids.some(v => v.key === String(id) + '|FA|9/15/26' && v.voidId && v.type !== 'reinstated'), v2: L.isCompVoided(id, 'FA', '9/15/26'), dt: st.dt.FA, row: !!L.buildTranscript(st).find(x => x.code === 'FA' && x.completed === '9/15/26') }; }, [s.id]);
  check('CRT-12', 'attendance correction to Pass keeps void history (append-only)', r.v1 && r.n2 > r.n1 && r.stillThere && !r.v2 && r.dt === '9/15/26' && r.row, r);
});

// R1-10: the transcript replay holds future-dated completions like the compliance engine.
await safe('R1-10', 'transcript ignores future-dated completions and computed (non-override) expiries', async () => {
  const s = fx.cpr[0];
  const r = await ev(async ([id]) => { const L = window.__hascLogic; const st0 = L.staffById(id); const cur = st0.dt.PA;
    const docs = { ...L.state.docs, completions: [...L.state.docs.completions, { id: 'cmFut', staffId: String(id), course: 'PA', complianceCode: 'PA', date: '12/1/26', source: 'test', expires: 'No expiration' }] }; L.saveDocs(docs); await new Promise(r => setTimeout(r, 100));
    const t = L.transcriptStaff(L.staffById(id)); return { cur: cur || null, tdt: t.dt.PA || null }; }, [s.id]);
  check('R1-10', 'transcript ignores future-dated completions and computed (non-override) expiries', r.tdt === r.cur, r);
});

// R1-05: legacy "CPR+FA" EMT records: no combined transcript row, and voiding CPR clears it.
await safe('R1-05', 'legacy CPR+FA EMT record: no combined row; CPR void reverts transcript', async () => {
  const s = fx.fa[5];
  const r = await ev(async ([id]) => { const L = window.__hascLogic;
    const comp = { id: 'cmEMT', staffId: String(id), course: 'EMT', complianceCode: 'CPR+FA', satisfiedRequirements: ['CPR', 'FA'], displayCourseTitle: 'EMT Card', date: '9/12/26', expires: '9/12/28', source: 'Admin direct external certificate', certId: 'ecEMT', certGenerated: true };
    const docs = { ...L.state.docs, completions: [...L.state.docs.completions, comp] }; const roster = L.applyCompletionsToRoster(L.applyVoidsToRoster(L.state.roster, docs), docs); L.saveDocs(docs); L.setState({ roster }); await new Promise(r => setTimeout(r, 100));
    const st = L.staffById(id); const combined = L.buildTranscript(st).filter(x => x.code === 'CPR+FA').length;
    window.__t.voidRec(id, 'CPR', '9/12/26'); await new Promise(r => setTimeout(r, 100));
    const st2 = L.staffById(id); const cprRow = L.buildTranscript(st2).find(x => x.code === 'CPR' && x.completed === '9/12/26');
    return { combined, cprAfter: st2.dt.CPR, cprRow: !!cprRow }; }, [s.id]);
  check('R1-05', 'legacy CPR+FA EMT record: no combined row; CPR void reverts transcript', r.combined === 0 && r.cprAfter !== '9/12/26' && !r.cprRow, r);
});

const errs = errors.filter(e => !e.includes('permissions policy') && !e.includes('ERR_FAILED'));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(8) + ' ' + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 700)));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
