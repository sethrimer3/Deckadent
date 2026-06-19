import { chance } from './prng';
import type { GameState, SimState, UnitInstance } from './types';
import { CARD_DEFS } from './cards';
import { destroyDeadUnits, checkWinLoss } from './rules';
import { countCoreCells } from './state';

// ---------------------------------------------------------------------------
// Particle-overlap damage resolver.
//
// Runs every 30 ticks (~1 second). Uses gs.sim.prng for full determinism.
//
// CORE cells are the authoritative source for base.hp: fire erosion removes
// CORE cells, base.hp is synced from the count after each resolution pass.
// Direct HP attacks in rules.ts are a temporary fallback for abstract combat.
// TODO: route card attacks through sim particles (sim-authority pass).
// ---------------------------------------------------------------------------

const PARTICLE_DAMAGE_RADIUS = 6;
const UNIT_FIRE_DAMAGE_PROB  = 0.35;
// WATER element units resist fire damage significantly.
const WATER_FIRE_DAMAGE_PROB = 0.08;
// Each CORE cell adjacent to fire has this chance per 30-tick check of being removed.
const CORE_FIRE_REMOVE_PROB  = 0.04;
const CORE_FIRE_RADIUS       = 3;

// Per-uid cooldown so particle damage logs don't spam every second.
const LOG_COOLDOWN_TICKS = 90;
const _lastLogTick = new Map<string, number>();

function shouldLog(uid: string, tick: number): boolean {
  const last = _lastLogTick.get(uid) ?? -LOG_COOLDOWN_TICKS;
  if (tick - last >= LOG_COOLDOWN_TICKS) {
    _lastLogTick.set(uid, tick);
    return true;
  }
  return false;
}

function countHotNearby(sim: SimState, cx: number, cy: number, radius: number): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
      const t = sim.grid[ny * sim.width + nx].type;
      if (t === 'FIRE' || t === 'SPARK') count++;
    }
  }
  return count;
}

function damageUnit(unit: UnitInstance, sim: SimState, tick: number, gs: GameState): void {
  if (unit.simX === undefined || unit.simY === undefined) return;
  const hot = countHotNearby(sim, unit.simX, unit.simY, PARTICLE_DAMAGE_RADIUS);
  if (hot === 0) return;

  const def = CARD_DEFS[unit.defId];
  // WATER element resists fire.
  const prob = def?.element === 'WATER' ? WATER_FIRE_DAMAGE_PROB : UNIT_FIRE_DAMAGE_PROB;
  if (chance(sim.prng, prob)) {
    unit.hp--;
    if (shouldLog(unit.uid, tick)) {
      gs.combatLog.push(`${def?.name ?? unit.defId} burned by fire! (${unit.hp}/${unit.maxHp} HP)`);
    }
  }
}

/** Remove CORE cells that are contacted by fire, probabilistically. */
function erodeCoreCells(gs: GameState): void {
  const { sim } = gs;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const idx = y * sim.width + x;
      if (sim.grid[idx].type !== 'CORE') continue;
      const hot = countHotNearby(sim, x, y, CORE_FIRE_RADIUS);
      if (hot > 0 && chance(sim.prng, CORE_FIRE_REMOVE_PROB)) {
        sim.grid[idx] = { type: 'EMPTY', lifetime: 0 };
      }
    }
  }
}

/** Sync base.hp from the count of remaining CORE cells in the sim grid. */
function syncBaseHp(gs: GameState): void {
  for (const ps of [gs.player, gs.enemy]) {
    ps.base.hp = countCoreCells(gs.sim, ps.base);
  }
}

/**
 * Run particle-overlap damage for a single fixed tick.
 * Only executes every 30 ticks (~1 second) to keep damage rates reasonable.
 */
export function resolveSimDamage(gs: GameState): void {
  if (gs.tick % 30 !== 0) return;

  const { sim, player, enemy } = gs;

  // Damage all units with physical sim positions.
  for (const unit of [
    ...player.generators, ...player.creatures,
    ...enemy.generators,  ...enemy.creatures,
  ]) {
    damageUnit(unit, sim, gs.tick, gs);
  }

  // Erode CORE cells contacted by fire — drives base.hp authority.
  erodeCoreCells(gs);

  // Sync base.hp from remaining CORE cell count.
  syncBaseHp(gs);

  // Log if a base goes critical.
  for (const ps of [player, enemy]) {
    if (ps.base.hp === 0 && shouldLog(`base_${ps.base.owner}`, gs.tick)) {
      const lbl = ps.base.owner === 'player' ? 'Player' : 'Enemy';
      gs.combatLog.push(`${lbl} base core destroyed by fire!`);
    }
  }

  destroyDeadUnits(gs);
  checkWinLoss(gs);
}
