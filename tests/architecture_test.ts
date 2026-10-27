import { assert, assertEquals } from "./assert.ts";

const DOMAIN = new URL("../src/domain/", import.meta.url);
const SPECIFIER = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

async function tsFiles(dir: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) {
      files.push(...(await tsFiles(child)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(child);
    }
  }
  return files;
}

Deno.test("domain imports nothing outside domain", async () => {
  const files = await tsFiles(DOMAIN);
  assert(files.length > 0, "no domain files found");

  for (const file of files) {
    const source = await Deno.readTextFile(file);
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      assert(
        specifier.startsWith("."),
        `${file.pathname}: domain must not import outside itself (${specifier})`,
      );
      const target = new URL(specifier, file);
      assert(
        target.pathname.startsWith(DOMAIN.pathname),
        `${file.pathname}: import escapes src/domain (${specifier})`,
      );
    }
  }
});

Deno.test("deno.json declares no runtime dependencies", async () => {
  const raw = await Deno.readTextFile(new URL("../deno.json", import.meta.url));
  const config = JSON.parse(raw) as Record<string, unknown>;

  assertEquals(config.imports ?? {}, {});
  assert(!("dependencies" in config), "deno.json declares dependencies");
  assert(!("devDependencies" in config), "deno.json declares devDependencies");
});
