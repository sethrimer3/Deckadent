import type { GameState, Owner, UnitInstance } from './types';
import { addParticle, SIM_W, SIM_H } from './sandSim';
import { CARD_DEFS } from './cards';

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
  emberling:   2,  // fast — rushes toward enemy base
  water_wisp:  3,  // medium — glides steadily
  stone_mite:  5,  // slow — heavy crawler
};

const MOVE_SPEED_DEFAULT = 4;

/** Minimum simY for player creatures (close to enemy base area). */
const MOVE_Y_MIN = 4;
/** Maximum simY for enemy creatures (close to player base area). */
const MOVE_Y_MAX = SIM_H - 5;

/** Radius used for separation checks (Chebyshev distance). */
const SEPARATION_RADIUS = 8;
const GENERATOR_COLLISION_RADIUS = 12;

function speedFor(defId: string): number {
  return MOVE_SPEED[defId] ?? MOVE_SPEED_DEFAULT;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function collisionProfile(defId: string): { halfWidth: number; leadingExtent: number } {
  switch (defId) {
    case 'emberling': return { halfWidth: 1, leadingExtent: 3 };
    case 'water_wisp': return { halfWidth: 2, leadingExtent: 2 };
    case 'stone_mite': return { halfWidth: 3, leadingExtent: 1 };
    default:           return { halfWidth: 1, leadingExtent: 1 };
  }
}

function findWallContact(
  gs: GameState,
  unit: UnitInstance,
  nextY: number,
  dy: 1 | -1,
): { x: number; y: number } | null {
  if (unit.simX === undefined) return null;
  const { halfWidth, leadingExtent } = collisionProfile(unit.defId);
  const contactY = nextY + dy * leadingExtent;
  if (contactY < 0 || contactY >= gs.sim.height) return null;
  for (let dx = -halfWidth; dx <= halfWidth; dx++) {
    const x = unit.simX + dx;
    if (x < 0 || x >= gs.sim.width) continue;
    if (gs.sim.grid[contactY * gs.sim.width + x].type === 'WALL') return { x, y: contactY };
  }
  return null;
}

function findGeneratorContact(
  gs: GameState,
  unit: UnitInstance,
  owner: Owner,
  nextY: number,
  dy: 1 | -1,
): UnitInstance | null {
  if (unit.simX === undefined || unit.simY === undefined) return null;
  const { halfWidth, leadingExtent } = collisionProfile(unit.defId);
  const opposingGenerators = owner === 'player' ? gs.enemy.generators : gs.player.generators;
  for (const generator of opposingGenerators) {
    if (generator.simX === undefined || generator.simY === undefined) continue;
    const isAhead = (generator.simY - unit.simY) * dy > 0;
    const overlapsX = Math.abs(generator.simX - unit.simX) <= GENERATOR_COLLISION_RADIUS + halfWidth;
    const overlapsY = Math.abs(generator.simY - nextY) <= GENERATOR_COLLISION_RADIUS + leadingExtent;
    if (isAhead && overlapsX && overlapsY) return generator;
  }
  return null;
}

/** Move a single creature one step if the tick modulus matches its speed. */
function damageOpposingWall(gs: GameState, owner: Owner, x: number, y: number, damage: number): void {
  if (x < 0 || x >= gs.sim.width || y < 0 || y >= gs.sim.height) return;
  const idx = y * gs.sim.width + x;
  const cell = gs.sim.grid[idx];
  if (cell.type !== 'WALL' || cell.owner === owner) return;
  cell.lifetime -= damage;
  if (cell.lifetime <= 0) gs.sim.grid[idx] = { type: 'EMPTY', lifetime: 0 };
}

function damageGenerator(generator: UnitInstance | null, amount: number): void {
  if (generator) generator.hp -= amount;
}

function triggerCollisionEffect(
  gs: GameState,
  unit: UnitInstance,
  owner: Owner,
  x: number,
  y: number,
  dy: 1 | -1,
  generator: UnitInstance | null = null,
): void {
  switch (CARD_DEFS[unit.defId].element) {
    case 'FIRE':
      for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
        if (ox * ox + oy * oy > 16) continue;
        const px = x + ox, py = y + oy;
        if (px < 0 || px >= gs.sim.width || py < 0 || py >= gs.sim.height) continue;
        const cell = gs.sim.grid[py * gs.sim.width + px];
        if (cell.type === 'SAND') gs.sim.grid[py * gs.sim.width + px] = { type: 'EMPTY', lifetime: 0 };
        else if (cell.type === 'EMPTY') addParticle(gs.sim, px, py, 'FIRE');
      }
      damageOpposingWall(gs, owner, x, y, 1);
      damageGenerator(generator, 1);
      break;
    case 'WATER':
      for (let distance = 0; distance < 9; distance++) {
        const py = y + dy * distance;
        if (py < 0 || py >= gs.sim.height) break;
        damageOpposingWall(gs, owner, x, py, 1);
        if (gs.sim.grid[py * gs.sim.width + x].type === 'EMPTY') addParticle(gs.sim, x, py, 'WATER', dy);
      }
      damageGenerator(generator, 1);
      break;
    case 'EARTH':
      damageOpposingWall(gs, owner, x, y, 2);
      for (let ox = -2; ox <= 2; ox++) addParticle(gs.sim, x + ox, y - dy, 'SAND', dy);
      damageGenerator(generator, 2);
      break;
    default:
      damageOpposingWall(gs, owner, x, y, 1);
      damageGenerator(generator, 1);
  }
}

