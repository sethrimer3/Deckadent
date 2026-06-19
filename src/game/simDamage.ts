import { chance } from './prng';
import type { GameState, SimState, UnitInstance } from './types';
import { destroyDeadUnits, checkWinLoss } from './rules';

// ---------------------------------------------------------------------------
// Particle-overlap damage resolver.
//
// This runs once per fixed tick and checks whether hot particles (FIRE/SPARK)
// are in contact with units or core cells. When they are, damage is applied
// probabilistically using the sim PRNG so outcomes are deterministic.
//
// Current behaviour is intentionally conservative (low probabilities, coarse
// radius check). This is scaffolding — the full simulation-authority damage
// model described in DESIGN_GUIDELINES.md §Cards as Physical Actions will
// replace direct HP subtraction in a future phase.
//
// Direct HP subtraction from card plays and attacks is still the primary
// damage source and lives in rules.ts. Particle damage supplements it.
// ---------------------------------------------------------------------------

const PARTICLE_DAMAGE_RADIUS = 6;
const UNIT_FIRE_DAMAGE_PROB  = 0.35; // probability of 1 HP per 30-tick check
const BASE_FIRE_DAMAGE_PROB  = 0.25;

function countHotNearby(sim: SimState, cx: number, cy: number): number {
  let count = 0;
  const r = PARTICLE_DAMAGE_RADIUS;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
      const t = sim.grid[ny * sim.width + nx].type;
      if (t === 'FIRE' || t === 'SPARK') count++;
    }
  }
  return count;
}

function damageUnit(unit: UnitInstance, sim: SimState): void {
  if (unit.simX === undefined || unit.simY === undefined) return;
  const hot = countHotNearby(sim, unit.simX, unit.simY);
  if (hot > 0 && chance(sim.prng, UNIT_FIRE_DAMAGE_PROB)) {
    unit.hp--;
    // destroyDeadUnits is called after all units are checked — no early exit needed.
  }
}

/**
 * Run particle-overlap damage for a single fixed tick.
 * Only executes every 30 ticks (~1 second) to keep damage rates reasonable.
 * Uses gs.sim.prng for all random decisions — fully deterministic.
 */
export function resolveSimDamage(gs: GameState): void {
  // TODO (see DESIGN_GUIDELINES.md §Move Damage Toward Sim Authority): when
  // the sim becomes the primary damage source, remove the 30-tick gate and
  // integrate fine-grained per-tick accumulation here.
  if (gs.tick % 30 !== 0) return;

  const { sim, player, enemy } = gs;

  // Damage units
  for (const unit of [
    ...player.generators, ...player.creatures,
    ...enemy.generators,  ...enemy.creatures,
  ]) {
    damageUnit(unit, sim);
  }

  // Damage player/enemy bases
  for (const ps of [player, enemy]) {
    const { base } = ps;
    const hot = countHotNearby(sim, base.simX, base.simY);
    if (hot > 0 && chance(sim.prng, BASE_FIRE_DAMAGE_PROB)) {
      base.hp = Math.max(0, base.hp - 1);
      // TODO (see DESIGN_GUIDELINES.md §Win Condition): when base.hp hits 0
      // this player should lose. Generator-based win/loss still primary for now.
      if (base.hp === 0) {
        gs.combatLog.push(`${base.owner === 'player' ? 'Player' : 'Enemy'} base core overheated!`);
      }
    }
  }

  // Clean up any units that died from particle damage
  destroyDeadUnits(gs);
  checkWinLoss(gs);
}
