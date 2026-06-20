import { chance } from './prng';
import type { GameState, UnitInstance, ElementType } from './types';
import { CARD_DEFS } from './cards';
import { destroyDeadUnits, checkWinLoss } from './rules';
import { countCoreCells } from './state';
import { getUnitFootprint, getBaseFootprint, countParticlesInFootprint, CORE_RADIUS } from './footprint';

// ---------------------------------------------------------------------------
// Particle-overlap damage resolver — primary damage authority for Phase 4.
//
// Runs every 30 ticks (~1 second). Uses gs.sim.prng exclusively.
//
// Damage paths:
//   FIRE/SPARK → most creatures and generators (WATER resists)
//   SAND       → earth units take reduced sand chip damage; others negligible
//   CORE cells → eroded by FIRE/SPARK → drives base.hp
//
// Direct HP subtraction from rules.ts has been removed; all damage now flows
// through this resolver after particles contact unit footprints.
// ---------------------------------------------------------------------------

const FIRE_DAMAGE_PROB        = 0.55;  // was 0.40 — more aggressive fire damage
const WATER_FIRE_RESIST_PROB  = 0.08;  // WATER element resists fire
const EARTH_FIRE_RESIST_PROB  = 0.20;  // EARTH element is stonier, partial resist
const SAND_DAMAGE_PROB        = 0.12;  // sand chips away at non-earth units
const EARTH_SAND_DAMAGE_PROB  = 0.04;  // earth units shrug off most sand
const CORE_FIRE_REMOVE_PROB   = 0.06;  // was 0.04 — cores erode somewhat faster
const WALL_FIRE_REMOVE_PROB   = 0.03;  // was 0.02 — walls erode faster under fire

// Per-uid log cooldown — throttle to one entry every ~3 seconds.
const LOG_COOLDOWN_TICKS = 90;
const _lastLogTick = new Map<string, number>();

function shouldLog(uid: string, tick: number): boolean {
  const last = _lastLogTick.get(uid) ?? -LOG_COOLDOWN_TICKS;
  if (tick - last >= LOG_COOLDOWN_TICKS) { _lastLogTick.set(uid, tick); return true; }
  return false;
}

function fireDamageProb(element: ElementType): number {
  switch (element) {
    case 'WATER': return WATER_FIRE_RESIST_PROB;
    case 'EARTH': return EARTH_FIRE_RESIST_PROB;
    default:      return FIRE_DAMAGE_PROB;
  }
}

function sandDamageProb(element: ElementType): number {
  return element === 'EARTH' ? EARTH_SAND_DAMAGE_PROB : SAND_DAMAGE_PROB;
}

// ─── Unit damage ─────────────────────────────────────────────────────────────

function damageUnit(unit: UnitInstance, gs: GameState): void {
  const fp = getUnitFootprint(unit);
  if (!fp) return;
  const { sim, tick } = gs;
  const def = CARD_DEFS[unit.defId];

  const hotCount  = countParticlesInFootprint(sim, fp, ['FIRE', 'SPARK']);
  const sandCount = countParticlesInFootprint(sim, fp, ['SAND']);

  if (hotCount > 0 && chance(sim.prng, fireDamageProb(def.element))) {
    unit.hp--;
    if (shouldLog(unit.uid, tick)) {
      gs.combatLog.push(`${def.name} burned! (${unit.hp}/${unit.maxHp} HP)`);
    }
  }

  if (sandCount > 2 && chance(sim.prng, sandDamageProb(def.element))) {
    unit.hp--;
    if (shouldLog(unit.uid + '_sand', tick)) {
      gs.combatLog.push(`${def.name} buried under sand! (${unit.hp}/${unit.maxHp} HP)`);
    }
  }
}

// ─── CORE erosion ────────────────────────────────────────────────────────────

function erodeCoreCells(gs: GameState): void {
  const { sim } = gs;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const idx = y * sim.width + x;
      if (sim.grid[idx].type !== 'CORE') continue;
      // Count hot particles in a tight radius around this specific CORE cell.
      const hotNearCell = countParticlesInFootprint(sim, { cx: x, cy: y, radius: CORE_RADIUS }, ['FIRE', 'SPARK']);
      if (hotNearCell > 0 && chance(sim.prng, CORE_FIRE_REMOVE_PROB)) {
        sim.grid[idx] = { type: 'EMPTY', lifetime: 0 };
      }
    }
  }
}

// ─── WALL erosion ────────────────────────────────────────────────────────────

function erodeWallCells(gs: GameState): void {
  const { sim } = gs;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const idx = y * sim.width + x;
      if (sim.grid[idx].type !== 'WALL') continue;
      const hotNear = countParticlesInFootprint(sim, { cx: x, cy: y, radius: CORE_RADIUS }, ['FIRE', 'SPARK']);
      if (hotNear > 0 && chance(sim.prng, WALL_FIRE_REMOVE_PROB)) {
        sim.grid[idx] = { type: 'EMPTY', lifetime: 0 };
      }
    }
  }
}

function syncBaseHp(gs: GameState): void {
  for (const ps of [gs.player, gs.enemy]) {
    ps.base.hp = countCoreCells(gs.sim, ps.base);
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Resolve particle-contact damage for one 30-tick cycle.
 * Only runs on the appropriate tick boundary to keep rates reasonable.
 */
export function resolveSimDamage(gs: GameState): void {
  if (gs.tick % 30 !== 0) return;

  const { player, enemy } = gs;

  for (const unit of [
    ...player.generators, ...player.creatures,
    ...enemy.generators,  ...enemy.creatures,
  ]) {
    damageUnit(unit, gs);
  }

  erodeCoreCells(gs);
  erodeWallCells(gs);
  syncBaseHp(gs);

  for (const ps of [player, enemy]) {
    if (ps.base.hp === 0 && shouldLog(`base_${ps.base.owner}`, gs.tick)) {
      const lbl = ps.base.owner === 'player' ? 'Player' : 'Enemy';
      gs.combatLog.push(`${lbl} base core destroyed by fire!`);
    }
  }

  destroyDeadUnits(gs);
  checkWinLoss(gs);
}
