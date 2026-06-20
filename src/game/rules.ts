import type { GameState, UnitInstance, Owner } from './types';
import { CARD_DEFS } from './cards';
import { newUid, startTurn, countCoreCells } from './state';
import { SIM_W, SIM_H } from './sandSim';
import { enqueueEffect, elementToEffectKind } from './combatEffects';
import { getUnitFootprint, overlapsExistingUnit } from './footprint';
import { applyStructureShape, structureRadius, canPlaceStructure } from './structureShapes';

export function getActive(gs: GameState) {
  return gs.turn === 'player' ? gs.player : gs.enemy;
}
export function getOpponent(gs: GameState) {
  return gs.turn === 'player' ? gs.enemy : gs.player;
}

export function findUnit(gs: GameState, uid: string): UnitInstance | null {
  for (const ps of [gs.player, gs.enemy]) {
    const u = ps.generators.find(u => u.uid === uid) ?? ps.creatures.find(u => u.uid === uid);
    if (u) return u;
  }
  return null;
}

export function canPlayCard(gs: GameState, cardUid: string): boolean {
  if (gs.turn !== 'player' || gs.aiActing) return false;
  const allowedPhase = gs.phase === 'main'
    || gs.phase === 'placing-generator'
    || gs.phase === 'placing-creature'
    || gs.phase === 'placing-structure';
  if (!allowedPhase) return false;
  const card = gs.player.hand.find(c => c.uid === cardUid);
  if (!card) return false;
  return gs.player.energy >= CARD_DEFS[card.defId].cost;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the sim center of a unit or fall back to a default column position. */
function unitPos(unit: UnitInstance, fallbackX: number, fallbackY: number): { x: number; y: number } {
  const fp = getUnitFootprint(unit);
  return fp ? { x: fp.cx, y: fp.cy } : { x: fallbackX, y: fallbackY };
}

/** Chebyshev distance between two points (integer, no float chaos). */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Maximum Chebyshev distance for a valid attack. */
export const MAX_ATTACK_RANGE = 160;

// ---------------------------------------------------------------------------
// Attack-range helpers — exported so the AI can pre-filter illegal targets
// without duplicating the distance logic.
// ---------------------------------------------------------------------------

/** Returns the sim source position for an attacking creature, or null if it has no sim pos. */
export function getAttackSourcePos(attacker: UnitInstance): { x: number; y: number } | null {
  const fp = getUnitFootprint(attacker);
  return fp ? { x: fp.cx, y: fp.cy } : null;
}

/** Returns the sim position of a target unit or base inside gs, or null if not found. */
export function getTargetPos(
  gs: GameState,
  targetUid?: string,
  targetBase?: Owner,
): { x: number; y: number } | null {
  if (targetUid) {
    const u = findUnit(gs, targetUid);
    return u ? unitPos(u, SIM_W / 2, SIM_H / 2) : null;
  }
  if (targetBase) {
    const base = targetBase === 'player' ? gs.player.base : gs.enemy.base;
    return { x: base.simX, y: base.simY };
  }
  return null;
}

/** Returns true if sourcePos is within MAX_ATTACK_RANGE of targetPos (Chebyshev). */
export function isInAttackRange(
  sourcePos: { x: number; y: number },
  targetPos: { x: number; y: number },
): boolean {
  return dist(sourcePos, targetPos) <= MAX_ATTACK_RANGE;
}

/**
 * Returns true if attacker can legally attack the given target unit or base.
 * Checks sim position existence and range — does NOT check hasAttacked.
 */
export function canCreatureAttack(
  gs: GameState,
  attacker: UnitInstance,
  targetUid?: string,
  targetBase?: Owner,
): boolean {
  const srcPos = getAttackSourcePos(attacker);
  if (!srcPos) return false;
  const tgtPos = getTargetPos(gs, targetUid, targetBase);
  if (!tgtPos) return false;
  return isInAttackRange(srcPos, tgtPos);
}

// ---------------------------------------------------------------------------
// playCard — validates all preconditions before any mutation.
// ---------------------------------------------------------------------------
export function playCard(
  gs: GameState,
  cardUid: string,
  targetUid?: string,
  placement?: { x: number; y: number },
  targetBase?: Owner,
): boolean {
  const owner: Owner = gs.turn;
  const ps = owner === 'player' ? gs.player : gs.enemy;
  const opp = owner === 'player' ? gs.enemy : gs.player;

  const cardIdx = ps.hand.findIndex(c => c.uid === cardUid);
  if (cardIdx === -1) return false;
  const card = ps.hand[cardIdx];
  const def = CARD_DEFS[card.defId];
  if (ps.energy < def.cost) return false;

  const label = owner === 'player' ? 'Player' : 'Enemy';

  // ── GENERATOR ──────────────────────────────────────────────────────────────
  if (def.type === 'GENERATOR') {
    // Placement is required for generators played from hand (same as creatures).
    // Starting generators are placed directly via state.ts and bypass playCard.
    if (!placement) return false;
    if (placement.x < 0 || placement.x >= SIM_W || placement.y < 0 || placement.y >= SIM_H) return false;
    const halfY = SIM_H / 2;
    if (owner === 'player' && placement.y < halfY) {
      gs.combatLog.push('Generators must be placed in the lower half of the field.');
      return false;
    }
    if (owner === 'enemy'  && placement.y >= halfY) return false;
    const allUnitsG = [...gs.player.generators, ...gs.player.creatures, ...gs.enemy.generators, ...gs.enemy.creatures];
    if (overlapsExistingUnit(allUnitsG, placement.x, placement.y)) {
      if (owner === 'player') gs.combatLog.push('Cannot place generator — overlaps another unit.');
      return false;
    }

    ps.energy -= def.cost;
    ps.hand.splice(cardIdx, 1);
    ps.generators.push({
      uid: newUid(), defId: def.id,
      hp: def.hp ?? 3, maxHp: def.hp ?? 3,
      attack: 0, hasAttacked: false, owner,
      simX: placement.x,
      simY: placement.y,
    });
    gs.combatLog.push(`${label} places ${def.name} at (${placement.x},${placement.y}).`);
    ps.discard.push(card);
    return true;
  }

  // ── CREATURE ───────────────────────────────────────────────────────────────
  if (def.type === 'CREATURE') {
    if (!placement) return false;
    const halfY = SIM_H / 2;
    if (owner === 'player' && placement.y < halfY) {
      gs.combatLog.push('Creatures must be placed in the lower half of the field.');
      return false;
    }
    if (owner === 'enemy'  && placement.y >= halfY) return false;
    if (placement.x < 0 || placement.x >= SIM_W || placement.y < 0 || placement.y >= SIM_H) return false;
    const allUnitsC = [...gs.player.generators, ...gs.player.creatures, ...gs.enemy.generators, ...gs.enemy.creatures];
    if (overlapsExistingUnit(allUnitsC, placement.x, placement.y)) {
      if (owner === 'player') gs.combatLog.push('Cannot place creature — overlaps another unit.');
      return false;
    }
    if (gs.sim.grid[placement.y * gs.sim.width + placement.x].type === 'WALL') {
      if (owner === 'player') gs.combatLog.push('Cannot place creature inside a structure.');
      return false;
    }

    ps.energy -= def.cost;
    ps.hand.splice(cardIdx, 1);
    ps.creatures.push({
      uid: newUid(), defId: def.id,
      hp: def.hp ?? 3, maxHp: def.hp ?? 3,
      attack: def.attack ?? 1, hasAttacked: false, owner,
      simX: placement.x,
      simY: placement.y,
    });
    gs.combatLog.push(`${label} places ${def.name} at (${placement.x},${placement.y}).`);
    ps.discard.push(card);
    return true;
  }

  // ── SPELL ──────────────────────────────────────────────────────────────────
  if (def.type === 'SPELL') {
    // Must have exactly one of: targetUid or targetBase.
    const hasUnit = !!targetUid;
    const hasBase = !!targetBase;
    if (!hasUnit && !hasBase) return false;
    if (hasUnit && hasBase) return false;

    let targetPos: { x: number; y: number };
    let targetName: string;

    if (hasUnit) {
      const target = findUnit(gs, targetUid!);
      if (!target) return false;
      targetPos = unitPos(target, SIM_W / 2, SIM_H / 2);
      targetName = CARD_DEFS[target.defId].name;
    } else {
      // targetBase must be opponent's base
      if (targetBase !== (owner === 'player' ? 'enemy' : 'player')) return false;
      const base = targetBase === 'player' ? gs.player.base : gs.enemy.base;
      targetPos = { x: base.simX, y: base.simY };
      targetName = `${targetBase} base`;
    }

    // Source position: spell comes from the caster's base or midfield
    const sourcePos = { x: ps.base.simX, y: ps.base.simY };

    ps.energy -= def.cost;
    ps.hand.splice(cardIdx, 1);

    enqueueEffect(gs, owner, def.element, sourcePos, targetPos);
    gs.combatLog.push(
      `${label} casts ${def.name} → ${elementToEffectKind(def.element)} toward ${targetName}.`
    );
    ps.discard.push(card);
    // No direct HP subtraction — damage resolves through sim particles.
    return true;
  }

  // ── STRUCTURE ──────────────────────────────────────────────────────────────
  if (def.type === 'STRUCTURE') {
    if (!placement) return false;
    const { x, y } = placement;
    if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return false;
    const halfY = SIM_H / 2;
    if (owner === 'player' && y < halfY) return false;
    if (owner === 'enemy'  && y >= halfY) return false;

    const shape = def.structureShape ?? 'wall_line';
    const radius = structureRadius(shape);

    const allUnitsS = [...gs.player.generators, ...gs.player.creatures, ...gs.enemy.generators, ...gs.enemy.creatures];
    if (overlapsExistingUnit(allUnitsS, x, y, radius)) {
      if (owner === 'player') gs.combatLog.push(`Cannot place ${def.name} — overlaps a battlefield unit.`);
      return false;
    }

    // Reject if the footprint contains CORE cells or is out of bounds.
    if (!canPlaceStructure(gs.sim, x, y, radius)) {
      if (owner === 'player') gs.combatLog.push(`Cannot place ${def.name} — overlaps a core cell or out of bounds.`);
      return false;
    }

    // All checks passed — write WALL cells and consume card.
    ps.energy -= def.cost;
    ps.hand.splice(cardIdx, 1);
    applyStructureShape(gs.sim, shape, x, y, owner);
    gs.combatLog.push(`${label} places ${def.name} at (${x},${y}).`);
    ps.discard.push(card);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// attackTarget — marks hasAttacked and enqueues a CombatEffect.
// No direct HP subtraction; damage resolves through simDamage.ts.
// ---------------------------------------------------------------------------
export function attackTarget(
  gs: GameState,
  attackerUid: string,
  targetUid?: string,
  targetBase?: Owner,
): boolean {
  const owner: Owner = gs.turn;
  const aps = owner === 'player' ? gs.player : gs.enemy;

  const attacker = aps.creatures.find(u => u.uid === attackerUid);
  if (!attacker || attacker.hasAttacked) return false;

  // Attacker must have a sim position to fire from.
  const sourcePos = getAttackSourcePos(attacker);
  if (!sourcePos) return false;

  let targetPos: { x: number; y: number };
  let targetName: string;

  if (targetUid) {
    const dps = owner === 'player' ? gs.enemy : gs.player;
    const target = dps.generators.find(u => u.uid === targetUid) ?? dps.creatures.find(u => u.uid === targetUid);
    if (!target) return false;
    targetPos = unitPos(target, SIM_W / 2, SIM_H / 2);
    targetName = CARD_DEFS[target.defId].name;
  } else if (targetBase) {
    const oppOwner = owner === 'player' ? 'enemy' : 'player';
    if (targetBase !== oppOwner) return false;
    const base = targetBase === 'player' ? gs.player.base : gs.enemy.base;
    targetPos = { x: base.simX, y: base.simY };
    targetName = `${targetBase} base`;
  } else {
    return false;
  }

  // Range check — uses shared helper so AI and player obey the same legality model.
  if (!isInAttackRange(sourcePos, targetPos)) return false;

  const def = CARD_DEFS[attacker.defId];
  attacker.hasAttacked = true;

  enqueueEffect(gs, owner, def.element, sourcePos, targetPos);
  gs.combatLog.push(
    `${def.name} fires ${elementToEffectKind(def.element)} toward ${targetName}.`
  );

  return true;
}

export function destroyDeadUnits(gs: GameState): void {
  for (const ps of [gs.player, gs.enemy]) {
    for (const u of ps.generators.filter(u => u.hp <= 0))
      gs.combatLog.push(`${CARD_DEFS[u.defId].name} (generator) was destroyed!`);
    for (const u of ps.creatures.filter(u => u.hp <= 0))
      gs.combatLog.push(`${CARD_DEFS[u.defId].name} was destroyed!`);
    ps.generators = ps.generators.filter(u => u.hp > 0);
    ps.creatures  = ps.creatures.filter(u => u.hp > 0);
  }
}

export function checkWinLoss(gs: GameState): void {
  if (gs.status !== 'playing') return;
  const playerCores = countCoreCells(gs.sim, gs.player.base);
  const enemyCores  = countCoreCells(gs.sim, gs.enemy.base);
  if (playerCores === 0) {
    gs.status = 'lose';
    gs.combatLog.push('Your base core was destroyed. You lose!');
    return;
  }
  if (enemyCores === 0) {
    gs.status = 'win';
    gs.combatLog.push('Enemy base core was destroyed. You win!');
  }
}

export function endTurn(gs: GameState): void {
  gs.selectedCardUid = null;
  gs.selectedAttackerUid = null;
  gs.pendingSpellCardUid = null;
  gs.pendingGeneratorCardUid = null;
  gs.pendingCreatureCardUid = null;
  gs.pendingStructureCardUid = null;
  gs.phase = 'main';
  gs.turn = gs.turn === 'player' ? 'enemy' : 'player';
  startTurn(gs);
}
