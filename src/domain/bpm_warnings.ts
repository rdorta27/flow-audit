// SPDX-License-Identifier: MIT
/**
 * What the BPM model cannot follow (M2-10): a multi-instance loop and an event subprocess.
 * The engine reads the records but does not model them, so a person is told instead of the
 * numbers looking complete. Pure.
 */

import type { ProcessInstance } from "./model.ts";

/** One warning per kind of construct found, empty when there is none. */
export function bpmWarnings(processes: readonly ProcessInstance[]): string[] {
  const looped = processes.filter((p) => p.loopIndex !== undefined);
  const events = processes.filter((p) => p.activities?.some((a) => a.eventSubprocess === true));
  const out: string[] = [];
  const sample = (list: readonly ProcessInstance[]) =>
    list.slice(0, 3).map((p) => p.processId).join(", ") + (list.length > 3 ? ", ..." : "");
  if (looped.length > 0) {
    out.push(
      `warning: ${looped.length} process(es) carry a loop index (multi-instance, for example ` +
        `${
          sample(looped)
        }); each instance is read as a separate process and the loop is not modelled`,
    );
  }
  if (events.length > 0) {
    out.push(
      `warning: ${events.length} process(es) hold an event subprocess (for example ` +
        `${sample(events)}); it is read as an ordinary activity and its trigger is not modelled`,
    );
  }
  return out;
}
