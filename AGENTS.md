# AGENTS

- This repo is at **phase 3**: skeleton, dataset and a report preview in the site. There
  is no ingest, no rule and no generated report yet; do not add them ahead of their phase.
- Read `README.md`, then `docs/product.md`, then `docs/architecture/`.
- `domain/` has no I/O: rules and reconstruction must be testable without files.
- A new finding is a new rule under `domain/rules/`; never hardcode it in the renderer.
- Every rule follows the contract in `docs/architecture/rules.md`: signal, evidence, formula.
- The report is one self-contained file: no CDN, no external fonts, no build step.
- Only synthetic data is committed. Client evidence never enters the repo or its history.
- Impact rates are configuration, not constants: every number in the report must be replaceable.
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
| MVP requirements | `docs/requirements/mvp.md` |
| Vocabulary | `docs/glossary/bss.md` |
