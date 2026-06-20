import type { GameState, UnitInstance } from './types';
import { SIM_W, SIM_H } from './sandSim';

// ---------------------------------------------------------------------------
// Deterministic creature movement system.
//
// All movement uses integer arithmetic — no floating-point accumulation, no
// Math.random. Because simX/simY are integers and are already included in the
// state hash, movement is automatically reflected in hash comparisons.
//
// Speed table (ticks between 1-pixel steps):
//   Emberling  (FIRE)    — every 3 ticks  (fast)
//   Water Wisp (WATER)   — every 4 ticks  (medium; "glides")
//   Stone Mite (EARTH)   — every 6 ticks  (slow)
//   fallback   (NEUTRAL) — every 5 ticks
//
// Movement direction:
//   Player creatures: simY decreases each step (march toward enemy base at top).
//   Enemy  creatures: simY increases each step (march toward player base at bottom).
//
// Boundary:
//   Player creatures stop at y = MOVE_Y_MIN (near top).
//   Enemy  creatures stop at y = MOVE_Y_MAX (near bottom).
//
// Collision separation:
//   After all movement, a single O(n²) pass over creatures on the same team
//   nudges overlapping units apart in X by 1 pixel.  The direction of the nudge
//   is deterministic: the unit whose UID sorts earlier in string comparison moves
//   left; the other moves right.  Both units are clamped to battlefield bounds.
//   This prevents stacking without introducing floating-point chaos.
// ---------------------------------------------------------------------------

/** Ticks between 1-pixel vertical steps for each creature type. */
const MOVE_SPEED: Record<string, number> = {
  emberling:   3,
  water_wisp:  4,
  stone_mite:  6,
};

const MOVE_SPEED_DEFAULT = 5;

/** Minimum simY for player creatures (close to enemy base area). */
const MOVE_Y_MIN = 4;
/** Maximum simY for enemy creatures (close to player base area). */
const MOVE_Y_MAX = SIM_H - 5;

/** Radius used for separation checks (Chebyshev distance). */
const SEPARATION_RADIUS = 8;

function speedFor(defId: string): number {
  return MOVE_SPEED[defId] ?? MOVE_SPEED_DEFAULT;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Move a single creature one step if the tick modulus matches its speed. */
function stepCreature(unit: UnitInstance, tick: number, dy: number): void {
  if (unit.simX === undefined || unit.simY === undefined) return;
  const speed = speedFor(unit.defId);
  if (tick % speed !== 0) return;
  unit.simY = clamp(unit.simY + dy, MOVE_Y_MIN, MOVE_Y_MAX);
}

/**
 * Deterministic separation pass — prevents creatures on the same team from
 * stacking on exactly the same pixel.
 *
 * Non-authoritative regarding *which* creatures overlap (that changes each tick),
 * but the resolution is deterministic: UID string comparison decides direction.
 * The result is included in the hash via simX/simY.
 */
function separateTeam(units: UnitInstance[]): void {
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (a.simX === undefined || a.simY === undefined) continue;
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (b.simX === undefined || b.simY === undefined) continue;
      const dx = Math.abs(a.simX - b.simX);
      const dy = Math.abs(a.simY - b.simY);
      if (dx > SEPARATION_RADIUS || dy > SEPARATION_RADIUS) continue;
      // UID string comparison is deterministic — consistent across machines.
      const aFirst = a.uid < b.uid;
      a.simX = clamp(a.simX + (aFirst ? -1 : 1), 0, SIM_W - 1);
      b.simX = clamp(b.simX + (aFirst ? 1 : -1), 0, SIM_W - 1);
    }
  }
}

/**
 * Advance all creature positions by one deterministic step.
 * Called once per fixed tick from main.ts.
 *
 * Generators do not move (they are placed structures).
 * Dead units are cleaned up separately by destroyDeadUnits.
 */
export function updateCreatureMovement(gs: GameState): void {
  const tick = gs.tick;

  // Player creatures march upward (dy = -1).
  for (const unit of gs.player.creatures) stepCreature(unit, tick, -1);
  // Enemy creatures march downward (dy = +1).
  for (const unit of gs.enemy.creatures) stepCreature(unit, tick, +1);

  // Separate overlapping units within each team.
  separateTeam(gs.player.creatures);
  separateTeam(gs.enemy.creatures);
}
