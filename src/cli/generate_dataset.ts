// SPDX-License-Identifier: MIT
import { EXPECTED, generateDemoDataset, IMPACT_CONFIG } from "../dataset/generator.ts";
import { configToFile } from "../domain/data_files.ts";
import { serializeDataset, serializeJson } from "../adapters/export/serializers.ts";

export async function writeDataset(target: string): Promise<string[]> {
  const dataset = generateDemoDataset();
  const files: Record<string, string> = {
    ...serializeDataset(dataset),
    "config.json": serializeJson(configToFile(IMPACT_CONFIG)),
    "expected.json": serializeJson(EXPECTED),
  };

  await Deno.mkdir(target, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await Deno.writeTextFile(`${target.replace(/\/$/, "")}/${name}`, content);
  }

  return Object.keys(files).sort();
}

if (import.meta.main) {
  if (Deno.args.some((a) => a === "-h" || a === "--help")) {
    console.log(`deno task dataset [dir]

Regenerates the synthetic demo files (5,000 orders of a made-up operator) into dir
(default: data/demo). The folder must exist. -h, --help shows this help.`);
    Deno.exit(0);
  }
  const target = Deno.args[0] ?? "data/demo";
  const written = await writeDataset(target);
  console.log(`flow-audit: wrote ${written.length} files to ${target}`);
  for (const name of written) console.log(`  ${name}`);
}
