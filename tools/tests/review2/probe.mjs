import { boot, login } from '/home/user/HASC-LMS/tools/harness.mjs';
const FILE = process.argv[2] || (process.argv[2]||'/home/user/HASC-LMS/work/out_fix.html');
const { browser, page, errors } = await boot(FILE);
await login(page, 'admin');
const ev = (fn, a) => page.evaluate(fn, a);
const out = {};

// P1: reinstated void still hides the date from firstCompletionDate (ART anchor, CMP-07)
out.P1 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const st0 = L._activeRosterMemo().find(s => !L.isSDCH(s) && !L.isNurse(s) && L.requiredFor(s, 'ART') && ['O1', 'O2', 'O3'].every(c => s.dt && s.dt[c] && s.dt[c] !== '—') && L.compDateVal(s.dt.O1) > new Date(2021, 0, 1).getTime());
  const id = st0.id, sid = 'tst_p1', E = '3/2/20';
  L.setState({ sessions: [...L.state.sessions, { id: sid, code: 'O1', title: 'Orientation 1', date: 'Mon, Mar 2, 2020', when: 'Mon, Mar 2, 2020 · 9:00 AM–12:00 PM', where: 'Zoom', instructor: 'Sara Schwedelson', capacity: 10, roster: [{ staffId: id, waitlist: false }], certified: true, att: { [id]: 'present' }, pass: { [id]: true } }] });
  const docs = { ...L.state.docs, completions: [...L.state.docs.completions, { id: 'ccP1', staffId: String(id), course: 'O1', complianceCode: 'O1', sessionId: sid, date: E, source: 'In-person session', certGenerated: true }] };
  L.saveDocs(docs); L.setState({ roster: L.applyCompletionsToRoster(L.applyVoidsToRoster(L.state.roster, docs), docs) }); await sl(100);
  const fmt = d => d ? L.formatMDY(d) : null; const anc = () => { const a = L.artOrientationAnchor(L.staffById(id)); return a && a.date ? L.formatMDY(a.date) : null; };
  const f1 = fmt(L.firstCompletionDate(L.staffById(id), 'O1')), a1 = anc();
  L.correctCertifiedAttendance(sid, id, { pass: false }, 'fail'); await sl(100);
  const f2 = fmt(L.firstCompletionDate(L.staffById(id), 'O1'));
  L.correctCertifiedAttendance(sid, id, { pass: true }, 'retest pass'); await sl(100);
  const st = L.staffById(id); const f3 = fmt(L.firstCompletionDate(st, 'O1')), a3 = anc();
  return { id, dtO1: st0.dt.O1, afterAdd: f1, afterVoid: f2, afterReinstate: f3, isVoidedNow: L.isCompVoided(id, 'O1', E), transcriptHasE: !!L.buildTranscript(st).find(r => r.code === 'O1' && r.completed === E) || L.buildCompletionRecords([st]).some(r => r.code === 'O1' && r.date === E && !r.voided), anchorAfterAdd: a1, anchorAfterReinstate: a3 }; });

// P2: CRT-03 void-by-id then re-enter same date: firstCompletionDate ignores the valid re-entry
out.P2 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const st0 = L._activeRosterMemo().filter(s => !L.isSDCH(s) && !L.isNurse(s) && L.requiredFor(s, 'ART') && ['O1', 'O2', 'O3'].every(c => s.dt && s.dt[c] && s.dt[c] !== '—') && L.compDateVal(s.dt.O2) > new Date(2021, 0, 1).getTime())[5];
  const id = st0.id, E = '4/6/20'; const add = cid => { const docs = { ...L.state.docs, completions: [...L.state.docs.completions, { id: cid, staffId: String(id), course: 'O2', complianceCode: 'O2', date: E, source: 'Manual independent completion', certGenerated: true }] }; L.saveDocs(docs); L.setState({ roster: L.applyCompletionsToRoster(L.applyVoidsToRoster(L.state.roster, docs), docs) }); };
  add('cmP2a'); await sl(80);
  const rec = L.buildCompletionRecords([L.staffById(id)]).find(r => r.code === 'O2' && r.date === E && String(r.completionId) === 'cmP2a');
  L.setState({ modal: { type: 'void', rec, reason: 'wrong entry', ack: true } }); L.voidCompletion(); await sl(80);
  add('cmP2b'); await sl(80);
  const st = L.staffById(id);
  return { id, dtO2: st0.dt.O2, recsE: L.buildCompletionRecords([st]).filter(r => r.code === 'O2' && r.date === E).map(r => r.completionId + (r.voided ? ':V' : '')), firstO2: L.formatMDY(L.firstCompletionDate(st, 'O2') || new Date(0)), voidHasCid: (L.state.docs.completionVoids || [])[0].completionId };
});

