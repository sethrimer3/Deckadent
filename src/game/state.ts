import type { GameState, PlayerState, CardInstance, UnitInstance, Owner, BaseInstance } from './types';
import { createPRNG, nextFloat } from './prng';
import type { PRNGState } from './prng';
import { CARD_DEFS, PLAYER_STARTING_DECK, ENEMY_STARTING_DECK } from './cards';

let _uid = 0;
export function newUid(): string { return `u${++_uid}`; }

/** Fisher-Yates shuffle using the provided seeded PRNG. No Math.random. */
export function shuffle<T>(arr: T[], prng: PRNGState): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(prng) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCard(defId: string): CardInstance {
  return { uid: newUid(), defId };
}

function makeUnit(defId: string, owner: Owner, simX?: number, simY?: number): UnitInstance {
  const def = CARD_DEFS[defId];
  return {
    uid: newUid(),
    defId,
    hp: def.hp ?? 3,
    maxHp: def.hp ?? 3,
    attack: def.attack ?? 0,
    hasAttacked: false,
    owner,
    simX,
    simY,
  };
}

function makeBase(owner: Owner): BaseInstance {
  // TODO (see DESIGN_GUIDELINES.md §Physical Bases & Cores): bases should be
  // rendered as sim structures and eventually take physical particle damage.
  return {
    owner,
    hp: 20,
    maxHp: 20,
    simX: owner === 'player' ? 160 : 160,
    simY: owner === 'player' ? 170 : 10,
  };
}

function makePlayerState(deckIds: string[], owner: Owner, prng: PRNGState): PlayerState {
  const deck = shuffle(deckIds.map(makeCard), prng);
  const hand = deck.splice(0, 5);
  return {
    deck,
    hand,
    discard: [],
    // Each side starts with 2 generators already in play
    generators: owner === 'player'
      ? [makeUnit('spark_core', owner, 62, 148), makeUnit('spring_core', owner, 98, 148)]
      : [makeUnit('spark_core', owner, 222, 32), makeUnit('spring_core', owner, 258, 32)],
    creatures: [],
    energy: 0,
    base: makeBase(owner),
  };
}

export function createInitialGameState(seed?: number): GameState {
  // Seed from parameter or wall-clock time. Store seed in state so runs are reproducible.
  const resolvedSeed = (seed ?? Date.now()) >>> 0;
  const prng = createPRNG(resolvedSeed);

  const player = makePlayerState(PLAYER_STARTING_DECK, 'player', prng);
  const enemy  = makePlayerState(ENEMY_STARTING_DECK,  'enemy',  prng);

  player.energy = player.generators.length;

  return {
    player,
    enemy,
    turn: 'player',
    phase: 'main',
    selectedCardUid: null,
    selectedAttackerUid: null,
    pendingSpellCardUid: null,
    pendingGeneratorCardUid: null,
    combatLog: ['Game started — Player goes first!', 'Play generators to increase energy. Creatures can attack once per turn.'],
    status: 'playing',
    aiActing: false,
    tick: 0,
    prng,
  };
}

export function drawCard(ps: PlayerState, prng: PRNGState): void {
  if (ps.deck.length === 0) {
    ps.deck = shuffle(ps.discard, prng);
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
  drawCard(ps, gs.prng);
  gs.combatLog.push(`--- ${gs.turn === 'player' ? 'Player' : 'Enemy'} turn — Energy: ${ps.energy} ---`);
}
