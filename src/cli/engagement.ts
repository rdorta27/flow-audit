// SPDX-License-Identifier: MIT
/**
 * The engagement layout (M5-11): one directory per client, outside the repository.
 *
 *   <engagement>/raw/      the client's exports, as received, never written to
 *   <engagement>/mapping/  mapping.json, the client's columns and states
 *   <engagement>/config/   config.json, the impact rates for this client
 *   <engagement>/out/      findings.json, findings.csv, report.html, quality.json
 *
 * The directory comes from `--engagement <dir>` or `FLOW_AUDIT_HOME`. The engine refuses an
 * engagement that is inside a repository, and an output directory inside the input.
 */

/** Absolute, normalised path (`/` separators; `.` and `..` folded). */
function resolve(...parts: string[]): string {
  const joined = parts.reduce((acc, p) => p.startsWith("/") ? p : `${acc}/${p}`, Deno.cwd());
  const out: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

export class EngagementError extends Error {
  constructor(what: string, readonly where: string | null, readonly next: string) {
    super(what);
    this.name = "EngagementError";
  }
}

export interface Engagement {
  dir: string;
  raw: string;
  mapping: string;
  config: string;
  out: string;
}

/** The root of this repository, found from the location of the code. */
export const ENGINE_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname).replace(
  /\/$/,
  "",
);

/** Real path of the nearest existing ancestor plus the part that does not exist yet. */
function realish(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      return resolve(Deno.realPathSync(current), ...rest);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      rest.unshift(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/** True when `child` is `parent` or lies inside it. */
export function isInside(child: string, parent: string): boolean {
  const [c, p] = [realish(child), realish(parent)];
  return c === p || c.startsWith(p === "/" ? "/" : `${p}/`);
}

function inGitRepository(dir: string): string | null {
  let current = realish(dir);
  for (;;) {
    try {
      Deno.statSync(`${current}/.git`);
      return current;
    } catch { /* keep walking up */ }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Resolves the engagement from the flag or from `FLOW_AUDIT_HOME` (the flag wins); null when
 * neither is set. Refuses a directory that is inside this repository or any git repository.
 */
export function resolveEngagement(
  flag: string | undefined,
  env: (name: string) => string | undefined,
): Engagement | null {
  const given = flag ?? (env("FLOW_AUDIT_HOME") || undefined);
  if (!given) return null;
  const dir = resolve(given);
  try {
    if (!Deno.statSync(dir).isDirectory) throw new Error("not a directory");
  } catch {
    throw new EngagementError(
      `the engagement directory ${given} does not exist`,
      given,
      "create it with raw/, mapping/, config/ and out/ inside (docs/architecture/engagement.md)",
    );
  }
  const repo = isInside(dir, ENGINE_ROOT) ? ENGINE_ROOT : inGitRepository(dir);
  if (repo) {
    throw new EngagementError(
      `the engagement directory is inside a repository (${repo}); a client's data must never ` +
        "be where it could be committed",
      given,
      "move the engagement outside any repository, for example ~/engagements/<client>, and point " +
        "FLOW_AUDIT_HOME or --engagement at it",
    );
  }
  return {
    dir,
    raw: `${dir}/raw`,
    mapping: `${dir}/mapping/mapping.json`,
    config: `${dir}/config/config.json`,
    out: `${dir}/out`,
  };
}

/** Refuses an output directory that is, or is inside, the directory the data is read from. */
export function assertOutNotInInput(out: string, input: string): void {
  if (isInside(out, input)) {
    throw new EngagementError(
      `the output directory ${out} is inside the input ${input}; the inputs are never written to`,
      out,
      "choose another --out, for example <engagement>/out",
    );
  }
}

export function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}
