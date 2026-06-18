import type { GameState, UnitInstance, Owner } from './types';
import { CARD_DEFS } from './cards';
import { newUid, startTurn } from './state';
import { triggerEffect } from './effects';

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
  if (gs.turn !== 'player' || (gs.phase !== 'main' && gs.phase !== 'placing-generator') || gs.aiActing) return false;
  const card = gs.player.hand.find(c => c.uid === cardUid);
  if (!card) return false;
  return gs.player.energy >= CARD_DEFS[card.defId].cost;
}

// Play a card for the active turn player.
// For spells, targetUid must be provided. For generators, placement can set sim coordinates.
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

  ps.energy -= def.cost;
  ps.hand.splice(cardIdx, 1);

  const label = owner === 'player' ? 'Player' : 'Enemy';

  if (def.type === 'GENERATOR') {
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
    ps.creatures.push({
      uid: newUid(), defId: def.id,
      hp: def.hp ?? 3, maxHp: def.hp ?? 3,
      attack: def.attack ?? 1, hasAttacked: false, owner,
    });
    gs.combatLog.push(`${label} plays ${def.name} (creature).`);
    ps.discard.push(card);
    return true;
  }

  if (def.type === 'SPELL') {
    if (!targetUid) return false;
    const target = findUnit(gs, targetUid);
    if (!target) return false;
    const dmg = def.spellDamage ?? 1;

    // Trigger visual effect BEFORE applying damage (unit still in board for position lookup)
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

// Attack from active player's creature to opponent's unit.
export function attackTarget(gs: GameState, attackerUid: string, targetUid: string): boolean {
  const owner: Owner = gs.turn;
  const aps = owner === 'player' ? gs.player : gs.enemy;
  const dps = owner === 'player' ? gs.enemy : gs.player;

  const attacker = aps.creatures.find(u => u.uid === attackerUid);
  if (!attacker || attacker.hasAttacked) return false;

  const target = dps.generators.find(u => u.uid === targetUid) ?? dps.creatures.find(u => u.uid === targetUid);
  if (!target) return false;

  // Trigger effect before damage so positions are still valid
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
  if (gs.player.generators.length === 0) {
    gs.status = 'lose';
    gs.combatLog.push('All your generators were destroyed. You lose!');
  } else if (gs.enemy.generators.length === 0) {
    gs.status = 'win';
    gs.combatLog.push('All enemy generators were destroyed. You win!');
  }
}

export function endTurn(gs: GameState): void {
  gs.selectedCardUid = null;
  gs.selectedAttackerUid = null;
  gs.pendingSpellCardUid = null;
  gs.pendingGeneratorCardUid = null;
  gs.phase = 'main';
  gs.turn = gs.turn === 'player' ? 'enemy' : 'player';
  startTurn(gs);
}
