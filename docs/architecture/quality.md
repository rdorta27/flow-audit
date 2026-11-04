# Data-quality gate

M5-02 validates rows; the gate (`src/domain/quality.ts`, M5-10) validates the dataset. It runs
after the sources are read, mapped and correlated and before any rule. A partial export, ranges
that differ per system, the same file loaded twice or a state the mapping does not know would
otherwise produce false findings, or a silent zero that reads as "healthy".

## What it measures, per system

| Measure | Where it comes from |
|---|---|
| records | distinct records after repeats were dropped |
| time range | oldest and newest timestamp of the mapped records (orders: `submitted_at` and service order creation; activations and processes: `started_at`) |
| repeats | by key (the second record with a key already seen) and exact (identical to the first). The readers drop them and count them: the key is `so_ref` for the order export, `process_id`, `attempt_id` |
| no parent | service orders, processes and activations that correlation could not place under one order, over all of that system's records |
| unknown states | values the mapping did not know (`on_unknown_state: "unmapped"`), by text |
| coverage | the share of the audited window the system's range spans. The window is `period` when the mapping declares one, else the span of the order export |

## Pass or fail

The gate fails when, for a required system (OMS, PROV): it has no records or fewer than
`min_rows` (10); or, for any system: coverage is under `min_window_coverage` (0.90), the share
with no parent is over `max_orphan_share` (0.10), or the share of unknown states is over
`max_unknown_state_share` (0.01). The defaults are in `DEFAULT_THRESHOLDS`; a client changes
them in the mapping's `quality` block. Repeats do not fail the gate: they are removed and
reported as a warning with the count (a doubled file gives the same findings as the original).
Ranges that do not overlap add a warning. The demo passes from files and from the stub (the stub
has 300 activations with no reference, 5.6%, which is why the orphan default is 10%).

The gate also reports the `commonWindow`, where every present system has records. It is
informational for now: rules still see every record (see "Not done").

## Not evaluable

`notEvaluableRules` lists the rules whose system is absent or thin (no records, fewer than
`min_rows`, or low coverage). `runAudit` skips them, the CLI prints
`R0x not evaluated: <reason>; this is not "0 findings"`, and `quality.json` lists them. A rule
declares what it needs in `RULE_SYSTEMS` (`quality.ts`); a rule not listed needs the orders.
R04 needs OMS. Adding a rule is one line there.

## Using it

- `runAudit(options, { ..., gate: { force } })` runs the gate; without `gate` none runs (tests
  of the pipeline keep working on tiny fixtures). A failed gate throws `QualityGateError`
  carrying the `QualityReport`; with `force: true` the run goes on and `quality.forced` is true.
- `checkAudit(deps)` reads, maps and gates, nothing else.
- `deno task audit --check` is `checkAudit`; `--force` is `force`. The CLI always gates.
- Exit code 3: the data failed the gate. The CLI prints the `Quality` lines and the problems on
  stdout, then the error (what, where, what to do) on stderr.
- `quality.json` (schema `quality/1`, snake_case) is written to `--out` in every mode, also
  when the gate fails. It carries the thresholds, the window, every system's measures, the
  problems, the warnings and the not-evaluable rules. Figures in the CLI are hours only.

## Not done

- The report (`report.html`, `findings.json`) does not carry a quality section or a "forced"
  mark yet; only `quality.json` and the CLI say so.
- Rules run on every record, not only on the common window of the systems they need.
- Records outside a declared `period` are measured, not removed.
