// Scheduling / calendar regression suite (SCH-01..11). Runs in America/New_York, where HASC operates.
// Usage (from the main repo's tools/ so playwright resolves):
//   node <worktree>/tools/tests/scheduling.test.mjs <build.html>
// Calendar-import checks build synthetic HASC-style PDFs with pdf-lib and read them with a local
// PDF.js; both come from work/scratch/scheduling/node_modules (skipped with a FAIL if missing).
import { chromium } from '/home/user/HASC-LMS/tools/node_modules/playwright/index.mjs';
import { login } from '/home/user/HASC-LMS/tools/harness.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const FILE = path.resolve(process.argv[2] || '/home/user/HASC-LMS/work/out_fix.html');
const PDFDIR = '/home/user/HASC-LMS/work/scratch/scheduling/node_modules';
const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'America/New_York' });
await ctx.route(/^https?:\/\//, r => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
await page.goto('file://' + FILE);
await page.waitForFunction(() => window.__hascLogic && window.__hascLogic._dataReady, null, { timeout: 120000 });
await login(page, 'admin');
// A method missing on an older build becomes a FAIL line, not a crash.
const ev = (fn, arg) => page.evaluate(fn, arg).catch(e => ({ __error: String(e.message || e).slice(0, 200) }));

// ---------- SCH-01: ISO dates are local calendar dates ----------
{ const r = await ev(async () => {
    const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
    const pad = n => String(n).padStart(2, '0'), isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const t = new Date(), tm = new Date(t); tm.setDate(t.getDate() + 1);
    out.dec1 = L.sessionDateObj({ date: '2026-12-01' }).getDate();
    out.start = String(L.parseSessionStart({ date: '2026-12-01', when: 'Tue, Dec 1, 2026 · 9:00 AM–11:30 AM' }));
    out.todayUpcoming = L.isUpcomingSession({ date: isoOf(t) });
    const st = L._activeRosterMemo().find(s => !L.isSDCH(s));
    const tmS = { id: 'sch01tm', code: 'FA', title: 'First Aid', date: isoOf(tm), when: 'x · 9:00 AM–11:30 AM', where: 'Zoom', capacity: 30, instructor: '', roster: [{ staffId: String(st.id), waitlist: false }], att: { [st.id]: 'present' }, pass: { [st.id]: true }, certified: false };
    const isoS = { id: 'sch01iso', code: 'FA', title: 'First Aid', date: '2026-12-01', when: 'Tue, Dec 1, 2026 · 9:00 AM–11:30 AM', where: 'Zoom', capacity: 30, instructor: '', roster: [], att: {}, pass: {}, certified: false, calendarSourceKey: '2026-12' };
    L.setState({ sessions: [...L.state.sessions, tmS, isoS] }); await wait(50);
    L.certify('sch01tm'); await wait(100);
    out.tomorrowCertified = !!L.state.sessions.find(x => x.id === 'sch01tm').certified;
    const q0 = (L.state.notifQueue || []).length;
    L.startEditSession('sch01iso'); await wait(50); out.editIso = L.state.nsDate;
    L.setState({ nsCap: '25' }); await wait(20); L.addSession(); await wait(150);
    const s2 = L.state.sessions.find(x => x.id === 'sch01iso');
    out.after = { date: s2.date, day: L.sessionDateObj(s2).getDate(), cap: s2.capacity };
    out.resched = (L.state.notifQueue || []).slice(q0).filter(n => String(n.type || '').includes('resched')).length;
    return out; });
  check('SCH-01a', 'ISO 2026-12-01 is Dec 1 local (sessionDateObj, parseSessionStart)', r.dec1 === 1 && /Dec 01 2026 09:00/.test(r.start), r);
  check('SCH-01b', 'ISO session dated today is still upcoming (registration open)', r.todayUpcoming === true, r);
  check('SCH-01c', 'ISO session dated tomorrow cannot be certified today', r.tomorrowCertified === false, r);
  check('SCH-01d', 'edit round-trip keeps Dec 1 and sends no reschedule notice', r.editIso === '2026-12-01' && r.after.day === 1 && r.after.cap === 25 && r.resched === 0, r); }

// ---------- Calendar import (SCH-02/03/04/09) ----------
let calOk = fs.existsSync(PDFDIR + '/pdf-lib') && fs.existsSync(PDFDIR + '/pdfjs-dist/build/pdf.min.js');
const cal = {};
if (calOk) {
  const req = createRequire(PDFDIR + '/x.js'); const { PDFDocument, StandardFonts, rgb } = req('pdf-lib');
  const makeCal = async ({ year, month, headerText, footer, cells }) => {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const startWd = new Date(year, month - 1, 1).getDay(), maxDay = new Date(year, month, 0).getDate(), rows = [...Array(Math.ceil((startWd + maxDay) / 7)).keys()];
    const page = doc.addPage([792, 612]), x0 = 20, cw = 108, x1 = x0 + 7 * cw;
    page.drawText(headerText, { x: 300, y: 580, size: 20, font: bold });
    const hdrTop = 550, hdrH = 18, bottom = footer ? 70 : 30, rh = (hdrTop - hdrH - bottom) / rows.length, ys = [hdrTop, hdrTop - hdrH];
    rows.forEach((_, i) => ys.push(hdrTop - hdrH - (i + 1) * rh));
    for (let c = 0; c <= 7; c++) page.drawRectangle({ x: x0 + c * cw - 0.6, y: ys[ys.length - 1], width: 1.2, height: hdrTop - ys[ys.length - 1], color: rgb(0, 0, 0) });
    ys.forEach(y => page.drawRectangle({ x: x0, y: y - 0.6, width: x1 - x0, height: 1.2, color: rgb(0, 0, 0) }));
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d, i) => page.drawText(d, { x: x0 + i * cw + 40, y: hdrTop - 13, size: 10, font: bold }));
    rows.forEach((w, ri) => { const top = hdrTop - hdrH - ri * rh; for (let c = 0; c < 7; c++) { const day = 1 - startWd + w * 7 + c; if (day < 1 || day > maxDay) continue; page.drawText(String(day), { x: x0 + c * cw + 3, y: top - 11, size: 9, font: bold }); (cells[day] || []).forEach((t, li) => page.drawText(t, { x: x0 + c * cw + 4, y: top - 24 - li * 9, size: 7, font })); } });
    if (footer) page.drawText(footer, { x: 30, y: 50, size: 8, font });
    return Buffer.from(await doc.save()); };
  await page.addScriptTag({ path: PDFDIR + '/pdfjs-dist/build/pdf.min.js' });
  await ev(w => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = w; }, 'file://' + PDFDIR + '/pdfjs-dist/build/pdf.worker.min.js');
  const run = async (name, spec) => { const buf = await makeCal(spec); return ev(async ({ b64, name }) => {
    const L = window.__hascLogic, bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    L.setState({ calImportDraft: null, calImportError: '' });
    await L.importOfficialCalendarFile(new File([bin], name, { type: 'application/pdf' }));
    const d = L.state.calImportDraft;
    return { err: L.state.calImportError, month: d && d.monthLabel, sessions: d ? d.sessions.map(s => ({ day: s.day, key: s.key, time: s.time, assumed: !!s.timeAssumed, where: s.where })) : [] }; }, { b64: buf.toString('base64'), name }); };
  cal.footer = await run('training.pdf', { year: 2026, month: 12, headerText: 'December 2026', footer: 'Registration for January 2027 classes opens December 15.',
    cells: { 1: ['CPR In Person', '9 - 12'], 2: ['Orientation 1', '9 - 12'], 3: ['First Aid', '9 - 11:30'], 8: ['Dysphagia', '9 - 12'], 15: ['First Aid', '9 - 11:30'], 30: ['CPR In Person', '9 - 12'] } });
  cal.pm = await run('December 2026.pdf', { year: 2026, month: 12, headerText: 'December 2026',
    cells: { 1: ['Orientation 1', '7 - 9 PM', 'Via Zoom'], 2: ['Orientation 2', '7:30 - 9:30 PM', 'Via Zoom'], 3: ['Orientation 3', '8 - 10 PM', 'Via Zoom'], 4: ['First Aid', '7:00 PM - 9:30 PM', 'Via Zoom'], 7: ['Orientation 1', '7 - 9 AM', 'Via Zoom'] } });
  cal.loc = await run('December 2026.pdf', { year: 2026, month: 12, headerText: 'December 2026',
    cells: { 1: ['Orientation 1', '9 - 12', 'At East 14th St'], 2: ['CPR In Person', '9 - 12', 'Via Zoom'], 3: ['First Aid', '9 - 11:30', 'At 120 Ave M'], 4: ['First Aid', '9 - 11:30 Via 120 Ave M'], 8: ['Orientation 1 At East 14th St', '9 - 12'],
      13: ['Orientation 2', '10 AM - 12', 'Via Zoom', 'Orientation 3', '12:30 - 3', 'At East 14th St'] } });
  cal.multi = await run('February 2027.pdf', { year: 2027, month: 2, headerText: 'February 2027',
    cells: { 9: ['AMAP Day 1 - 2', '9:00 AM - 5:00 PM', 'At East 14th St'], 10: ['First Aid', '9 - 11:30', 'Via Zoom'] } });
  cal.multi2 = await run('February 2027.pdf', { year: 2027, month: 2, headerText: 'February 2027',
    cells: { 16: ['SCIP Day 1-2', '9 - 5', 'At 120 Ave M'] } });
}
{ const c = cal.footer || {};
  check('SCH-02', 'December PDF whose footer mentions January 2027 is detected as December with all 6 sessions on their days', calOk && c.month === 'December 2026' && c.sessions.length === 6 && c.sessions.some(s => s.day === 30 && s.key === 'CPR_IN_PERSON'), c); }
{ const c = cal.pm || {}; const t = d => (c.sessions || []).find(s => s.day === d) || {};
  check('SCH-03', '"7 - 9 PM"-style ranges import as PM with no "assumed" flag', calOk && t(1).time === '7:00 PM–9:00 PM' && t(2).time === '7:30 PM–9:30 PM' && t(3).time === '8:00 PM–10:00 PM' && t(4).time === '7:00 PM–9:30 PM' && t(7).time === '7:00 AM–9:00 AM' && [1, 2, 3].every(d => !t(d).assumed), c); }
{ const c = cal.loc || {}; const w = (d, k) => ((c.sessions || []).find(s => s.day === d && (!k || s.key === k)) || {}).where;
  check('SCH-04', 'location printed after the time is used', calOk && w(1) === 'East 14th Street' && w(2) === 'Zoom' && w(3) === '120 Avenue M' && w(4) === '120 Avenue M' && w(8) === 'East 14th Street' && w(13, 'O2') === 'Zoom' && w(13, 'O3') === 'East 14th Street', c); }
{ const a = cal.multi || {}, b = cal.multi2 || {};
  check('SCH-09', '"AMAP Day 1 - 2" / "SCIP Day 1-2" are reported, never imported as a 1:00–2:00 PM class', calOk && /multi-day/i.test(a.err || '') && /multi-day/i.test(b.err || '') && !(a.sessions || []).some(s => s.time === '1:00 PM–2:00 PM'), { a, b }); }

