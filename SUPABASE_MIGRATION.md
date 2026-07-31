# HASC Center LMS — Supabase migration status

What is wired, what is generated, and what still needs a live Supabase project.

---

## Where things stand

| Layer | Status |
|---|---|
| Auth / Identity / Session / Policy | **Switchable.** `doLogin()` delegates to `HASCAuth.signIn()` in server mode; identity resolves from the session, never the form. |
| Data-access seam (`HASCRepo`) | **Proven.** Was zero call sites at audit time; now three slices run through it with two working drivers each. |
| Schema + RLS | **Generated.** `supabase/schema.sql` — 40 tables, 171 indexes, 87 policies, 4 helper functions, 10 storage buckets. |
| Slices migrated | registrations, attendance, completions (3 of 22 server-authority collections) |
| Concurrency-unsafe operations | **Identified and specified, not written.** 5 RPC contracts at the end of the schema file. |
| Compliance calculation | **Unchanged** — still client-side. Needs a decision (see below). |
| Live Postgres verification | **Not done.** No Supabase project available; everything was verified against an injected driver double. |

---

## 1. Authentication

`HASC_CONFIG.features.authProvider`: `'auto'` (default — Supabase when configured, else the demo
path), `'local'`, `'server'`.

In server mode `doLogin()` calls `HASCAuth.signIn()` and the demo credential path is unreachable.
Identity comes from `HASCIdentity.resolve(session, roster)` — link table, then auth claim, then
email — and the **role comes from the auth claims, not from which portal button was pressed**.

Verified against a fake Supabase Auth provider:

| Case | Result |
|---|---|
| Valid credentials | signs in, identity resolved from `employee_id` claim to the right staff record |
| Wrong password | *"Invalid login credentials"* (the provider's message, not a local guess) |
| Account with no linked staff record | refused and signed back out |
| Claims say `admin`, Staff portal requested | refused and signed back out |
| Demo password (Staff ID + surname) while in server mode | refused — the local path is genuinely unreachable |

**Before go-live:** delete `checkPassword()`, `savePwSetup()` and the `sha256` helper. They are
prototype affordances, not authentication, and they must not ship.

---

## 2. The repository seam

`HASCRepo.makeSlice(spec)` builds a domain repository from a declared column mapping. Each slice
gets one async interface and two implementations — `local` (component state, bound at mount, zero
behaviour change) and `supabase` (Postgres via RLS). Both return `{data}`/`{error}`, so callers
never branch on the driver.

| Slice | Table | Verbs | Wired into |
|---|---|---|---|
| `registrations` | `registrations` | `create`, `setStatus`, `seat` | `registerStaff()`, `approveReq()` (all four status transitions) |
| `attendance` | `attendance` | `mark`, `markAll`, `certify` | `setAtt()`, `setPass()`, `markAllPresent()` |
| `completions` | `completions` | `post`, `voidRecord` | completion posting and voiding |

Per-slice switches: `HASC_CONFIG.features.registrationsRepo` / `attendanceRepo` / `completionsRepo`
(`'auto'` | `'local'` | `'server'`). `HASCRepo.sliceStatus()` reports where each one points.

Verified with a fake Postgres driver injected via `HASCRepo.setDriver()`: insert produces the
expected snake_case columns, `list()` reads back with an `eq` filter, and an RLS `42501` refusal
surfaces to the operator without corrupting local state.

**`certify()` is deliberately still inline.** It writes four tables (attendance, completions,
registration statuses, session lock). Porting it as four client round-trips would allow a
half-certified session. The attendance slice's `certify` verb returns
`certify_is_inline_pending_rpc` so this is loud rather than forgotten.

---

## 3. Generated schema — `supabase/schema.sql`

Generated from the in-app handoff package by `buildSupabaseSql()` (Admin → System Center →
Supabase handoff → **Export SQL schema**), so the SQL cannot drift from the documented schema.

40 tables · 171 indexes · 102 foreign keys · 43 enum CHECK constraints · RLS enabled on all 40 ·
87 policies · 4 helper functions · 10 private storage buckets.

**Two defects were caught while generating it:**

* Schema-qualified foreign keys were being mangled — `FK→auth.users.id` produced
  `references auth(users)`. Now `references auth.users(id)`.
* `current_role()` — the helper name in the handoff package — **is a reserved Postgres built-in**.
  It is emitted as `hasc_current_role()`, and all 90 policy references use the renamed function.
  `SQL_RESERVED_FN` in the generator carries the map.

**7 items are emitted as explicit `TODO` and will not compile until written.** That is deliberate:
six helper functions and one instructor policy are documented in the handoff package as prose
("staff assigned to instructor sessions"), not as SQL. A policy that looks plausible but is wrong
is a security defect, so the generator never guesses one.

Validation: all 223 parser-supported statements (tables, indexes, extensions, bucket inserts) parse
cleanly under `pgsql-ast-parser`; all 87 policies and 40 RLS enables are structurally well-formed;
all 4 function bodies are correctly dollar-quoted. **This is a parse check, not a deployment.**

---

## 4. RPC contracts — write these before go-live

Each is read-then-write in the browser: correct single-threaded, wrong against Postgres. Full text
at the end of `supabase/schema.sql`.

| RPC | Why it cannot be a client round-trip |
|---|---|
| `register_staff_for_session` | Two managers can both see the last seat. Lock the session row and re-count inside the transaction. |
| `certify_session` | Four tables in one transaction, and idempotent — a second call must post nothing. |
| `void_completion` | Append-only; never DELETE the completion row. |
| `apply_staff_import` | Full rollback plus operational close-out for archived staff. |
| `recalculate_compliance` | See below. |

---

## 5. Open decisions — I did not make these for you

**Compliance calculation.** Today `effStatus()` runs client-side over ~3,943 staff × 26 courses
(~102k evaluations, 82 ms, memoized). Server-side there are three options — a materialized view
refreshed by `recalculate_compliance()`, an RPC per view, or keeping it client-side and shipping the
whole roster to every browser. The third defeats RLS. This is an architecture decision with real
cost implications either way.

**AMAP Pouring.** Still flagged from the original audit: the brief says AMAPP turns green only after
three pourings plus 811 confirmation; the implementation turns it green on one. Unchanged pending
your confirmation — it would move compliance status for thousands of records.

**Which side owns denormalised mirrors.** A seat lives in `requests[].status` *and*
`sessions[].roster[]`; attendance in `att{}` *and* `pass{}`; a completion in `docs.completions[]`
*and* `roster[].rec/.dt`. Postgres has one row for each. The slices above resolve this per workflow,
but the remaining collections need the same call.

---

## 6. What still needs a live project

Everything below was verified against an injected driver double, which proves the *seam* and the
*shape* — not the database.

- Deploy `supabase/schema.sql` and confirm it applies cleanly.
- Write the 7 TODO helpers/policies, then test RLS with a SQL harness *before* any UI touches it —
  sign in as each of the four roles and confirm the row counts match the scope rules.
- Write the 5 RPCs and re-point the slices at them.
- Migrate the remaining 19 collections using the three slices as the template.
- Real concurrency testing: two managers registering into the last seat; two instructors certifying
  the same session.
- Data migration from the current browser stores into Postgres.

**Do not treat the client-side checks in this file as security at any point in that sequence.** They
are UX guards. RLS is the boundary.
