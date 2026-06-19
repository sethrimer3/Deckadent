// Mulberry32 — fast, seedable, serializable uint32 PRNG.
// State is a plain object so it can be JSON-serialized for save/replay/lockstep.

export interface PRNGState {
  seed: number; // uint32
}

export function createPRNG(seed: number): PRNGState {
  return { seed: seed >>> 0 };
}

export function nextUint32(state: PRNGState): number {
  let s = (state.seed + 0x6d2b79f5) >>> 0;
  state.seed = s;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return (s ^ (s >>> 14)) >>> 0;
}

export function nextFloat(state: PRNGState): number {
  return nextUint32(state) / 0x100000000;
}

/** Returns integer in [min, max). */
export function nextInt(state: PRNGState, min: number, max: number): number {
  return min + (nextUint32(state) % (max - min));
}

/** Returns true with the given probability. */
export function chance(state: PRNGState, probability: number): boolean {
  return nextFloat(state) < probability;
}

/** Creates an independent child PRNG derived from this state. */
export function fork(state: PRNGState): PRNGState {
  return createPRNG(nextUint32(state));
}
