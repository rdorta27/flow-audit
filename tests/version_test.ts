// SPDX-License-Identifier: MIT
import { ENGINE_VERSION } from "../src/version.ts";
import { assertEquals } from "./assert.ts";

Deno.test("engine version equals the version in deno.json", async () => {
  const raw = await Deno.readTextFile(new URL("../deno.json", import.meta.url));
  assertEquals(ENGINE_VERSION, (JSON.parse(raw) as { version: string }).version);
});
