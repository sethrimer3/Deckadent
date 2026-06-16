import type { GameState, PlayerState, CardInstance, UnitInstance, Owner } from './types';
import { CARD_DEFS, PLAYER_STARTING_DECK, ENEMY_STARTING_DECK } from './cards';

let _uid = 0;
export function newUid(): string { return `u${++_uid}`; }

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCard(defId: string): CardInstance {
  return { uid: newUid(), defId };
}

function makeUnit(defId: string, owner: Owner): UnitInstance {
  const def = CARD_DEFS[defId];
  return {
    uid: newUid(),
    defId,
    hp: def.hp ?? 3,
    maxHp: def.hp ?? 3,
    attack: def.attack ?? 0,
    hasAttacked: false,
    owner,
  };
}

function makePlayerState(deckIds: string[], owner: Owner): PlayerState {
  const deck = shuffle(deckIds.map(makeCard));
  const hand = deck.splice(0, 5);
  return {
    deck,
    hand,
    discard: [],
    // Each side starts with 2 generators already in play
    generators: [makeUnit('spark_core', owner), makeUnit('spring_core', owner)],
    creatures: [],
    energy: 0,
  };
}

export function createInitialGameState(): GameState {
  const player = makePlayerState(PLAYER_STARTING_DECK, 'player');
  const enemy  = makePlayerState(ENEMY_STARTING_DECK,  'enemy');

  // Give player starting energy from their generators
  player.energy = player.generators.length;

  return {
    player,
    enemy,
    turn: 'player',
    phase: 'main',
    selectedCardUid: null,
    selectedAttackerUid: null,
    pendingSpellCardUid: null,
    combatLog: ['Game started — Player goes first!', 'Play generators to increase energy. Creatures can attack once per turn.'],
    status: 'playing',
    aiActing: false,
  };
}

export function drawCard(ps: PlayerState): void {
  if (ps.deck.length === 0) {
    ps.deck = shuffle(ps.discard);
    ps.discard = [];
  }
  if (ps.deck.length > 0) {
    ps.hand.push(ps.deck.shift()!);
  }
}

export function startTurn(gs: GameState): void {
  const ps = gs.turn === 'player' ? gs.player : gs.enemy;
  ps.energy = ps.generators.length;
  for (const c of ps.creatures) c.hasAttacked = false;
  drawCard(ps);
  gs.combatLog.push(`--- ${gs.turn === 'player' ? 'Player' : 'Enemy'} turn — Energy: ${ps.energy} ---`);
}