// ---------- SCH-06: re-upload keeps cancellations and admin edits; moved time is flagged ----------
{ const r = await ev(async () => {
    const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)), log = {};
    const ids = L._activeRosterMemo().slice(0, 12).map(s => String(s.id));
    const mk = (day, key, time, where) => { const iso = '2026-11-' + String(day).padStart(2, '0'); const def = L._calendarCourseDef(L.sessionCourse(key).label); return { day, iso, page: 1, title: def.title, key: def.key, code: def.code, where, time, start: time.split('–')[0], end: time.split('–')[1], dateLabel: new Date(2026, 10, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), sessionKey: iso + '|' + def.key + '|' + time.replace(/\s/g, '') + '|' + where.toLowerCase().replace(/\s+/g, ''), capacity: L._calendarCapacity(def.key, def.code), bbox: { left: 1, top: 1, width: 5, height: 5 } }; };
    const draft = sessions => ({ id: 'cal-2026-11', key: '2026-11', year: 2026, month: 11, monthLabel: 'November 2026', fileName: 'nov.pdf', pageCount: 1, gridPageCount: 1, zoomId: '', zoomLink: '', address: '', sessions, holidays: [], pages: [{ page: 1, width: 100, height: 100 }], previewUrls: [] });
    const pub = async d => { L.__calendarDraftAssets = [new Blob(['x'])]; L.setState({ calImportDraft: d }); await wait(30); await L.publishOfficialCalendar(); await wait(150); };
    const a = mk(10, 'SCIP1', '9:00 AM–5:00 PM', 'East 14th Street'), b = mk(12, 'CPR_IN_PERSON', '4:00 PM–7:00 PM', 'East 14th Street'), c = mk(17, 'FA', '9:00 AM–11:30 AM', 'Zoom');
    await pub(draft([a, b, c]));
    const find = k => L.state.sessions.find(s => s.calendarSourceSessionKey === k);
    const sa = find(a.sessionKey), sb = find(b.sessionKey), sc = find(c.sessionKey);
    L.setState({ sessions: L.state.sessions.map(s => s.id === sa.id ? { ...s, instructor: 'Sara Schwedelson', capacity: 12 } : s) }); await wait(20);
    L.registerStaff(sb.id, ids.slice(0, 6), {}); await wait(50);
    L.requestCancelSession(sc.id); L.setState({ cancelReason: 'instructor out' }); await wait(20); L.confirmCancelSession(); await wait(50);
    await pub(draft([a, b, c]));
    const sa2 = L.state.sessions.find(s => s.id === sa.id);
    log.v2 = { scipInstr: sa2.instructor, scipCap: sa2.capacity, faBack: L.state.sessions.filter(s => s.calendarSourceSessionKey === c.sessionKey).length, msg: L.state.calImportMsg };
    const b3 = { ...b, time: '5:00 PM–8:00 PM', start: '5:00 PM', end: '8:00 PM' }; b3.sessionKey = b3.iso + '|' + b3.key + '|' + b3.time.replace(/\s/g, '') + '|' + b3.where.toLowerCase().replace(/\s+/g, '');
    log.review = L._calendarRevisionIssues ? L._calendarRevisionIssues(draft([a, b3, c])) : [];
    L.setState({ calImportDraft: null });
    return log; });
  check('SCH-06a', 're-upload keeps admin-edited capacity and instructor', r.v2?.scipCap === 12 && r.v2?.scipInstr === 'Sara Schwedelson', r.v2);
  check('SCH-06b', 're-upload does not resurrect a cancelled class', r.v2?.faBack === 0, r.v2 || r);
  check('SCH-06c', 'approval review flags a moved time with registrants and the cancelled class', (r.review || []).some(t => /registrant/.test(t) && /5:00 PM/.test(t)) && (r.review || []).some(t => /cancelled/.test(t)), r.review); }

