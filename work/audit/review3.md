# Review 3: adversarial review of IMP-08 cross-tab merge persistence (commit 330d9cc)

**Build under test:** `work/out_review3.html`, a frozen copy of `out_fix.html`. It is byte-identical to a rebuild of the current `work/template.html`.
**Comparison builds:**
- `work/scratch/review3/out_pre.html`: `template.html` at `330d9cc^`, the build just before this change, rebuilt with `tools/bundle.py`. This is the "old code" for regression purposes.
- `work/out.html`: the original shipped baseline.

**Scripts:** `work/scratch/review3/e*.mjs`. Run them from `tools/` with `node ../work/scratch/review3/<e>.mjs <build> [args]`. The shared two-tab helper is `lib.mjs`: all tabs are in one browser context, so they share IndexedDB and receive each other's `storage` events.

## Verdict

**Yes, there is a data-loss regression (R3-01, Critical).** A staff import that is running while the tab takes in two saves from another tab permanently deletes the other tab's training completions from IndexedDB. With natural timing (no stubs), this happened in 7 of 8 runs on the fix. It happened in 0 of 4 runs on the previous build and 0 of 2 runs on the baseline.

There are two further regressions:
- **R3-02 (High, corruption):** a backup restore after a cross-tab merge duplicates the audit log.
- **R3-03 (Medium):** a narrow single-tab loss when a tab closes while its own previous write is still committing.

Everything else I tried held up:
- all single-tab save paths
- the merge semantics
- storage failures
- ping storms
- upgrade from older data
- performance

---

## R3-01: The staff import's stale docs snapshot deletes the other tab's completions from storage. Critical, VERIFIED-RUNTIME, REGRESSION

- **Where:** Admin → Staff Import. The import is `applyImport` (template.html ~12375). Staff-import undo, `undoLastStaffImport` (~12419), has the same pattern (VERIFIED-CODE). The engine code involved is `_docsAdopt` (~8732), `_docsTryPut` (~8705) and `_xtMergeRows` (~12811).
- **What happens:**
  1. `applyImport` builds `docs` from `this.state.docs`, then awaits several steps: the `lastStaffImportUndo` put, the HASCStore lifecycle, `_persistDocsNow`, and `_opsPut('operational')`.
  2. At the end it calls `setState({docs})` with that captured snapshot.
  3. If tab B saves docs twice during those awaits (for example, two completions), tab A takes in both saves, one at a time.
  4. The second take-in goes through `_docsAdopt`'s rebase: `_docsMerge(local, null, cur, merged)`. At that point `cur` is the stale import snapshot, which lacks B's first completion, while `local` has it. The merge reads the missing row as "deleted in this tab".
  5. The rebased docs are then written with `alt` set to the previous value, so `delLocal` is true for that row. **B's first completion is deleted from storage for every tab**, and B's own tab drops it on its next sync.
- **Why `alt` does not prevent it:** `alt` only covers the *latest* take-in. Rows that came in through an earlier take-in are in both `base` and `alt`, so their absence from the stale snapshot counts as a deletion.
- **Evidence** (`e10b.mjs <build> 0 2 <startGap> <gap>`: A imports one new staff member while B saves completion 0 and then completion 1):

  | Build | Result in a fresh tab C |
  |---|---|
  | fix | `comps: [false, true]` in 7 of 8 runs (start gaps 0/50/150 ms, gaps 100/150/250 ms) |
  | pre (`out_pre.html`) | `[true, true]` in 4 of 4 runs |
  | baseline `out.html` | `[true, true]` in 2 of 2 runs |

  With a 3 s storage delay injected (`e10.mjs`), the fix loses every completion except the last one: `[false,false,true]`.

  The old code kept these completions because it wrote only the docs fields whose identity changed. The import does not touch `completions`, so that field was never rewritten.

  Trace from tab A (`e10c.mjs`):
  ```
  adopt state=[] local=[e10-B-0-] merged=[e10-B-0-,e10-B-1-]
    adopt -> rebased=true next=[e10-B-1-]          <- B-0 treated as a local deletion
  tryPut opt=true local=[e10-B-1-] base=[e10-B-0-,e10-B-1-] alt=[e10-B-0-]
    -> wrote=true merged=[e10-B-1-]               <- B-0 deleted from IndexedDB
  ```
