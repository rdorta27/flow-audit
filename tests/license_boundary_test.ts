// SPDX-License-Identifier: MIT
import { assert, assertEquals } from "./assert.ts";

/**
 * The license boundary, as an executable rule.
 *
 * Flow Audit is MIT and ships no third-party code. The systems it reads are
 * reached over HTTP and keep their own licenses. When any of that stops being
 * true, this test fails instead of a document going stale.
 */

const ROOT = new URL("../", import.meta.url);
const SKIP = new Set([".git", "node_modules", "vendor", "third_party"]);
const IMPORT = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

async function walk(dir: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (SKIP.has(entry.name)) continue;
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) {
      files.push(...(await walk(child)));
    } else {
      files.push(child);
    }
  }
  return files;
}

const rel = (file: URL) => file.pathname.slice(ROOT.pathname.length);

Deno.test("the engine ships under MIT", async () => {
  const license = await Deno.readTextFile(new URL("LICENSE", ROOT));
  assert(license.includes("MIT License"), "LICENSE is missing the MIT heading");
  assert(
    license.includes("Permission is hereby granted, free of charge"),
    "LICENSE does not contain the MIT grant",
  );
  assert(license.includes("Copyright (c) 2026"), "LICENSE is missing the copyright line");
});

Deno.test("every source file declares its license", async () => {
  for (const dir of ["src/", "tests/"]) {
    for (const file of await walk(new URL(dir, ROOT))) {
      if (!file.pathname.endsWith(".ts")) continue;
      const source = await Deno.readTextFile(file);
      assert(
        source.startsWith("// SPDX-License-Identifier: MIT"),
        `${rel(file)}: missing the SPDX identifier on the first line`,
      );
    }
  }
});

Deno.test("the package metadata declares MIT and no runtime import", async () => {
  const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", ROOT)));
  assertEquals(config.license, "MIT", "deno.json must declare the MIT license");
  assertEquals(config.imports, undefined, "the engine must declare no runtime imports");
});

Deno.test("the engine imports no remote module", async () => {
  for (const file of await walk(new URL("src/", ROOT))) {
    if (!file.pathname.endsWith(".ts")) continue;
    const source = await Deno.readTextFile(file);
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      assert(
        specifier.startsWith("."),
        `${rel(file)}: remote import ${specifier} would bring third-party code at runtime`,
      );
    }
  }
});

Deno.test("no third-party code is vendored", async () => {
  const forbidden = /\.rs$|^Cargo\.toml$|^Cargo\.lock$|^go\.mod$|^package-lock\.json$/;
  for (const file of await walk(ROOT)) {
    assert(
      !forbidden.test(file.pathname.split("/").pop() ?? ""),
      `${rel(file)}: vendored source of another language is not allowed`,
    );
  }
});

Deno.test("only synthetic data is committed", async () => {
  for (const file of await walk(new URL("data/", ROOT))) {
    assert(
      rel(file).startsWith("data/demo/"),
      `${rel(file)}: only data/demo/ may be committed`,
    );
  }
});

Deno.test("captures from other systems stay out of the repository", async () => {
  const ignore = await Deno.readTextFile(new URL(".gitignore", ROOT));
  for (const rule of ["data/raw/", "*.capture.json"]) {
    assert(ignore.includes(rule), `.gitignore must keep ${rule} out of the repository`);
  }
});

Deno.test("the boundary and the trademarks are documented", async () => {
  const notices = await Deno.readTextFile(new URL("THIRD-PARTY.md", ROOT));
  assert(
    notices.includes("not distributed"),
    "THIRD-PARTY.md must state that the test systems are not distributed",
  );
  const marks = await Deno.readTextFile(new URL("TRADEMARKS.md", ROOT));
  assert(marks.includes("TM Forum"), "TRADEMARKS.md must cover the TM Forum marks");
});