// ---------- SCH-07 / SCH-08 / SCH-10 / SCH-11 ----------
const fx = await ev(async () => {
  const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms));
  const st = L._activeRosterMemo().filter(s => !L.isSDCH(s)).slice(20, 24).map(s => String(s.id));
  const past = { id: 'sch07past', code: 'CPR', title: 'CPR In-Person', date: 'Wed, Jun 17, 2026', when: 'Wed, Jun 17, 2026 · 4:00 PM–7:00 PM', where: 'East 14th Street', capacity: 10, instructor: 'Sara Schwedelson', roster: [{ staffId: st[0], waitlist: false }, { staffId: st[1], waitlist: false }], att: { [st[0]]: 'present', [st[1]]: 'present' }, pass: { [st[0]]: true, [st[1]]: true }, certified: false };
  L.setState({ sessions: [...L.state.sessions, past] }); await wait(50); L.certify('sch07past'); await wait(150);
  return { st, certified: !!L.state.sessions.find(x => x.id === 'sch07past').certified }; });
await login(page, 'instructor');
{ const r = await ev(async () => { const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)); const n0 = (L.state.notifQueue || []).length;
    L.setState({ cancelModal: { sessionId: 'sch07past' }, cancelReason: 'x' }); L.confirmCancelSession(); await wait(100);
    return { live: !!L.state.sessions.find(x => x.id === 'sch07past'), notif: (L.state.notifQueue || []).length - n0 }; });
  check('SCH-07a', 'instructor cannot cancel a session', fx.certified && r.live && r.notif === 0, r); }
