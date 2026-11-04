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
| `time_zone` | `UTC` or a fixed offset (`-05:00`); named zones come with M5-08 | `UTC` |
| `columns` (`oms`) / `fields` (`bpm`, `prov`) | canonical field to the client's column or key | required |
| `ids` | per id field: `case`, `strip_prefix`, `strip_leading_zeros`, `add_prefix` | none |
| `states` | per table, the client's value to the canonical one | canonical names only |
| `on_unknown_state` | `fail` or `unmapped` | `fail` |

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
  `ended_at`, `activities`.
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

## Not done yet

Catalog blocks (`offer_key`, nested characteristics, validity gaps), BPM as several tables
joined by process id, named time zones and daylight saving (M5-08), and joins across files.
