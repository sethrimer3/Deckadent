import type { GameState, PlayerState } from './types';

// ---------------------------------------------------------------------------
// Deterministic state hash for debugging future lockstep desyncs.
// Hashes authoritative gameplay state only — not DOM, not visual particles.
// Not cryptographically secure; designed for fast equality checking.
// ---------------------------------------------------------------------------

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function playerKey(ps: PlayerState): string {
  const gens = ps.generators.map(u => `${u.uid}:${u.hp}:${u.hasAttacked ? 1 : 0}`).join(',');
  const creatures = ps.creatures.map(u => `${u.uid}:${u.hp}:${u.hasAttacked ? 1 : 0}`).join(',');
  const hand = ps.hand.map(c => `${c.uid}:${c.defId}`).join(',');
  return `e${ps.energy}|g[${gens}]|c[${creatures}]|h[${hand}]|d${ps.deck.length}`;
}

/** Returns a 32-bit unsigned integer hash of the authoritative gameplay state. */
export function hashGameState(gs: GameState): number {
  const key = [
    `t${gs.tick}`,
    gs.turn,
    gs.status,
    `p{${playerKey(gs.player)}}`,
    `e{${playerKey(gs.enemy)}}`,
    `seed${gs.prng.seed}`,
  ].join('|');
  return djb2(key);
}

/** Returns the hash as a zero-padded 8-character hex string. */
export function hashHex(gs: GameState): string {
  return hashGameState(gs).toString(16).padStart(8, '0');
}