- **Expected:** A's import must not remove rows it never touched, and must not remove rows that other tabs added.
- **Fix, in two parts; do both:**
  1. *Flows:* `applyImport` and `undoLastStaffImport` must not set or persist a docs snapshot captured before an `await`. Re-apply the import's field changes (`archived`, `importBatches`, `staffChangeHistory`) onto the *current* docs with a functional `setState(s=>({docs: patch(s.docs)}))`, and pass that same object to `_persistDocsNow`. Apply the same approach to the final `setState({roster:nextRoster, sessions, requests, notifQueue})`.
  2. *Engine:* make `_docsAlt` / `_opsAlt` build up across take-ins until this tab makes a clean write that is not from remote. Keep a list of the previous values, or a key set, and let `delLocal` require that the row is absent from **every** value this tab held since `base`. That way, a value computed before any take-in can never delete rows that arrived later. Better still, record explicit deletions (tombstones) instead of inferring deletion from absence.
- **Regression risk:** moderate. The import already has rollback and undo signatures (`_staffImportUndoSig`), so re-verify undo conflict detection after the change.
- **How to test:** run `e10b.mjs` in a loop over gaps 0–250 ms. A fresh tab must show every B completion. Add this to `crosstab.test.mjs` with the pattern "B saves twice during A's import".

## R3-02: Backup restore after a cross-tab merge duplicates the entire audit log. High, VERIFIED-RUNTIME, REGRESSION (corruption)

- **Where:** Admin → Backup → Restore (`applyBackupRestore` ~10627) and "Undo last restore". The engine code is `_xtMergeIdLog` (~12820).
- **What happens:** `auditLog` has no ids, so the merge matches entries by object identity. A restore replaces `state.auditLog` with JSON-parsed copies, so every entry counts as "added by this tab" and is put in front of the stored log. This happens whenever the write takes a merge path rather than the uncontended one:
  - after any cross-tab take-in (`_opsAlt` set), or
  - when the tab's rev is out of date.
- **Evidence** (`e1.mjs`):
  - Fix: before the restore, tab B had 13 entries. After the restore, A and B had 27 entries with 12 duplicated, and a fresh tab C had 28 with 12 duplicated.
  - Pre, same script: 11 entries before and 11 after, with no new duplicates.
  - The duplicates are persisted, count toward the 20,000 cap, and corrupt the compliance audit trail.
- **Fix:**
  1. Give audit entries a stable id at creation in `auditEntry` (for example `id:'aud'+Date.now()+rand`) and merge `auditLog` by id. For legacy entries without an id, use a content key (`ts|user|action|target|prev|next|notes|relatedId`).
  2. Make restore and undo-restore an **authoritative replace**, not a merge. Add something like `_opsReplace(local)` / `_docsReplace(docs)`, which reads the current rev, writes `local` verbatim, and adds the child marker. A restore is supposed to replace data, including rows another tab added since.
- **How to test:** `e1.mjs` must report `dupKeys` unchanged after restore and undo-restore.

## R3-03: The pagehide flush can abort against the tab's own in-flight write, losing the last change (single tab). Medium, VERIFIED-RUNTIME (mechanism), REGRESSION

- **Where:** `_flushPendingPersist` → `_opsPersistRun(true)` → `_opsTryPut` (~12864). This is not the same as the builder's stated risk, which involves *another* tab's unseen save.
- **What happens:**
  1. The debounced write W1, based on rev R, is committing. At full scale that takes about 100–120 ms.
  2. The user makes another change and the tab is reloaded or closed.
  3. The flush writes W2 with `add('ops_child_of_R')`. W1 committed that marker first, so W2 aborts.
  4. The fallback (read, merge, write) is asynchronous and does not run once the page is unloading.
