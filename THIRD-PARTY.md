# Third-party components

Flow Audit is MIT (see `LICENSE`). This file separates what ships with this repository
from what the tool reads while it runs, and states the rule that keeps the two apart.

## Distributed with this repository

None. The engine has no runtime dependencies: `deno.json` declares no imports, every file
under `src/` and `tests/` carries `SPDX-License-Identifier: MIT`, and there is no vendored
code.

The sibling site repository ships two fonts under their own licenses. They are listed
there, not here.

## Used only for testing, not distributed

These systems are read over HTTP while validating an integration. No code is copied,
vendored or linked, and no capture taken from them is committed.

| System | License | How we use it |
|---|---|---|
| bss-oss-rust | Apache-2.0 plus additional terms on `crates/tmf-apis/`; MIT declared per crate elsewhere | Local Docker, `GET` on the TMF APIs. See `../specs/flow-audit_BACKLOG.md`, M0-05 |
| Openslice | Apache-2.0 | Fallback candidate, not yet evaluated (M0-06) |

Those licenses are theirs, not ours, and they do not extend to Flow Audit. Read them in
their repositories before relying on any term.

## Boundary rule

- Flow Audit never copies, vendors or links third-party source. It reads APIs.
- A capture from a third-party system is written under `data/raw/` or `*.capture.json`,
  both ignored by Git. It is not committed.
- Only synthetic data is committed, under `data/demo/`.
- `tests/license_boundary_test.ts` fails the build when any of this stops being true.

## Trademarks

See `TRADEMARKS.md`.
