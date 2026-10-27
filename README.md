# flow-audit

Audit workbench for BSS order flows. Reads evidence exported from the product catalog, order management, BPM and provisioning, reconstructs how every order travelled through them, detects where it broke, quantifies the impact, and produces a report that can be handed to a client.

It does not implement, configure or monitor those systems. It observes them.

> **Under construction — phase 0 of 6.** Nothing runs yet: there is no `src/`, no dataset and no demo report. This repository currently holds the product definition, the architecture, the data model, the rule catalogue and the requirements that the next phases implement.

## Why

A telecom order crosses four systems owned by four teams. Nobody owns the whole path, so nobody can say with evidence where orders get stuck or what the manual work costs. Audits today are interviews and spreadsheets; this makes them reproducible, traceable and quantified.

## What it will do

```
evidence exports → ingest → reconstruct → detect → quantify → report.html
```

- **Ingest** one export per system into a canonical event stream.
- **Reconstruct** each order's journey, including the links the systems do not share.
- **Detect** five failure patterns with explicit rules, each tied to its evidence.
- **Quantify** hours and USD from visible, configurable rates.
- **Report** one self-contained HTML file with flow map, state machine, timeline and heat map.

## Where we are

| Phase | Deliverable | State |
|---|---|---|
| 0 | Product, architecture, data model, rules, requirements, ADR | **done** |
| 1 | Architecture skeleton, ports and canonical model | pending |
| 2 | Ortelis dataset, versioned, with golden numbers | pending |
| 3 | Site shell and demo page designed against a mock | pending |
| 4 | Ingest adapters and journey reconstruction | pending |
| 5 | Rules R01–R05 and impact quantification | pending |
| 6 | Report rendered from the engine and published | pending |

## Repository

| Path | Contents |
|---|---|
| `docs/product.md` | What the product is, for whom, what it does and does not do |
| `docs/architecture/overview.md` | Shape, pipeline, stack, limits |
| `docs/architecture/data-model.md` | Entities, events, correlation, invariants |
| `docs/architecture/rules.md` | The five findings: signal, evidence, impact formula |
| `docs/decisions/` | ADRs, one decision per file |
| `docs/requirements/` | [MVP requirements](docs/requirements/mvp.md) |
| `docs/glossary/` | [BSS order-flow terms](docs/glossary/bss.md) |
| `data/demo/` | Synthetic evidence for the Ortelis demo (phase 2) |
| `src/` | CLI, domain, adapters (phase 1) |
| `tests/` | Tests (phase 1) |

The published demo lives in the sibling `site/` repository, which today shows an under-construction landing.

## Language

Code, documentation and the generated report are in English. Commercial and technical presentations are in Spanish.
