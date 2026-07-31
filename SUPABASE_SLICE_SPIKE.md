# Supabase migration — registration slice spike

**Purpose:** prove the `HASCRepo` seam by moving one vertical workflow behind it end to end, so
the remaining 21 server-authority collections can be sized from a worked example rather than an
estimate.

**Slice chosen:** registrations — manager request → admin approval → session roster seat. It is the
smallest workflow that still exercises writes, reads, status transitions, role scoping, capacity
rules and cross-portal propagation.

**Status:** working. Both implementations pass the same tests. Default behaviour is unchanged.

---

## What changed

### 1. `HASCRepo.registrations` — a domain repository (new, in the auth-layer script)

The existing `HASCRepo.select/upsert/remove` façade is *table*-shaped. The UI is *workflow*-shaped,
so each slice gets a small domain repository with one async interface and two implementations:

| Operation | Meaning |
|---|---|
| `list(q)` | registration requests visible to the caller (`q.sessionId`, `q.staffId`, `q.limit`) |
| `create(rows)` | insert new requests |
| `setStatus(id, status, patch)` | move one request to a new status |
| `seat(sessionId, staffIds[], waitlist)` | place seats on a session roster |

Both implementations return `{data}` / `{error}`, so callers never branch on the driver.

`seat()` takes an **array** deliberately — enrolling 50 staff must stay one state update, not fifty.

### 2. Two implementations

* **`local`** — `Component._registrationsLocalImpl()`, bound at mount. Does exactly what the inline
  `setState` calls always did. Zero behaviour change.
* **`supabase`** — in the auth-layer script. Real `upsert`/`select` against the `registrations`
  table with snake_case column mapping, relying on RLS for row visibility.

### 3. Feature flag

`HASC_CONFIG.features.registrationsRepo`:

| Value | Behaviour |
|---|---|
| `'auto'` *(default)* | Supabase when configured, otherwise the local implementation |
| `'local'` | force component state even if Supabase is configured |
| `'server'` | force Supabase; fails loudly if unconfigured |

### 4. Workflows rewired

`registerStaff()` and `approveReq()` now `await` the repository. **All four** status transitions in
`approveReq` go through `setStatus()` — including the three rejection paths
(`withdrawnInactive`, `needsReschedule`, already-seated) — so a migration does not have to
re-discover them.

---

## Evidence

**Local implementation — behaviour unchanged**

| Case | Result |
|---|---|
| Manager registers | request created `pendingAdmin`, no seat yet |
| Admin approves | status `enrolled`, seat added, roster length 1 |
| Archived staff approval | `withdrawnInactive` |
| Admin bulk enrol (4 staff) | 4 seats, 4 `enrolled` requests, one state update |
| Full E2E (register → approve → certify) | unchanged: 1 completion, session locked, 0 on re-certify, roster `g`, on transcript |

**Supabase implementation — driver injected via `HASCRepo.setDriver()`**

| Case | Result |
|---|---|
| Mode switch | `registrationsRepoMode()` → `supabase` |
| Insert | 1 row, columns `id, staff_id, session_id, manager_id, location_id, course_code, status, requested_by_role, override_reason, created_at, updated_at` |
| `list({sessionId})` | reads back through `select` with `eq: {session_id: 's40'}` |
| RLS refusal (`42501`) | surfaced to the operator — *"Could not submit the registration: new row violates row-level security policy"* — and local state left uncorrupted |

**Regression:** 58/58 QA checks pass · 42/42 tabs across four portals, 0 runtime errors · 0 overflow
at 7 viewports · persistence, print, XSS-escaping and offline boot all unchanged.

---

## What the spike revealed — read before migrating the next slice

**1. A seat is stored twice in the browser model and once in Postgres.**
`requests[].status === 'enrolled'` *and* `sessions[].roster[]` both record the same fact. In
Postgres the registration row **is** the seat, so `seat()` is a no-op server-side and the roster
becomes a projection. Every slice with a mirrored array — **attendance**, **assignments** — needs
the same collapse decision, and it is a schema decision, not a code one.

**2. Capacity is checked read-then-write.** Safe in a single-threaded browser; **not safe** against
Postgres, where two managers can both pass the check. Capacity has to move into a constraint or an
RPC. This will recur anywhere the UI reads a count and then writes based on it.

**3. Client-side scope filtering is a UX guard, not a boundary.** `managerAuthorizedRoster()`
filters before the write; RLS must independently refuse an out-of-scope insert. The spike confirms
a refusal propagates correctly — the pattern works, but every slice needs its policy written.

**4. Async changes render batching.** One synchronous `setState` became two awaited writes, so a
registration now renders twice instead of once. Immaterial here; worth watching on slices that
write in loops.

**5. `_mirrorToService()` is not a migration path.** It is one-way, fire-and-forget, and swallows
errors. It is useful as an inventory of *which* server operations exist — nothing more. Do not
mistake its 38 call sites for wiring.

---

## Sizing the rest

The seam itself is proven and cost almost nothing to add. The real work per slice is:

| Work | Notes |
|---|---|
| Schema + RLS per table | The larger half. Use the built-in handoff export (Admin → System Center). |
| Domain repository | Small and mechanical once the shape is known — this slice is the template. |
| Collapsing mirrored arrays | Judgement per slice; see note 1. Hits attendance and assignments. |
| Concurrency-unsafe rules | See note 2. Capacity, certificate numbering, import batching. |
| Compliance | Special case: computed client-side over 3,943 × 26. Becomes a view or RPC, or you ship the whole roster to the browser regardless. |
| Import transactionality | Currently a browser snapshot/rollback. Must become a DB transaction or Edge Function. |

**Recommended next slice:** attendance. It shares the mirrored-array problem with registrations, so
it either confirms the pattern generalises or exposes the exception early — while the change is
still cheap.

**Do not** start with compliance or import; both need decisions this spike deliberately did not make.
