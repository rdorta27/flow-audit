# 0004 — MIT for the engine, with a third-party boundary

- Date: 2026-10-28
- Status: Accepted

## Context

The repository is public and had no license, so by default nobody could use it, including
the consultancies the product is aimed at. The audit of the integration candidate (M0-05)
showed the cost of the opposite mistake: a repository whose license files contradict its
own package metadata, and a use that cannot be decided without asking the author.

Flow Audit needs a position that is readable in one minute, that lets a client evaluate the
tool, and that does not repeat that ambiguity. `docs/product.md` sells the toolkit per
engagement; the question is what exactly is sold.

## Options

**A. Proprietary EULA.** All rights reserved, use only with a paid license. Rejected: a
public repository with no right to use it is worse than a private one, and a consultancy
cannot evaluate an audit tool it is not allowed to run.

**B. Source-available, non-commercial (PolyForm or similar).** Rejected: "non-commercial"
is the exact phrase that made the candidate undecidable, and the license is not open
source, so the site could not say so either.

**C. MIT for the generic engine, private client-specific work.** Accepted. The engine, the
canonical model, the ports, the rules and the renderer are MIT. Per-client adapters,
mappings, rules and datasets live in private repositories.

**D. MIT for everything, including client work.** Rejected: it gives away the part a client
actually pays for and makes every engagement reusable by a competitor.

## Decision

**C.** The engine is MIT. The moat is the method, the rules and the relationship with the
client, not the source of the binary. The boundary is explicit and executable:

- `LICENSE` is the MIT text, and `deno.json` declares `license: MIT`.
- Every file under `src/` and `tests/` starts with `SPDX-License-Identifier: MIT`.
- `THIRD-PARTY.md` separates what ships (nothing) from what the tool reads over HTTP.
- `TRADEMARKS.md` keeps the name, the logo and the TM Forum marks outside the grant.
- `tests/license_boundary_test.ts` fails when a vendored file, a remote import, a
  third-party capture or a missing header appears.

## Consequences

- A consultancy can read, run and modify the engine before paying for anything.
- A competitor can reuse the engine. Accepted: the engagement, the client data and the
  method are what is sold, and none of them travels with the code.
- Flow Audit is an open source project, which matters for the exemption in the candidate's
  `LICENSE-TMF-APIS` ("Open source projects that are not commercial products").
- Adding a system to test is a documentation change plus a review, not a code change: no
  third-party source enters the repository.
- Cost: the boundary is checked on every test run, and a legitimate new fixture has to be
  synthetic or generated locally.