// P3: training-import undo writes key-only voids -> also voids a separate later completion with the same key
out.P3 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const s = L._activeRosterMemo().filter(x => L.requiredFor(x, 'CPR') && L.effStatus(x, 'CPR') === 'r')[7]; const id = s.id;
  L.analyzeTrainingImport('Employee ID,Course Code,Course Title,Completion Date\n' + id + ',CPR,CPR,9/9/2026', 'p3.csv'); L.applyTrainingImport(); await sl(200);
  // later, a separate completion for the same course/date (e.g. the paper card is entered manually as an EMT card)
  const docs = { ...L.state.docs, completions: [...L.state.docs.completions, { id: 'cmP3emt', staffId: String(id), course: 'EMT', complianceCode: 'CPR+FA', satisfiedRequirements: ['CPR', 'FA'], displayCourseTitle: 'EMT Card', date: '9/9/26', expires: '9/9/28', source: 'External certificate (approved)', certGenerated: true }] };
  L.saveDocs(docs); L.setState({ roster: L.applyCompletionsToRoster(L.applyVoidsToRoster(L.state.roster, docs), docs) }); await sl(100);
  const before = { CPR: L.effStatus(L.staffById(id), 'CPR'), FA: L.effStatus(L.staffById(id), 'FA') };
  const b = (L.state.docs.importBatches || []).find(x => x.type === 'training-records' && x.fileName === 'p3.csv'); L.undoTrainingImport(b.id); await sl(200);
  const st = L.staffById(id); const emt = L.state.docs.completions.find(c => c.id === 'cmP3emt');
  return { id, before, after: { CPR: L.effStatus(st, 'CPR'), FA: L.effStatus(st, 'FA'), dtCPR: st.dt.CPR, dtFA: st.dt.FA }, emtVoided: L.isCompletionVoided(emt) };
});

// P4: instructor rename (W4) vs instructor access by name (W3)
out.P4 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const acct = L.ACCOUNTS.instructor[0]; const cnt = () => (L.state.sessions || []).filter(se => L.instructorCanAccessSession(se, { role: 'instructor', name: acct.name, assignedSessions: [] })).length;
  const n0 = cnt(); const it = (L.state.instructors || []).find(i => (i.fullName || '').toLowerCase() === acct.name.toLowerCase());
  if (!it) return { err: 'no instructor rec' };
  L.setState({ instrEdit: it.instructorId, instrForm: { fullName: 'Sara Schwedelson-Levi', email: it.email || '', phone: it.phone || '', specialties: it.specialties || '', notes: it.notes || '' } }); await sl(30); L.saveInstructor(); await sl(80);
  const n1 = cnt();
  // sign in through the real login form path
  L.signIn('instructor', acct); await sl(200); const cu = L.state.currentUser; const vis = (L.state.sessions || []).filter(se => L.instructorCanAccessSession(se)).length;
  L.signIn('admin', L.ACCOUNTS.admin[0]); await sl(100);
  return { accessBefore: n0, accessAfterRename: n1, loginName: cu && cu.name, visibleAfterLogin: vis, sessionsNowNamed: (L.state.sessions || []).filter(s => /Schwedelson-Levi/.test(s.instructor || '')).length };
});

// P5: cancelling a scheduled (future-dated) location rule also deletes the rule currently in effect
out.P5 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const st = L._activeRosterMemo().find(s => L.requiredFor(s, 'CPR') && s.dt && s.dt.CPR && L.getLocationIdForStaff(s) && !(L.state.locReqProfiles || {})[L.getLocationIdForStaff(s)]); const locId = L.getLocationIdForStaff(st);
  const save = (extra) => { L.setState({ locReqDraft: Object.assign({ locId, code: 'CPR', codes: ['CPR'], req: 'add', buckets: [], dueDays: '', intervalDays: '365', oneTime: false, renewAfterFirst: false, note: 'p5', effMode: 'now', effDate: '' }, extra) }); L._reasonDraft = 'p5 test'; L.saveLocReq(); };
  save({}); await sl(80); const s1 = L.locOverrideFor(L.staffById(st.id), 'CPR');
  save({ intervalDays: '1095', effMode: 'future', effDate: '12/1/26' }); await sl(80); const s2 = L.locOverrideFor(L.staffById(st.id), 'CPR');
  const raw = JSON.parse(JSON.stringify(L.state.locReqProfiles[locId].overrides.CPR));
  L.removeLocReqOverride(locId, 'CPR'); await sl(80); const s3 = L.locOverrideFor(L.staffById(st.id), 'CPR');
  const diag = null;
  return { locId, inEffectAfterNow: s1 && s1.intervalDays, inEffectAfterScheduling: s2 && s2.intervalDays, stored: { intervalDays: raw.intervalDays, future: raw.future, prevInterval: raw.prev && raw.prev.intervalDays }, inEffectAfterCancellingScheduled: s3 ? s3.intervalDays : null, audit: (L.state.auditLog || [])[0] && (L.state.auditLog[0].prev + ' -> ' + L.state.auditLog[0].next) };
});

// P6: rule diagnostic shows a scheduled rule as the location rule in effect
out.P6 = await ev(async () => { const L = window.__hascLogic; const sl = ms => new Promise(r => setTimeout(r, ms));
  const st = L._activeRosterMemo().find(s => L.requiredFor(s, 'CPR') && L.getLocationIdForStaff(s) && !(L.state.locReqProfiles || {})[L.getLocationIdForStaff(s)]); const locId = L.getLocationIdForStaff(st);
  L.setState({ locReqDraft: { locId, code: 'CPR', codes: ['CPR'], req: 'remove', buckets: [], dueDays: '', intervalDays: '', oneTime: false, note: 'p6', effMode: 'future', effDate: '12/1/26' } }); L._reasonDraft = 'p6'; L.saveLocReq(); await sl(80);
  const s = L.staffById(st.id); const d = L.ruleDiagnostic(s, 'CPR');
  const r = { required: L.requiredFor(s, 'CPR'), status: L.effStatus(s, 'CPR'), diagOverrideText: d && (d.ovText || d.overrideText), diagKeys: d && Object.keys(d).slice(0, 40) };
  L.removeLocReqOverride(locId, 'CPR'); return r; });

console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errors.filter(e => !/permissions policy|ERR_FAILED/.test(e)).slice(0, 8));
await browser.close();
