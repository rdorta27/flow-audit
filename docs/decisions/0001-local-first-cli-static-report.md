# 0001 — Local-first CLI with a static report

- Date: 2026-10-27
- Status: Accepted

## Context

An audit runs on evidence exported from a client's BSS: order exports, process histories, provisioning logs. That evidence is confidential, often under NDA, and frequently leaves the client's network only as a file copied to a consultant's laptop. The deliverable is a report the consultancy hands over, plus the working papers behind it.

The tool must also be reproducible: the same exports and the same rules must produce the same numbers six months later, on another machine, without a service to depend on.

## Options

**A. Browser-only app.** Upload files, render in the tab. Great demo, no install. But large exports blow up memory, and "your evidence stays in your laptop" is weaker when a web origin is involved.

**B. Hosted service.** Multi-tenant, shareable URLs, easy collaboration. Ruled out: client evidence cannot leave the client, and running a service is a cost the product does not need at this stage.

**C. Local CLI that writes a static report.** Raw evidence never leaves the machine; the output is a folder with a self-contained HTML file, a JSON of findings and the normalized dataset. No server, no accounts, no network.

## Decision

**C.** A TypeScript CLI on Deno, no runtime dependencies, rendering a single-file HTML report with inline SVG.

Consequences accepted:

- no real-time collaboration; sharing is sending the report;
- the consultant needs a terminal, or a one-line installer;
- large datasets are bounded by memory until streaming is added;
- a future `serve` command can add the browser UI on top of the same pipeline without changing the domain.

## Consequences

- `domain/` stays free of I/O, which keeps rules testable and the renderer replaceable.
- The report is portable: email, USB, static hosting, PDF export from the browser.
- Reproducibility is a property of the repo: dataset + rules + config are versioned together.

## Evidence

- Constraint from the product definition: the buyer is a consultancy and the deliverable is a document, not a service ([product](../product.md)).
- The demo dataset is synthetic and versioned, so the whole pipeline can be tested without a client.
- Prior art in the workspace: sites built as plain HTML with no build step (`theme-studio`) remain maintainable years later.
