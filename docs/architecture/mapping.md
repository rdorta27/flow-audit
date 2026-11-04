# Mapping file for client exports

A client names its columns its own way. The mapping is configuration (`mapping.json`, one per
client), not code: `deno task audit --dataset <dir> --mapping <file>` reads the exports in
`<dir>` as the mapping says. The default is `data/demo/mapping.json`. Keys are snake_case.

A client's mapping is private: `*.mapping.json` and `mapping.*.json` are ignored by git
(`.gitignore`, checked by `tests/license_boundary_test.ts`). Only the demo mapping is committed.

## Shape

```
{
  "simulated": true,                       // the files hold invented data (report label)
  "period": { "start", "end" },            // optional: the audited period (ISO dates)
  "quality": { ... },                      // optional: gate thresholds (quality.md)
  "catalog": { "file", "evidence_kind" },  // optional
  "oms":  { ... },                         // required: orders, service orders, work orders
  "bpm":  { ... },                         // optional: processes and their activities
  "prov": { ... }                          // required: activation attempts
}
```

Each of `oms`, `bpm` and `prov` takes:

| Key | Meaning | Default |
|---|---|---|
| `file` | file name inside `--dataset` | required |
| `format` | `csv` (`oms`) or `jsonl` (`bpm`, `prov`) | required |
| `delimiter` | one character, CSV only | `,` |
| `encoding` | any `TextDecoder` label (`utf-8`, `windows-1252`) | `utf-8` |
| `evidence_kind` | `history` (transitions with their own times) or `snapshot` | `history` |
| `date_format` | `iso8601` or a pattern of `yyyy MM dd HH mm ss SSS` (`dd/MM/yyyy HH:mm`) | `iso8601` |
| `time_zone` | `UTC`, a fixed offset (`-05:00`) or a named IANA zone (`America/Bogota`, `Europe/Madrid`) | `UTC` |
| `columns` (`oms`) / `fields` (`bpm`, `prov`) | canonical field to the client's column or key | required |
| `ids` | per id field: `case`, `strip_prefix`, `strip_leading_zeros`, `add_prefix` | none |
| `states` | per table, the client's value to the canonical one | canonical names only |
| `on_unknown_state` | `fail` or `unmapped` | `fail` |
| `pii` | `{ "<field>": true }`: the field is dropped on reading and never reaches a report (engagement.md) | none |

`oms` also takes these optional fields, which a mapping may leave out entirely (M2-08): `so_action`
(`add`, `modify`, `delete`, `noChange`; read by R04), and the order-line columns `item_ref` (the
item the service order decomposes), `item_offer_id`, `item_spec_id`, `item_action`,
`parent_item_ref` (bundle) and `replaces_item_ref`. With `item_ref` mapped, an order's lines are
the distinct items of its rows; `replaces_order_ref` already declares an amended order.

`oms` also takes `single_line_orders` (every order sells one line, so the item is
`<order>-1`; without it R04 cannot tell a duplicate from a second line), and `bpm` takes
`activity_fields` for the activities nested in each process.

## Fields

Every canonical field must be declared. Name its column, or write `null` to declare it **not
observable**; `null` is not allowed on a required field. A column that is not in the file is an
error naming the field it was mapped from.

- `oms`: required `order_ref`, `submitted_at`, `order_state`, `offer_id`, `so_ref`, `spec_id`,
  `so_state`, `so_created_at`; optional `offer_version`, `replaces_order_ref`,
  `terminal_serial`, `wo_ref`, `wo_kind`, `wo_state`, `wo_created_at`.
- `bpm`: required `process_id`, `state`, `started_at`; optional `so_ref`, `business_key`,
  `ended_at`, `activities`. BPM model v2 (all optional, may be left out of the mapping, which
  reads as not observable): in `fields` `suspended`, `end_reason`, `parent_process_id`,
  `root_process_id`, `process_definition_key`, `process_definition_version`, `loop_index`,
  `incidents` (a nested list of `type`, `created_at`, `resolved_at`, `message`); in
  `activity_fields` `timer_kind`, `interrupting`, `attached_to`, `due_date`, `fired_at`,
  `next_activity_id`, `task_id`, `assignee`, `candidate_group`, `created_at`, `claimed_at`,
  `due_at`, `event_subprocess` (a flag; the engine warns when it is true). R03 reads which timers and which compensations to watch from `rules.r03` of
  `config.json` (`timer_activities`, `compensation_activities`, `compensation_processes`,
  `human_management_tasks`), not from the mapping.
