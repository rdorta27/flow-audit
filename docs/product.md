# Product

Flow Audit is a workbench for auditing the end-to-end order flow of a BSS stack. It reads evidence exported from the systems involved — product catalog, order management (OMS), process orchestration (BPM) and provisioning — reconstructs how every order travelled through them, detects where it broke, quantifies what that break costs, and produces a report that can be handed to a client.

It does not implement, configure or monitor those systems. It observes them.

> **Status: under construction — version 0.1.0, milestone M0.** The skeleton, the model,
> the dataset and a preview of the report exist. There is no analysis and no generated
> report yet; the demo described below is the target of milestones M1 to M5.

## The problem

An order in a telecom BSS crosses four systems that were bought, versioned and operated by different teams. Nobody owns the whole path, so nobody can answer, with evidence, where orders get stuck, how long they wait, how many are fixed by hand, or what that costs per month.

Audits today are interviews and spreadsheets. The evidence is scattered, the four systems do not share an identifier, and the report ends up as opinions in a deck. Two audits of the same stack produce different conclusions.

## Alternatives

| Alternative | Where it falls short |
|---|---|
| Spreadsheet plus interviews | No trace, no reproducibility; the numbers depend on who asked the questions |
| APM and observability | Shows service latency, not that a business order waited three days for a manual check |
| ETL plus BI dashboards | Moves data and draws charts, but does not interpret order semantics or quantify findings |
| Vendor audit suite | Audits its own stack, priced for the operator, unusable by a consultancy on a client's systems |
| Custom scripts per engagement | Works once; nothing is reusable, reviewable or comparable |

Flow Audit sits between the spreadsheet and the platform: the evidence discipline of a
tool, the portability of a document.

## Who it is for

- **Consultancies** that sell BSS/OSS assessments and need to deliver them faster, consistently and with traceable evidence.
- **Transformation and internal audit teams** at operators that need a repeatable baseline before and after a change.

The buyer is the consultancy, not the operator: it is a tool that makes their delivery cheaper, not a system they operate.

| Role | What they need |
|---|---|
| **Engagement lead** (buyer) | A defensible report in days, with numbers the client cannot argue with |
| **Audit analyst** (daily user) | Ingest exports, re-run the audit, inspect evidence per finding |
| **Client sponsor** (reader) | The map, the cost and the three things to fix first |

## What it does

Four verbs, one pipeline:

1. **Ingest** evidence exported from the four systems and normalize it into one append-only event stream.
2. **Reconstruct** each order's journey across systems, resolving the links between commercial order, service orders, process instance and provisioning attempts.
3. **Detect** failure patterns with explicit rules, each tied to the evidence that triggered it.
4. **Quantify and report** the impact of every finding and render a self-contained report.

Every finding carries: rule, severity, affected orders, evidence, time lost, money lost and a recommendation. A finding without evidence is not a finding.

## What is audited

| Layer | Question |
|---|---|
| Commercial catalog | Can the offer actually be sold, and is it complete? |
| Technical catalog | Does the offer map to a spec with every attribute provisioning needs? |
| OMS | How is the commercial order decomposed, retried, cancelled and closed? |
| BPM | Where does the process wait, time out, fall back to a human or lose the order? |
| Provisioning | How many activation attempts, which ones fail, and how is the failure returned? |
| Cross-system | Can one order be followed end to end, and where does the state disagree? |

## Scope

**In:** order-to-activate flow, catalog consistency, decomposition, orchestration, provisioning attempts, traceability, manual workarounds, order aging.

**Out (explicit non-goals):**

- implementing, configuring or integrating the audited systems;
- billing accuracy, revenue assurance, network/OSS and radio planning;
- performance, load and security testing;
- real-time monitoring or alerting;
- replacing the consultant's judgement.

## The demo

The demo runs against **Ortelis Satellite**, a fictional residential satellite-ISP operator (United States, USD, ~5,000 orders per month). Four systems are in scope: `CAT`, `OMS`, `BPM` and `PROV`.

Satellite is a good carrier for the method because one order needs a beam with capacity, a physical kit, a field installation and a terminal activation: four systems, one order, many places to break.

The dataset is synthetic and coherent: orders, state transitions, process timers, provisioning attempts and catalog versions that produce the five demo findings. It ships with the repo so the audit can be re-run and reproduced.

| # | Finding | Rough impact |
|---|---|---|
| R01 | Provisioning fallout with no automatic retry | 8% of orders, 2.5 days to recover |
| R02 | Missing catalog attribute forces a manual capacity check | 100% of orders, ~5 min each |
| R03 | BPM timer expires without compensation | 3% stuck in "pending activation" |
| R04 | OMS retry duplicates service orders | 5% of retries, double activation |
| R05 | No end-to-end correlation id | ~45 min per incident to investigate |

### A demo order

`ORD-1005` orders `SkyHome 200` for an address on the edge of a beam. The play-by-play
the report must show:

| At | System | What happens | Finding |
|---|---|---|---|
| 0 h | CAT | Offer validated; spec has no `capacity_profile` | — |
| +3 min | BPM | Manual capacity check task created | R02 |
| +2 h | BPM | Analyst assigns a beam by hand | R02 |
| +2 h | OMS | Order decomposed into `SO-20005` and a work order | — |
| +3 h | BPM | Installation completed | — |
| +9 h | PROV | First activation attempt fails: `HUB_TIMEOUT` | — |
| +9 h | PROV | No retry is scheduled | R01 |
| +69 h | OMS | Manual retry creates a second order, `SO-30005` | R04 |
| +69 h | PROV | Second attempt succeeds | — |

Three findings on one order, 69 hours of wall-clock time for a job that should take one.
The report adds the other two in aggregate: the 48 h timer that leaves 50 orders stuck
(R03) and the records that only a time window can join (R05).

## Commercial shape

Sold per engagement, not as SaaS: the consultancy licenses the toolkit, runs it on the
client's exports and delivers a white-labelled report. The evidence never leaves the
consultant's machine, which is what makes the engagement approvable.

## Deliverables of one audit

| Artifact | Purpose |
|---|---|
| `report.html` | Self-contained report: summary, flow map, state machine, order timeline, findings heat map, per-finding detail |
| `findings.json` | Machine-readable findings with their evidence selectors and impact formula |
| `dataset/` | Normalized event stream and the config used, so the audit is reproducible |
| `rules/` | The rule set applied, with version |

## Success criteria

- An audit that took three weeks of spreadsheet work is produced in days.
- Every number in the report can be traced back to evidence lines.
- Re-running the audit on a new export is a diff, not a rewrite.
- A consultant who did not run it can read the report and defend each finding.

## Language

Code, documentation and the generated report are in English. Commercial and technical presentations are in Spanish.

## Naming

`Ortelis Satellite` is fictional, as are its systems, orders and people. Names are placeholders to be replaced per engagement; no real operator is depicted.
