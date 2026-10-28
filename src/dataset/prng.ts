// SPDX-License-Identifier: MIT
/** Deterministic PRNG: the dataset must be identical on every machine and run. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], inclusive. */
export function between(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
