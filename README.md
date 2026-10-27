# flow-audit

Audit workbench for BSS order flows. Reads evidence exported from the product catalog, order management, BPM and provisioning, reconstructs how every order travelled through them, detects where it broke, quantifies the impact, and produces a report that can be handed to a client.

It does not implement, configure or monitor those systems. It observes them.

**Status:** phase 0 — product and architecture defined. The site is under construction; the demo runs against a fictional operator, `Ortelis Satellite`.

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

## Repository

| Path | Contents |
|---|---|
| `docs/product.md` | What the product is, for whom, what it does and does not do |
| `docs/architecture/` | Shape, pipeline, stack, [data model](docs/architecture/data-model.md) |
| `docs/decisions/` | ADRs, one decision per file |
| `docs/requirements/` | [MVP requirements](docs/requirements/mvp.md) |
| `docs/glossary/` | [BSS order-flow terms](docs/glossary/bss.md) |
| `data/demo/` | Synthetic evidence for the Ortelis Satellite demo |
| `src/` | CLI, domain, adapters (phase 1) |
| `tests/` | Tests (phase 1) |

The published demo lives in the sibling `site/` repository.

## Build plan

| Phase | Deliverable |
|---|---|
| 0 | Product, architecture, data model, ADR, requirements |
| 1 | Domain model and the synthetic Ortelis dataset |
| 2 | Ingest adapters and journey reconstruction |
| 3 | Rules R01–R05 and impact quantification |
| 4 | Report renderer with the four visuals |
| 5 | Under-construction landing, then the published demo |

## Language

Code, documentation and the generated report are in English. Commercial and technical presentations are in Spanish.