- **Evidence** (`e3c.mjs`, with the flush forced while W1 is in flight):
  - Fix:
    ```
    --- pagehide flush --- / add ops_child_of_… / put operational / ops-tx complete 117ms / ops-tx ABORT / put operational (retry: needs the page alive)
    ```
  - Pre: two plain puts, both `complete`.
  - Reload-level repro (`e3.mjs`): the fix lost 2 of 6 and 0 of 8; pre lost 2 of 8. The window is narrow, so this cannot be told apart statistically, which is why it is rated Medium.
- **Fix:** when `_opsTryPut` issues its put, synchronously record `this.__opsPendingRev=rec.rev` and `this.__opsPendingLocal=local`. While a write is in flight, the optimistic path should use `rev0=__opsPendingRev` and `base=__opsPendingLocal`. Readwrite transactions on the same store commit in creation order, so a CAS on the in-flight write's marker is correct. As a backstop for both this case and the stated other-tab risk, the flush can also plain-put this tab's changed rows and new audit entries to `ops_unsynced_<tabId>` in the same tick. Boot would merge that key and then delete it.
- **Note:** XT-5 (flush on reload) failed a few times on the fix only under heavy CPU load (3 of 6 instrumented runs overlapped with other browser tests). Under the same synthetic load the pre build failed XT-5 *more* often (3 of 3 in one run, versus 1 of 3 on the fix). So XT-5 under load is **not** a regression.

## R3-04: After 50 missed writes, a stale tab's CAS succeeds and blindly overwrites everything. Medium, VERIFIED-RUNTIME, not a regression

