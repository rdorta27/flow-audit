# Report style: system colours

One colour per system, the same in the public site (`site/site/style.css`) and in the
engine's HTML report. Copy these values; do not invent others. The report follows the
reader's light or dark preference, like the site.

| Token | Meaning | Dark | Light | Use |
|---|---|---|---|---|
| `--s-sale` | Sales channel | `#a3d4d5` | `#4e8ca2` | chips, borders, journey marks |
| `--s-cat` | Catalog | `#98bb6c` | `#6f894e` | same |
| `--s-oms` | Order manager (OMS) | `#7e9cd8` | `#4d699b` | same |
| `--s-bpm` | Orchestrator (BPM) | `#957fb8` | `#624c83` | same |
| `--s-prov` | Provisioning | `#ffa066` | `#cc6d00` | same |
| `--fa` | Flow Audit | `#e6c384` | `#8a6200` | Flow Audit reading layer, never inside the order path |
| `--crit` | Problem / gap | `#e46876` | `#c84053` | gaps, problem chips |

Backgrounds: `--bg` `#1f1f28` / `#f2ecbc`, `--card` `#2a2a37` / `#f9f5d7`.

Contrast (WCAG, text on `--bg` / `--card`): dark, all at least 4.5:1 on `--bg`; on `--card`
`--s-bpm` is 4.04 and `--crit` 4.40, so use those two as marks only on cards. Light:
`--s-sale`, `--s-cat`, `--s-prov` (about 3.0 to 3.6) and `--crit` (4.06 / 4.42) are marks
only (dots, borders, fills), never body text. `--s-oms`, `--s-bpm` and `--fa` reach AA in light.
Always show the system name next to its colour.

Note: the site's existing `--crit` is `#f08a94` (dark) / `#b4232f` (light), already AA for
text; the table values are the prototype's mark values. Pick one before M4-03.
