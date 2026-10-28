// SPDX-License-Identifier: MIT
/** Injected so reconstruction is deterministic in tests, not dependent on today. */
export interface Clock {
  nowIso(): string;
}
