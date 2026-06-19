import type { GameState, UnitInstance, Owner } from './types';
import { CARD_DEFS } from './cards';
import { newUid, startTurn, countCoreCells } from './state';
import { triggerEffect } from './effects';
import { SIM_W, SIM_H } from './sandSim';

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

// Play a card for the active turn player.
// Validates all preconditions before mutating any state — no partial mutations on failure.
export function playCard(
  gs: GameState,
  cardUid: string,
  targetUid?: string,
  placement?: { x: number; y: number }
): boolean {
  const owner: Owner = gs.turn;
  const ps = owner === 'player' ? gs.player : gs.enemy;

  const cardIdx = ps.hand.findIndex(c => c.uid === cardUid);
  if (cardIdx === -1) return false;
  const card = ps.hand[cardIdx];
  const def = CARD_DEFS[card.defId];
  if (ps.energy < def.cost) return false;

  const label = owner === 'player' ? 'Player' : 'Enemy';

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

  if (def.type === 'CREATURE') {
    // Creatures must be placed onto the battlefield at a valid position.
    // Player creatures: lower half (y >= SIM_H/2). Enemy: upper half (y < SIM_H/2).
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

  if (def.type === 'SPELL') {
    // Validate target BEFORE any mutation. Invalid targets return false with no side effects.
    if (!targetUid) return false;
    const target = findUnit(gs, targetUid);
    if (!target) return false;

    ps.energy -= def.cost;
    ps.hand.splice(cardIdx, 1);

    const dmg = def.spellDamage ?? 1;
    triggerEffect(gs, def.effectKey, null, targetUid);
    target.hp -= dmg;
    gs.combatLog.push(`${label} casts ${def.name} on ${CARD_DEFS[target.defId].name} for ${dmg} damage.`);
    ps.discard.push(card);
    destroyDeadUnits(gs);
    checkWinLoss(gs);
    return true;
  }

  return false;
}

export function attackTarget(gs: GameState, attackerUid: string, targetUid: string): boolean {
  const owner: Owner = gs.turn;
  const aps = owner === 'player' ? gs.player : gs.enemy;
  const dps = owner === 'player' ? gs.enemy : gs.player;

  const attacker = aps.creatures.find(u => u.uid === attackerUid);
  if (!attacker || attacker.hasAttacked) return false;

  const target = dps.generators.find(u => u.uid === targetUid) ?? dps.creatures.find(u => u.uid === targetUid);
  if (!target) return false;

  const def = CARD_DEFS[attacker.defId];
  triggerEffect(gs, def.effectKey, attackerUid, targetUid);

  attacker.hasAttacked = true;
  target.hp -= attacker.attack;
  gs.combatLog.push(
    `${def.name} attacks ${CARD_DEFS[target.defId].name} for ${attacker.attack} damage. (${target.hp}/${target.maxHp} HP left)`
  );

  destroyDeadUnits(gs);
  checkWinLoss(gs);
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
  // Primary win condition: base core integrity reaches zero.
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
