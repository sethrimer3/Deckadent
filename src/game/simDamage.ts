import { chance } from './prng';
import type { GameState, UnitInstance, ElementType } from './types';
import { CARD_DEFS } from './cards';
import { destroyDeadUnits, checkWinLoss } from './rules';
import { countCoreCells } from './state';
import { getUnitFootprint, getBaseFootprint, countParticlesInFootprint, CORE_RADIUS } from './footprint';
import { MaterialType, MaterialTable, fireErosionProb } from './materials';
import { syncGeneratorHealth } from './buildingDamage';

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

const FIRE_DAMAGE_PROB        = 0.55;
const WATER_FIRE_RESIST_PROB  = 0.08;  // WATER element resists fire
const EARTH_FIRE_RESIST_PROB  = 0.20;  // EARTH element is stonier, partial resist
const SAND_DAMAGE_PROB        = 0.12;  // sand chips away at non-earth units
const EARTH_SAND_DAMAGE_PROB  = 0.04;  // earth units shrug off most sand
// ICE counters fire — fire units take heavy frost damage, others take moderate damage
const FIRE_ICE_DAMAGE_PROB    = 0.65;  // fire element is especially vulnerable to ice
const OTHER_ICE_DAMAGE_PROB   = 0.15;  // non-fire units still take some frost damage

// ---------------------------------------------------------------------------
// Cell erosion probabilities — normalized to STONE material.
// fireErosionProb() scales these by the cell's actual material so that harder
// materials (STEEL) survive much longer than softer ones (WOOD).
//
// STONE_CORE_FIRE_BASE: base prob such that STONE → 0.06 effective rate
// STONE_WALL_FIRE_BASE: base prob such that STONE → 0.03 effective rate
// (STONE: (1-0.85)*(1+0.02) = 0.153)
// ---------------------------------------------------------------------------
const STONE_CORE_FIRE_BASE = 0.06;  // fireErosionProb normalizes via STONE_EROSION_FACTOR
const STONE_WALL_FIRE_BASE = 0.03;
const CORE_WATER_EROSION_PROB = 0.018;
const CORE_ICE_CRACK_PROB = 0.014;
const CORE_SAND_CHIP_PROB = 0.028;
const CORE_SAND_VOLUME = 4;

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
  const iceCount  = countParticlesInFootprint(sim, fp, ['ICE']);

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

  // ICE is especially effective against fire-element units
  const iceDmgProb = def.element === 'FIRE' ? FIRE_ICE_DAMAGE_PROB : OTHER_ICE_DAMAGE_PROB;
  if (iceCount > 0 && chance(sim.prng, iceDmgProb)) {
    unit.hp--;
    if (shouldLog(unit.uid + '_ice', tick)) {
      const msg = def.element === 'FIRE' ? `${def.name} frozen solid!` : `${def.name} chilled!`;
      gs.combatLog.push(`${msg} (${unit.hp}/${unit.maxHp} HP)`);
    }
  }
}

// ─── CORE erosion ────────────────────────────────────────────────────────────

function erodeCoreCells(gs: GameState): void {
  const { sim } = gs;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const idx = y * sim.width + x;
      const cell = sim.grid[idx];
      if (cell.type !== 'CORE') continue;
      const footprint = { cx: x, cy: y, radius: CORE_RADIUS };
      const hotNearCell = countParticlesInFootprint(sim, footprint, ['FIRE', 'SPARK']);
      const sandNearCell = countParticlesInFootprint(sim, footprint, ['SAND']);
      const waterNearCell = countParticlesInFootprint(sim, footprint, ['WATER']);
      const iceNearCell = countParticlesInFootprint(sim, footprint, ['ICE']);
      // Scale removal probability by the cell's material hardness/flammability.
      // CORE cells are STONE, so fireErosionProb reproduces the original 0.06 rate.
      const removeProb = hotNearCell > 0
        ? fireErosionProb(cell.material, STONE_CORE_FIRE_BASE)
        : sandNearCell >= CORE_SAND_VOLUME
          ? CORE_SAND_CHIP_PROB
          : waterNearCell > 0
            ? CORE_WATER_EROSION_PROB
            : iceNearCell > 0
              ? CORE_ICE_CRACK_PROB
              : 0;
      if (removeProb > 0 && chance(sim.prng, removeProb)) {
        sim.grid[idx] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
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
      const cell = sim.grid[idx];
      if (cell.type !== 'WALL') continue;
      const hotNear = countParticlesInFootprint(sim, { cx: x, cy: y, radius: CORE_RADIUS }, ['FIRE', 'SPARK']);
      // Harder materials (STEEL) resist fire; flammable materials (WOOD) burn fast.
      // For current STONE walls, fireErosionProb reproduces the original 0.03 rate.
      const removeProb = fireErosionProb(cell.material, STONE_WALL_FIRE_BASE);
      if (hotNear > 0 && chance(sim.prng, removeProb)) {
        const mat = MaterialTable[cell.material];
        if (mat.leavesAsh) {
          // Organic materials (WOOD) leave ash rather than vanishing cleanly.
          sim.grid[idx] = { type: 'SAND', lifetime: 0, material: MaterialType.ASH, color: '#606060' };
        } else {
          sim.grid[idx] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
        }
      }
    }
  }
}

// Vine cells near fire convert to fire particles (handled in stepVine/stepFire),
// but here we also do a coarser periodic sweep to catch any that slipped through.
function erodeVineCells(gs: GameState): void {
  const { sim } = gs;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      const idx = y * sim.width + x;
      if (sim.grid[idx].type !== 'VINE') continue;
      const hotNear = countParticlesInFootprint(sim, { cx: x, cy: y, radius: 2 }, ['FIRE', 'SPARK']);
      if (hotNear > 0 && chance(sim.prng, 0.18)) {
        sim.grid[idx] = { type: 'FIRE', lifetime: 50, owner: sim.grid[idx].owner, material: MaterialType.FIRE };
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

  for (const unit of [...player.creatures, ...enemy.creatures]) {
    damageUnit(unit, gs);
  }

  erodeCoreCells(gs);
  erodeWallCells(gs);
  erodeVineCells(gs);
  syncGeneratorHealth(gs);
  syncBaseHp(gs);

  for (const ps of [player, enemy]) {
    if (ps.base.hp === 0 && shouldLog(`base_${ps.base.owner}`, gs.tick)) {
      const lbl = ps.base.owner === 'player' ? 'Player' : 'Enemy';
      gs.combatLog.push(`${lbl} base core destroyed by particle erosion!`);
    }
  }

  destroyDeadUnits(gs);
  checkWinLoss(gs);
}