- **Where:** `_xtLineage` (~8702) prunes `*_child_of_*` markers beyond the last 50 revs.
- **What happens:** a tab that missed the storage pings (for example, a page restored from the back/forward cache, which receives no `storage` events while cached) still holds an old rev. Once more than 50 writes have happened, its marker has been pruned, so `add()` succeeds and the uncontended path writes `{v:local}` wholesale.
- **Evidence** (`e8.mjs`, with B's storage handler muted to stand in for a missed ping):
  - After A made 10 writes: A's entries were kept, 10/10, because the merge worked.
  - After A made 60 writes: B's single change **erased all 60** of A's audit entries and docs changes (0/60).
  - Marker counts stayed bounded (ops 53, docs 50).
  - Pre loses in this situation too (0/10), so the fix is incomplete here rather than a regression.
- **Fix:**
  - On `pageshow` with `persisted`, and on `visibilitychange` → visible, set `_opsRev=_docsRev=null` (which forces a read-merge-write) or run `_opsSyncFromStore()` / `_docsSyncRun()`.
  - Prune markers by age (for example, older than 7 days) or keep about 1,000; each marker is a few bytes.

## R3-05: Loose ends in the docs rev scheme. Low, VERIFIED-CODE

- `_persistAllDocsV5` (~8674) writes `docs_v5_lineage=[]` without deleting the existing `docs_child_of_*` markers. Those markers are orphaned and never pruned (a small leak).
- It is also not serialized on `__docsPersistChain`, so a queued merge write can land after it. This path is used only for legacy migration and the `hasc_docs` legacy ping.
- **Fix:** delete the markers named in the stored lineage in the same transaction, and route the call through the chain.

## R3-06: Two flaky suite outcomes seen once each; not isolated. SUSPECTED

- **XT-3.2** (one instrumented run, under load): the same staff title was edited in A and then in B 650 ms later. Every tab converged to the **original** title, so both edits were lost. In 8 isolated repeats (`e11.mjs`) it did not happen.
- **XT-2.1** (one suite rerun): B's training-import completion was missing in A, B and a fresh tab. There was no loss in 18 isolated loops (`e9.mjs`) or 6 instrumented suite runs.
- Both plausibly belong to the R3-01 class (a flow's final `setState` using state captured before its awaits), applied to operational data or triggered by a slow chain.
- Re-test after the R3-01 fix. Also, `crosstab.test.mjs` failed 1 of 3 on the first full-suite pass (XT-3.4), so the suite is itself timing-sensitive.

---

## Checked and OK (evidence)

- **Suites:** all 12 suites pass on `out_review3.html`. `crosstab` passed 24/24 in 7 of 9 runs; the failures were XT-3.4 once and XT-2.1 once (see R3-06).
- **Single-tab save paths** (`e14.mjs`): each path survived a reload, and the fix and pre builds gave identical results:
  - import rollback on a forced docs-persist failure (nothing applied after reload)
  - import, then undo
  - completion, void, session edit, location toggle, location requirement rule, audit entry
  - backup restore, then undo-restore
- **Merge semantics** (`e2.mjs`, simultaneous edits in two tabs): all converged in A, B and a fresh tab.
  - A seed completion marked superseded in one tab plus a seed completion removed there, while the other tab added a new one: all three kept.
  - A report template deleted in one tab while another template was edited in the other: both kept.
  - A staff member un-archived in one tab while another was archived in the other: both kept.
  - A request deleted in one tab while a session was edited in the other: both kept.
  - A row deleted remotely was not brought back by the other tab's stale copy.
  - Deleted *default* report templates come back on boot through `seedDefaultReportTemplates`; this is pre-existing behaviour and not caused by the merge.
- **Row keys:** at full scale these merge by row id: roster (4,053), sessions, instructors, locations, reportTemplates, and completions (24,654, keyed by storage key). `archived` (1,319) merges as an id set. The logs that are currently empty (staffChangeHistory, notifications, commLog, completionVoids) carry ids when created.
- **Ping loops:** one ping per change. There were no further pings over 10–12 s idle, including after simultaneous changes in both tabs (`e1.mjs`).
- **Ping storm** (`e15.mjs`): 40 foreign pings on a tab with a pending change drained in 263 ms and the change persisted. Pre **lost** the pending change.
- **Storage failures** (`e6.mjs`):
  - With no IndexedDB, boot works and in-memory changes are kept (pre discards the docs change on a ping).
  - With a quota abort, or with `transaction()` throwing, both storage warnings appear once, nothing throws, and there is no retry loop (write attempts went 9→10 and 3→4 over 4 s).
  - In both builds, a docs change made while storage was failing is not re-saved automatically once storage recovers. This is pre-existing.
- **Upgrade from older data** (`e7.mjs`, persistent profile): data saved by the baseline `out.html` and by the pre build was opened in the fix. Completion, new staff member, void, session note, location toggle, archive and audit entry were all present at boot and after the first save plus reload. With an old-build tab and a new-build tab open together, both tabs' entries were kept.
- **Performance at full scale** (4,053 staff, 24,654 completions; `e5.mjs`, `e13.mjs`):

  | Measure | Fix | Pre |
  |---|---|---|
  | Uncontended ops save | 12–19 ms | 15–19 ms |
  | Docs save | 367–428 ms | 357–774 ms |
  | Hydrate on ping | 88–458 ms, one outlier at 953 ms (merge and write-back) | 72–151 ms |
  | Longest main-thread task | 284–395 ms | 282–558 ms |

  Raw merge cost: ops merge 4.4 ms, `_docsFromStored` 13 ms, docs merge 31 ms, completion delta 60 ms. There is no meaningful slowdown.

## Areas not conclusively tested

- R3-06 root causes.
- `undoLastStaffImport` under the R3-01 timing; the code has the same pattern.
- Real back/forward-cache restore (simulated here by muting the handler).
- Browser shutdown with 3 or more tabs flushing at once.
- `sharedStore`, `lastStaffImportUndo` and `preRestoreBackup` are still plain last-writer-wins puts, so video assignments are not covered by IMP-08. Not a regression.
