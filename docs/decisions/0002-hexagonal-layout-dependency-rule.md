# 0002 — Hexagonal layout with an enforced dependency rule

- Date: 2026-10-27
- Status: Accepted

## Context

The audit has four kinds of moving parts: the canonical model and its rules, the
evidence coming from four different systems, the use case that ties them together and
the CLI. If any of them can import any other, the renderer ends up computing findings and
the adapters end up owning business rules — the usual way an audit tool becomes
unmaintainable after the second client.

The domain must be testable without files, without a clock and without a renderer.

## Options

**A. Flat modules.** `model.ts`, `ingest.ts`, `report.ts` side by side. Fast to start,
no boundaries. Rejected: nothing stops the report from recalculating impact.

**B. Layered folders without enforcement.** The same layout, but the rule lives in a
document. Rejected: the first hurried change breaks it and nobody notices.

**C. Hexagonal layout with a test that enforces the boundary.** `domain/` holds the
model and (from phase 5) the rules; `ports/` holds the interfaces; `adapters/` holds
files, HTML and the clock; `app/` holds the use case; `cli/` parses arguments.

## Decision

**C**, with the boundary as an executable test: every file under `src/domain/` must
import only from `src/domain/`, and `deno.json` must declare no runtime dependencies.

## Consequences

- Rules and reconstruction will be testable with plain objects, no fixtures on disk.
- A new output format is a new adapter; a new finding is a new rule. Neither touches
  the pipeline.
- Cost: more files and an indirection per dependency. Accepted, because the audit is
  the product: the domain is what a consultancy is paying for.
- The rule is checked by `tests/architecture_test.ts`, so it fails the build instead of
  fading away.

## Evidence

- Phase 1 ships the skeleton: `src/domain/model.ts`, four ports, one use case, one CLI.
- `deno task test` runs the boundary test; `deno task check` types every module.
- The design matches the shape already described in [architecture](../architecture/overview.md).
