# AGENTS

- This repo is at **version 0.3.0, milestone Demo 1** (next: Client-ready). It has the synthetic
  dataset, the simulated TMF stub, readers for product orders (TMF622), service orders (TMF641)
  and activations (TMF640) in `src/adapters/ingest/`, the correlation with per-link confidence
  and time segments (`src/domain/correlation.ts`, `segments.ts`), and rule R04
  (`src/domain/rules/r04.ts`: 20 duplicates, USD 1,590). There is no `findings.json`, no
  generated report and no other rule yet; `deno task audit` still exits with code 2. Do not
  add R01, R02, R03 or R05 ahead of their milestone. Next card: M3-06 (wire R04 into `deno task audit`). The plan is
  `../specs/backlog.md`.
- This version is English only: code, docs, CLI and report. Spanish and Portuguese output
  come later (backlog L-01).
- Read `README.md`, then `docs/product.md`, then `docs/architecture/`.
- `domain/` has no I/O: rules and reconstruction must be testable without files.
- A new finding is a new rule under `domain/rules/`; never hardcode it in the renderer.
- Every rule follows the contract in `docs/architecture/rules.md`: signal, evidence, formula.
- The report is one self-contained file: no CDN, no external fonts, no build step. It speaks
  to someone outside telecom and follows the approved design in `../specs/design/` (generic
  system names, one colour per system; backlog S-11).
- Only synthetic data is committed. Client evidence never enters the repo or its history.
- The engine is MIT. Never vendor, copy or import third-party code; the systems it reads
  are reached over HTTP only (`THIRD-PARTY.md`). The boundary is a test, not a promise.
- Impact rates are configuration, not constants: every number in the report must be replaceable.
- When you close a backlog card, move it with its Result to `../specs/done/<milestone>.md`
  and update the "Where we are" section of `README.md` and `../specs/estado.html` in the
  same change; `../specs/backlog.md` (what is left) and `../specs/done/` (what is built)
  win if they disagree.
- Tests: `deno test`. Run them before proposing a change.
- Commits: the `commit-msg` hook enforces the format (`<type>: <summary>`, why + `Changes:`).
- Do not push, tag or publish without explicit approval.

## Index

| Need | File |
|---|---|
| Product, scope, demo | `docs/product.md` |
| Architecture, stack, limits | `docs/architecture/overview.md` |
| Entities, events, invariants | `docs/architecture/data-model.md` |
| Findings, evidence, impact | `docs/architecture/rules.md` |
| Why local-first CLI | `docs/decisions/0001-local-first-cli-static-report.md` |
| Why the source is our TMF stub (simulated) | `docs/decisions/0003-tmf-stub-as-primary-source-and-typescript-adapters.md` |
| MVP requirements | `docs/requirements/mvp.md` |
| Vocabulary | `docs/glossary/bss.md` |