- `prov`: required `attempt_id`, `state`, `started_at`; optional `so_ref`, `serial`,
  `error_code`, `ended_at`.

A CSV that repeats the order on every service order row is merged by key: the first row of an
`order_ref`, `so_ref` or `wo_ref` wins and the repeats are counted in the coverage report.

## State tables

Tables: `order`, `service_order` (canonical: `DRAFT`, `SUBMITTED`, `VALIDATED`, `DECOMPOSED`,
`SCHEDULED`, `INSTALLED`, `PROVISIONING`, `ACTIVE`, `FAILED`, `CANCELLED`, `REJECTED`, `HELD`,
`PARTIAL`, `CANCELLING`), `attempt` (`pending`, `failed`, `succeeded`), `work_order_kind`
(`installation`, `activation`, `recovery`), and the free-text `work_order` and `process`.
Values are matched without case. A value the table lacks fails naming the file, line, field and
the value; with `on_unknown_state: "unmapped"` the row is kept as `UNMAPPED` (`unmapped` for an
attempt) with the text in `rawState`, and the coverage report counts it.

## Ids

Applied in this order: trim, `case`, `strip_prefix`, `strip_leading_zeros`, `add_prefix`. Give
the same rules to a reference in every file that carries it (`so_ref` in `oms`, `bpm`, `prov`).

## Errors and the coverage report

A mapping error names the mapping file, the line and the dotted path of the field
(`client.mapping.json:14 field "oms.columns.colour": unknown field`). A bad row names the data
file, the line and the client's column. Both exit with code 1.

After the audit, one `Coverage` line per file says how many rows were read, the share with every
state mapped, the share of values mapped per state table (and which were not), the repeated rows
merged, and the fields declared not observable.

## Time zones and the period

Every timestamp is stored in UTC. A text that carries `Z` or an offset keeps it; a text with
none is read as wall-clock time in the file's `time_zone`. A named zone is resolved with
`Intl` on the date of each timestamp, so daylight saving is applied where the zone has it
(`Europe/Madrid`: 2026-07-01 12:00 is 10:00Z, 2026-01-15 12:00 is 11:00Z). A wall time that
happens twice (clocks go back) is read as the first; one that never happens (clocks go
forward) moves on by the gap. An unknown name is a mapping error naming `time_zone`. A copy of
an export written in local time gives the same records, and the same findings, once its zone
is declared (tested with `Europe/Madrid`).

`period` gives `start` and `end` (`2026-09-01`, or a full ISO instant; a bare `end` date means
the end of that day). It is the window the gate measures every system against; without it the
window is the span of the order export. Orders submitted outside a declared `period` are
removed before the rules run, together with the service orders, processes and attempts
correlated to them; the counts are in `period.removed` of `findings.json`. R03 ends its days stuck
at the declared `period.end`. A timestamp that was not already `...Z` keeps its original
text next to the UTC value (`submittedAtRaw`, `createdAtRaw`, `startedAtRaw`, `endedAtRaw`);
the text is not part of the source fingerprint. `quality` may override the gate's thresholds
(`min_rows`, `min_window_coverage`, `max_orphan_share`, `max_unknown_state_share`); see
`quality.md`.

## One system in several files

A `bpm` or `prov` block (JSON lines) can name more files of the same system and a key to join
them by. The key is the field both files carry, by its name in the files:

```json
"bpm": {
  "file": "processes.jsonl",
  "join": [
    { "file": "activities.jsonl", "key": "process_id", "as": "activities" },
    { "file": "incidents.jsonl", "key": "process_id", "as": "incidents" }
  ]
}
```

With `as`, every matching row of the other file becomes an object in a list under that field,
which `columns` and `activity_fields` then read as if it were nested in the main file. Without
`as`, each main row takes the fields of its one matching row (a field the main row already has
wins); two matching rows fail and say to set `as`. A row of a joined file with no key fails
naming the file and line. The engine never guesses a key. The demo has no `join` block.

## Not done yet

Catalog blocks (`offer_key`, nested characteristics, validity gaps), joins for the CSV block
(`oms`) and joins across systems.
