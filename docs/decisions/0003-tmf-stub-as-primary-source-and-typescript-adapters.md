# 0003 — The TMF stub is the primary source; adapters in TypeScript

- Date: 2026-10-29
- Status: Accepted

## Context

Milestone M0 set out to validate one integration source before writing the first
adapter. The candidate, bss-oss-rust, runs locally ([M0-02](../../../specs/flow-audit_BACKLOG.md),
M0-09) and its contracts are captured (M0-04), but the same captures show that its API is
a weak TMF: items are accepted on create and never returned, the product-order →
service-order link is a free-text `external_id` the client writes itself, activations
never return their service order, and there is no pagination, no filtering and no
history. Its license files contradict each other (M0-05), so nothing depending on it can
be published while the author's answers are pending.

Flow Audit still needs a source for development, tests and the public demo: a source with
known defects, golden numbers, and a shape close enough to standard TMF that the adapter
written against it is the adapter a real system would need.

## Options

**A. bss-oss-rust as the primary source.** Rejected: the contract is too weak to
reconstruct a journey (no item links, no pagination, snapshot only), and the license
question (M0-05) makes it local-only.

**B. Openslice as plan B.** Rejected for M0 and moved to Later: the stub removes the need
for a fallback, and Openslice's Flowable base makes it a possible BPM source later (M0-06).

**C. A mock generated from the candidate's OpenAPI specification.** Rejected: the spec
describes paths, not data. It produces valid-looking objects with no relationship between
them, which is exactly what correlation cannot use.

**D. Copy the candidate's dialect into the stub.** Rejected: a stub that speaks
snake_case with no item links would teach the adapter nothing about standard TMF and
would hardcode a third party's defects into this repository.

**E. Our own TMF stub in `core/src/stub/` over the synthetic dataset, and TypeScript
adapters inside the Deno project.** Accepted. A separate Go adapter was considered and
rejected: one stack, zero runtime dependencies, and the ports of
[ADR 0002](0002-hexagonal-layout-dependency-rule.md) are TypeScript interfaces — a second
language would duplicate the toolchain and the types without adding anything at this size.

## Decision

**E.** The primary source for development, tests and the public demo is the TMF stub in
`src/stub/` (M0-11), serving the synthetic Ortelis dataset over read-only, standard
TMF-shaped HTTP on loopback. It is MIT, has no runtime dependencies, and every response
is marked `X-Flow-Audit-Source: simulated`. bss-oss-rust stays in the setup as an
optional, local-only check of a contract we do not control.

Two deliberate deviations from standard TMF, explicit because they are ours:

- **The stub adds `serviceOrderItem.productOrderItem`.** TMF641 v4 defines no item-level
  reference from a service order to a product order — a real TMF system does not have to
  offer it. M0-04 showed the correlation chain dies without one, so the stub adds it
  TMF-style; it is the field the adapter maps with confidence `explicit`, and it is what
  gives rule R04 strong evidence.
- **The stub does not expose everything a real system might.** Orders carry no
  `completionDate` (the dataset stores no closure timestamp), and the event history is
  not served over HTTP: it stays in the file exports, which M5-02 will ingest directly.

bss-oss-rust (commit `c65aacd6`) is a **dialect check**, not a source for the demo: an
opt-in integration test (M1-04) proves the adapter reads a foreign contract. Its gaps
(M0-04) — snake_case, no `href` or `@referredType`, detail ≡ list row, free-text
`external_id`, unbounded lists — are mapped in the adapter, as the table in
[data-model](../architecture/data-model.md#the-bss-oss-rust-dialect) records. Its
unresolved license (M0-05) does not block the public demo, because the demo does not use
it: it never leaves loopback.

R04 therefore has **two levels of evidence** (M3-01): strong when two service order items
reference the same product order item (the stub serves this), weak when two service
orders share a duplicated `external_id` (the dialect; a Flow Audit convention, not a
contract). Each finding records which level it used.

## Consequences

- The public demo is simulated and must say so: the stub's marker, the README, the site
  and the report all label it, and nothing may present the demo as a live integration.
- The stub and the adapter fit by construction: passing tests against the stub prove the
  pipeline, not integration. The only proof that the adapter reads a contract we do not
  control is the local dialect check (M1-04); without it, M1 is self-consistent by design.
- The stub is versioned with the dataset it serves, so the golden numbers stay valid;
  changing the dataset means re-checking the stub's derived states.
- This decision changes if the license question is resolved in our favour (bss-oss-rust
  could then be promoted beyond a local check), or if a real source with a better contract
  appears; the adapter's port makes the swap a new adapter, not a rewrite.

## Evidence

- Contract captures and the seed: M0-04 (`sandbox/bss-oss/setup/CONTRACTS.md`, outside
  both repositories per [ADR 0004](0004-mit-and-third-party-boundary.md)); the dialect
  table in [data-model](../architecture/data-model.md#the-bss-oss-rust-dialect).
- The stub: M0-11 — `deno task stub` answers on `127.0.0.1:8081`, GET only (405
  otherwise), `X-Flow-Audit-Source: simulated` on every response; 49 tests green,
  including the R04 cohort as exactly the 20 duplicated orders of `expected.json` and the
  300 weak-link activations of R05.
- The candidate: M0-02, M0-03 and M0-09 (runs locally, one command, loopback-only);
  M0-05 (license blocked on the author's answers).
- Decisions this supersedes in intent: the plan note "the primary source will be a TMF
  stub" in the backlog, confirmed here as the accepted decision.
