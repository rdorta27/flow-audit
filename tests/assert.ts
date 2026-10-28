// SPDX-License-Identifier: MIT
export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message ?? "values differ"}\n  actual:   ${left}\n  expected: ${right}`);
  }
}