await login(page, 'admin');
{ const r = await ev(async () => { const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)); const n0 = (L.state.notifQueue || []).length, out = {};
    L.requestCancelSession('sch07past'); await wait(20); out.modal = !!L.state.cancelModal;
    L.setState({ cancelModal: { sessionId: 'sch07past' }, cancelReason: 'x' }); L.confirmCancelSession(); await wait(100);
    out.live = !!L.state.sessions.find(x => x.id === 'sch07past'); out.notif = (L.state.notifQueue || []).length - n0;
    L.setState({ editId: null, rescheduleSourceId: null, nsCode: 'FA', nsTitle: '', nsDate: '2026-12-09', nsStart: '9:00 AM', nsEnd: '11:30 AM', nsLocationChoice: 'Zoom', nsCustomLocation: '', nsInstr1: 'Sara Schwedelson', nsInstr2: '', nsCap: '5', nsStatus: 'Scheduled' }); L.addSession(); await wait(50);
    const fut = L.state.sessions[L.state.sessions.length - 1].id; L.requestCancelSession(fut); await wait(20); L.setState({ cancelReason: 'weather' }); L.confirmCancelSession(); await wait(100);
    out.futureCancelled = !L.state.sessions.find(x => x.id === fut) && !!(L.state.cancelledSessions || []).find(x => x.id === fut);
    return out; });
  check('SCH-07b', 'admin cannot cancel a certified past session; can cancel an upcoming one', !r.modal && r.live && r.notif === 0 && r.futureCancelled, r); }
{ const r = await ev(async ({ st }) => { const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
    L.startEditSession('sch07past'); await wait(30); L.setState({ nsDate: '2026-06-10' }); await wait(20); L.addSession(); await wait(100);
    const s = L.state.sessions.find(x => x.id === 'sch07past'); out.date = s.date; out.compDate = ((L.state.docs.completions || []).find(c => c.sessionId === 'sch07past') || {}).date;
    // uncertified future session: date edit refreshes request snapshots
    L.setState({ editId: null, rescheduleSourceId: null, nsCode: 'FA', nsTitle: '', nsDate: '2026-12-15', nsStart: '9:00 AM', nsEnd: '11:30 AM', nsLocationChoice: 'Zoom', nsCustomLocation: '', nsInstr1: 'Sara Schwedelson', nsInstr2: '', nsCap: '5', nsStatus: 'Scheduled' }); L.addSession(); await wait(50);
    const sid = L.state.sessions[L.state.sessions.length - 1].id; L.registerStaff(sid, [st[2]], {}); await wait(50);
    L.startEditSession(sid); await wait(30); L.setState({ nsDate: '2026-12-16' }); await wait(20); L.addSession(); await wait(100);
    const s2 = L.state.sessions.find(x => x.id === sid), rq = L.state.requests.find(x => x.sessionId === sid);
    out.req = { sessDate: s2.date, reqDate: rq && rq.sessionDate, reqTime: rq && rq.sessionTime, sessWhen: s2.when };
    return out; }, fx);
  check('SCH-08a', 'certified session date cannot be moved away from its completions', r.date === 'Wed, Jun 17, 2026' && r.compDate === '6/17/26', r);
  check('SCH-08b', 'date edit refreshes request snapshots', r.req?.reqDate === r.req?.sessDate && r.req?.reqTime === r.req?.sessWhen && /Dec 16/.test(r.req?.sessDate), r.req || r); }
{ const r = await ev(async ({ st }) => { const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
    const ids = L._activeRosterMemo().filter(s => !L.isSDCH(s)).slice(40, 44).map(s => String(s.id));
    const add = (iso, a, b, cap) => { L.setState({ editId: null, rescheduleSourceId: null, nsCode: 'FA', nsTitle: '', nsDate: iso, nsStart: a, nsEnd: b, nsLocationChoice: 'Zoom', nsCustomLocation: '', nsInstr1: 'Sara Schwedelson', nsInstr2: '', nsCap: String(cap), nsStatus: 'Scheduled' }); L.addSession(); return L.state.sessions[L.state.sessions.length - 1].id; };
    const a = add('2026-10-05', '9:00 AM', '11:30 AM', 2); await wait(30); const b = add('2026-10-05', '10:00 AM', '12:30 PM', 5); await wait(30); const c = add('2026-10-12', '9:00 AM', '11:30 AM', 5); await wait(30);
    L.registerStaff(a, ids, {}); await wait(80);
    out.before = L.state.sessions.find(s => s.id === a).roster.map(x => x.waitlist);
    L.startEditSession(a); await wait(20); L.setState({ nsCap: '3' }); await wait(20); L.addSession(); await wait(150);
    const sa = L.state.sessions.find(s => s.id === a); out.after = sa.roster.map(x => x.waitlist);
    out.promotedReq = L.state.requests.filter(r => r.sessionId === a && String(r.staffId) === ids[2]).map(r => r.status);
    const n0 = L.state.sessions.find(s => s.id === b).roster.length;
    L.registerStaff(b, [ids[0]], {}); await wait(80);
    out.overlapAdded = L.state.sessions.find(s => s.id === b).roster.length - n0;
    L.registerStaff(c, [ids[0]], {}); await wait(80);
    out.otherDayAdded = L.state.sessions.find(s => s.id === c).roster.length;
    return out; }, fx);
  check('SCH-10a', 'raising capacity promotes the first waitlisted staff member', JSON.stringify(r.before) === '[false,false,true,true]' && JSON.stringify(r.after) === '[false,false,false,true]' && (r.promotedReq || []).includes('enrolled'), r);
  check('SCH-10b', 'same person cannot be registered into an overlapping session of the same course (other days still allowed)', r.overlapAdded === 0 && r.otherDayAdded === 1, r); }
{ const r = await ev(async ({ st }) => { const L = window.__hascLogic, wait = ms => new Promise(r => setTimeout(r, ms)), out = {};
    L.correctCertifiedAttendance('sch07past', st[0], { present: 'absent' }, 'was not there'); await wait(100);
    const res = () => (L.state.sessions.find(x => x.id === 'sch07past').roster.find(x => String(x.staffId) === st[0]) || {}).result;
    out.afterAbsent = res(); out.reqAbsent = L.state.requests.filter(x => x.sessionId === 'sch07past' && String(x.staffId) === st[0]).map(x => x.status);
    // st[1]: absent, then corrected by recording Pass
    L.correctCertifiedAttendance('sch07past', st[1], { present: 'absent' }, 'x'); await wait(80);
    L.setState({ sessions: L.state.sessions.map(s => s.id === 'sch07past' ? { ...s, pass: { ...s.pass, [st[1]]: undefined } } : s) }); await wait(20);
    out.presentNoResult = L.correctCertifiedAttendance('sch07past', st[1], { present: 'present' }, 'was there');
    out.passOk = L.correctCertifiedAttendance('sch07past', st[1], { pass: true }, 'was there and passed'); await wait(100);
    const s = L.state.sessions.find(x => x.id === 'sch07past'); out.st1 = { att: s.att[st[1]], result: (s.roster.find(x => String(x.staffId) === st[1]) || {}).result };
    out.voidsForSt1 = (L.activeVoids ? L.activeVoids(L.state.docs) : (L.state.docs.completionVoids || [])).filter(v => v.sessionId === 'sch07past' && String(v.staffId) === st[1]).length;
    return out; }, fx);
  check('SCH-11a', 'roster result follows a post-certification correction', r.afterAbsent === 'no_show', r);
  check('SCH-11b', 'absent → present needs a result; recording Pass marks present/completed', r.presentNoResult === false && r.passOk === true && r.st1?.att === 'present' && r.st1?.result === 'completed' && r.voidsForSt1 === 0, r); }

const errs = errors.filter(e => !/permissions policy|ERR_FAILED|net::ERR/.test(e));
check('ERRORS', 'no page errors', errs.length === 0, errs.slice(0, 5));
await browser.close();
let fail = 0; for (const r of results) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id.padEnd(9) + r.name + (r.ok ? '' : '\n      ' + JSON.stringify(r.detail).slice(0, 900))); }
console.log(`\n${results.length - fail}/${results.length} passed`); process.exit(fail ? 1 : 0);
