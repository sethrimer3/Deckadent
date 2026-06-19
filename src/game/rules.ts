import type { GameState, UnitInstance, Owner } from './types';
import { CARD_DEFS } from './cards';
import { newUid, startTurn, countCoreCells } from './state';
import { SIM_W, SIM_H } from './sandSim';
import { enqueueEffect, elementToEffectKind } from './combatEffects';
import { getUnitFootprint } from './footprint';

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
  const allowedPhase = gs.phase === 'main' || gs.phase === 'placing-generator' || gs.phase === 'placing-creature';
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
    ps.energy -= def.cost;
    ps.hand.splice(cardIdx, 1);
    ps.generators.push({
      uid: newUid(), defId: def.id,
      hp: def.hp ?? 3, maxHp: def.hp ?? 3,
      attack: 0, hasAttacked: false, owner,
      simX: placement?.x,
      simY: placement?.y,
    });
    gs.combatLog.push(`${label} places ${def.name} (generator).`);
    ps.discard.push(card);
    return true;
  }

  // ── CREATURE ───────────────────────────────────────────────────────────────
  if (def.type === 'CREATURE') {
    if (!placement) return false;
    const halfY = SIM_H / 2;
    if (owner === 'player' && placement.y < halfY) return false;
    if (owner === 'enemy'  && placement.y >= halfY) return false;
    if (placement.x < 0 || placement.x >= SIM_W || placement.y < 0 || placement.y >= SIM_H) return false;

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
  const srcFp = getUnitFootprint(attacker);
  if (!srcFp) return false;
  const sourcePos = { x: srcFp.cx, y: srcFp.cy };

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
  gs.phase = 'main';
  gs.turn = gs.turn === 'player' ? 'enemy' : 'player';
  startTurn(gs);
}