function stepCreature(gs: GameState, unit: UnitInstance, owner: Owner, tick: number, dy: 1 | -1): void {
  if (unit.simX === undefined || unit.simY === undefined) return;
  const speed = speedFor(unit.defId);
  if (tick % speed !== 0) return;
  const nextY = clamp(unit.simY + dy, MOVE_Y_MIN, MOVE_Y_MAX);
  const contact = findWallContact(gs, unit, nextY, dy);
  const generator = contact ? null : findGeneratorContact(gs, unit, owner, nextY, dy);
  if (!contact && !generator) {
    unit.simY = nextY;
    return;
  }
  const wall = contact ? gs.sim.grid[contact.y * gs.sim.width + contact.x] : null;

  // Friendly structures block movement but are never damaged by their summons.
  if (wall?.owner === owner) return;

  // Summons without a dedicated collision effect remain blocked until the cell
  // is removed by another effect.
  if (unit.maxCollisionEnergy === undefined) return;

  const targetX = contact?.x ?? generator!.simX!;
  const targetY = contact?.y ?? generator!.simY!;
  triggerCollisionEffect(gs, unit, owner, targetX, targetY, dy, generator);
  unit.collisionEnergy = Math.max(0, (unit.collisionEnergy ?? 1) - 1);
  if (unit.collisionEnergy === 0) unit.hp = 0;
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
  for (const unit of gs.player.creatures) stepCreature(gs, unit, 'player', tick, -1);
  // Enemy creatures march downward (dy = +1).
  for (const unit of gs.enemy.creatures) stepCreature(gs, unit, 'enemy', tick, +1);

  for (const ps of [gs.player, gs.enemy]) {
    const exhausted = ps.creatures.filter(unit => unit.hp <= 0 && unit.collisionEnergy === 0);
    for (const unit of exhausted) gs.combatLog.push(`${CARD_DEFS[unit.defId].name} dissipates after exhausting its collision energy.`);
    ps.creatures = ps.creatures.filter(unit => unit.hp > 0);
    const destroyedGenerators = ps.generators.filter(unit => unit.hp <= 0);
    for (const unit of destroyedGenerators) gs.combatLog.push(`${CARD_DEFS[unit.defId].name} was destroyed by a summon collision.`);
    ps.generators = ps.generators.filter(unit => unit.hp > 0);
  }

  // Separate overlapping units within each team.
  separateTeam(gs.player.creatures);
  separateTeam(gs.enemy.creatures);
}
