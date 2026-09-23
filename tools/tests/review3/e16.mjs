// E16: genuine deletion, in tab A, of a row that tab B created (A received it via sync first). Must stay deleted.
// Covers: docs row (report template), docs id-set (un-archive a staff member B archived), docs log row (void entry B added -> A removes? n/a),
// ops row (session B added; A cancels -> moved to cancelledSessions), ops row delete (location B added; A deletes it).
import { ctxOpen, ev, sleep } from './lib.mjs';
const file = process.argv[2]; const WAIT = Number(process.argv[3] || 2500);
const { open, close, errors } = await ctxOpen(file);
const A = await open('A'), B = await open('B');
const sid = await ev(B, () => String(window.__hascLogic._activeRosterMemo()[900].id));
// B creates
await ev(B, (sid) => { const L = window.__hascLogic, d = L.state.docs;
  L.saveDocs({ ...d, reportTemplates: [...d.reportTemplates, { id: 'e16-tmpl', name: 'E16 template', type: 'compliance', cols: [] }], archived: [...d.archived, sid] });
  const s0 = L.state.sessions[0];
  L.setState(s => ({ sessions: [...s.sessions, { ...s0, id: 'e16-sess', title: 'E16 session', roster: [], waitlist: [] }], locations: [...s.locations, { id: 'e16-loc', name: 'E16 Loc', program: '', active: true }] })); }, sid);
await sleep(WAIT);
const seen = await ev(A, (sid) => { const L = window.__hascLogic; return { tmpl: L.state.docs.reportTemplates.some(x => x.id === 'e16-tmpl'), arch: L.state.docs.archived.map(String).includes(sid), sess: L.state.sessions.some(x => x.id === 'e16-sess'), loc: L.state.locations.some(x => x.id === 'e16-loc'), alts: [(L._docsAlt || []).length, (L._opsAlt || []).length] }; }, sid);
console.log('A received B rows:', JSON.stringify(seen));
// A deletes them (plain state updates, as the app's delete/cancel/unarchive handlers do)
await ev(A, (sid) => { const L = window.__hascLogic, d = L.state.docs;
  L.saveDocs({ ...d, reportTemplates: d.reportTemplates.filter(x => x.id !== 'e16-tmpl'), archived: d.archived.filter(x => String(x) !== sid) });
  L.setState(s => ({ sessions: s.sessions.filter(x => x.id !== 'e16-sess'), cancelledSessions: [...(s.cancelledSessions || []), { ...s.sessions.find(x => x.id === 'e16-sess'), cancelledAt: 'now' }], locations: s.locations.filter(x => x.id !== 'e16-loc') })); }, sid);
await sleep(3000);
const q = p => ev(p, (sid) => { const L = window.__hascLogic; return { tmplGone: !L.state.docs.reportTemplates.some(x => x.id === 'e16-tmpl'), unarchived: !L.state.docs.archived.map(String).includes(sid), sessGone: !L.state.sessions.some(x => x.id === 'e16-sess'), cancelled: (L.state.cancelledSessions || []).some(x => x.id === 'e16-sess'), locGone: !L.state.locations.some(x => x.id === 'e16-loc') }; }, sid);
console.log('A', JSON.stringify(await q(A)), 'B', JSON.stringify(await q(B)));
const C = await open('C'); console.log('fresh C', JSON.stringify(await q(C)));
console.log(errors.filter(e => /pageerror/.test(e)).slice(0, 3));
await close();
