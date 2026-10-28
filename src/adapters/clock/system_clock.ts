// SPDX-License-Identifier: MIT
import type { Clock } from "../../ports/clock.ts";

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};
