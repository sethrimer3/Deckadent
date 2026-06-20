import type { GameState, PlayerState, SimState, ParticleType } from './types';

// ---------------------------------------------------------------------------
// Deterministic state hash for lockstep desync detection.
// Not cryptographically secure — designed for fast equality checking.
//
// INCLUDED in the hash (authoritative gameplay state):
//   - initialSeed
//   - gameplay PRNG seed
//   - sim PRNG seed
//   - tick counter
//   - turn / phase / status
//   - for each player: energy, base hp
//   - for each player: full deck, hand, discard (uid + defId, in order)
//   - for each player: generators and creatures (uid, defId, hp, hasAttacked, simX, simY)
//   - sim grid: particle type for every cell (row-major order)
//   - sim grid: particle lifetime for every non-EMPTY cell
//
// EXCLUDED from the hash (non-authoritative / visual-only):
//   - DOM/UI selection state (selectedCardUid, pendingSpellCardUid, etc.)
//   - aiActing flag
//   - combatLog strings
//   - render-only data (canvas pixels, CSS, animation frames)
//   - the hash itself (would be circular)
// ---------------------------------------------------------------------------

function djb2Update(h: number, v: number): number {
  return (((h << 5) + h) + v) >>> 0;
}

function hashString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = djb2Update(h, s.charCodeAt(i));
  return h;
}

// Stable numeric index for each particle type — must never change once set.
const TYPE_INDEX: Record<ParticleType, number> = {
  EMPTY: 0, WATER: 1, FIRE: 2, SAND: 3, SMOKE: 4, SPARK: 5, CORE: 6, WALL: 7,
};

function hashSimState(h: number, sim: SimState): number {
  h = djb2Update(h, sim.prng.seed);
  const { grid } = sim;
  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    h = djb2Update(h, TYPE_INDEX[p.type]);
    if (p.type !== 'EMPTY') {
      // Include lifetime for non-empty cells — particles age deterministically.
      h = djb2Update(h, p.lifetime | 0);
      h = djb2Update(h, p.gravity ?? 1);
    }
  }
  return h;
}

function hashPlayerState(h: number, ps: PlayerState): number {
  h = djb2Update(h, ps.energy);
  h = djb2Update(h, ps.base.hp);
  h = djb2Update(h, ps.base.simX);
  h = djb2Update(h, ps.base.simY);

  const hashCardList = (cards: { uid: string; defId: string }[]) => {
    h = djb2Update(h, cards.length);
    for (const c of cards) {
      h = hashString(h, c.uid);
      h = hashString(h, c.defId);
    }
  };
  hashCardList(ps.deck);
  hashCardList(ps.hand);
  hashCardList(ps.discard);

  const hashUnits = (units: { uid: string; defId: string; hp: number; hasAttacked: boolean; simX?: number; simY?: number }[]) => {
    h = djb2Update(h, units.length);
    for (const u of units) {
      h = hashString(h, u.uid);
      h = hashString(h, u.defId);
      h = djb2Update(h, u.hp);
      h = djb2Update(h, u.hasAttacked ? 1 : 0);
      h = djb2Update(h, (u.simX ?? 0xffff) | 0);
      h = djb2Update(h, (u.simY ?? 0xffff) | 0);
    }
  };
  hashUnits(ps.generators);
  hashUnits(ps.creatures);

  return h;
}

/** Returns a 32-bit djb2 hash of all authoritative game state. */
export function hashGameState(gs: GameState): number {
  let h = 5381;
  h = djb2Update(h, gs.initialSeed);
  h = djb2Update(h, gs.prng.seed);
  h = djb2Update(h, gs.tick);
  h = hashString(h, gs.turn);
  h = hashString(h, gs.status);
  h = hashString(h, gs.phase);
  h = hashPlayerState(h, gs.player);
  h = hashPlayerState(h, gs.enemy);
  h = hashSimState(h, gs.sim);
  // Effect ID counter — authoritative, must be included so replay desync is detectable.
  h = djb2Update(h, gs.nextEffectId);
  // Hash active combat effects — they are authoritative (drive particle spawning).
  h = djb2Update(h, gs.combatEffects.length);
  for (const fx of gs.combatEffects) {
    h = hashString(h, fx.id);
    h = hashString(h, fx.owner);   // owner is authoritative — included from Phase 5
    h = hashString(h, fx.element);
    h = hashString(h, fx.effectKind);
    h = djb2Update(h, fx.sourcePos.x);
    h = djb2Update(h, fx.sourcePos.y);
    h = djb2Update(h, fx.targetPos.x);
    h = djb2Update(h, fx.targetPos.y);
    h = djb2Update(h, fx.startTick);
    h = djb2Update(h, fx.durationTicks);
  }
  return h;
}

/** Returns the hash as a zero-padded 8-character hex string for display. */
export function hashHex(gs: GameState): string {
  return hashGameState(gs).toString(16).padStart(8, '0');
}
