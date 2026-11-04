# Engagement layout and confidential mode

A client's data must live where it cannot enter the repository, and what leaves the machine
(the HTML report is emailed) must not carry the client's ids.

## Layout (M5-11)

One directory per client, outside any repository:

```
<engagement>/
  raw/       the exports as received (catalog.json, oms_orders.csv, ...). Never written to.
  mapping/   mapping.json: the client's columns and states (mapping.md)
  config/    config.json: the impact rates for this client
  out/       findings.json, findings.csv, report.html, quality.json
```

`--engagement <dir>` or `FLOW_AUDIT_HOME=<dir>` (the flag wins) turns on the layout. Then
`--dataset`, `--mapping`, `--config` and `--out` default to `raw/`, `mapping/mapping.json`,
`config/config.json` (when present; otherwise the demo config) and `out/` (created when
missing). An explicit flag still wins. `deno task audit --engagement ~/engagements/acme --check`
reads, maps and runs the gate against that client's export and writes only `quality.json`.

The engine refuses, with exit code 2 and a message that says what to do:

- an engagement directory inside this repository, or inside any directory that has a `.git`;
- an output directory that is, or is inside, the input directory (`raw/`, or `--dataset`),
  engagement or not. The table of `--redact` obeys the same rule.

Permissions: the `audit` task reads anywhere (a client's export lives wherever the analyst put
it) and writes only under `./out`. To write results into an engagement, use the sibling task,
which may write only under the directory named by the variable:
`FLOW_AUDIT_HOME=~/engagements/acme deno task engagement --check`. Without the variable the
task stops at start (an empty write scope is not allowed). `FLOW_AUDIT_HOME` and
`FLOW_AUDIT_REDACT_SECRET` are the only environment variables added to the allow-list.

## Confidential mode (M5-12)

- **`pii: true` in the mapping.** A block (`oms`, `bpm`, `prov`) may carry
  `"pii": { "terminal_serial": true }`. A marked field is dropped when the file is read: it is
  declared not observable, so it reaches no rule, no finding and no report, and the coverage
  line says it is not observable. A required field cannot be marked.
- **`--redact --client <name>`.** Every id the input carries (orders, service orders, work
  orders, processes, attempts, terminal serials) becomes a stable pseudonym in `findings.json`,
  `findings.csv` and `report.html`: `HMAC-SHA256(secret, id)` shortened, with the prefix
  `ord-`, `ser-` or `ref-`. A token is replaced only when it is a whole id. The secret is
  `FLOW_AUDIT_REDACT_SECRET`; with it the same input gives the same pseudonyms, without it
  the run draws a random one. The report is told apart by the banner
  `Confidential — <client> · <date>` added at the top of `report.html`.
- **The equivalence table** (`pseudonym,original,kind`) is written apart, never inside a
  report: `redaction_table.csv` in `--out` (mode 0600) or the file of `--redaction-table`.
  Keep it, and do not send it. Redaction does not touch the lines printed on the terminal.
- Counts, hours, rule ids and the data fingerprints (`sha256`) are not ids and stay as they are.
