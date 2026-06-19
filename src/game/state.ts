import type { GameState, PlayerState, CardInstance, UnitInstance, Owner, BaseInstance, SimState } from './types';
import { createPRNG, nextFloat } from './prng';
import type { PRNGState } from './prng';
import { CARD_DEFS, PLAYER_STARTING_DECK, ENEMY_STARTING_DECK } from './cards';
import { createSimState } from './sandSim';

let _uid = 0;
export function newUid(): string { return `u${++_uid}`; }

/** Fisher-Yates shuffle using the seeded gameplay PRNG. No Math.random. */
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
    hp:  def.hp  ?? 3,
    maxHp: def.hp ?? 3,
    attack: def.attack ?? 0,
    hasAttacked: false,
    owner,
    simX,
    simY,
  };
}

function makeBase(owner: Owner): BaseInstance {
  // Player base sits near bottom-center; enemy base near top-center.
  // These are the physical locations of the CORE cells in the sim grid.
  // TODO (see DESIGN_GUIDELINES.md §Win Condition): replace generator-based
  // win/loss with core destruction once bases are fully authoritative.
  return {
    owner,
    hp: 20,
    maxHp: 20,
    simX: 160,
    simY: owner === 'player' ? 164 : 16,
  };
}

/**
 * Place a diamond cluster of CORE cells at a base's sim position.
 * Written directly into the grid — does NOT use addParticle so the sim PRNG
 * is not consumed and the initial PRNG state is clean for replay.
 */
function placeCoreAtBase(sim: SimState, base: BaseInstance): void {
  const positions: [number, number][] = [
    [0, 0],
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
  ];
  for (const [dx, dy] of positions) {
    const x = base.simX + dx;
    const y = base.simY + dy;
    if (x >= 0 && x < sim.width && y >= 0 && y < sim.height) {
      sim.grid[y * sim.width + x] = { type: 'CORE', lifetime: 0 };
    }
  }
}

function makePlayerState(deckIds: string[], owner: Owner, prng: PRNGState): PlayerState {
  const deck = shuffle(deckIds.map(makeCard), prng);
  const hand = deck.splice(0, 5);
  return {
    deck,
    hand,
    discard: [],
    generators: owner === 'player'
      ? [makeUnit('spark_core', owner, 62, 148), makeUnit('spring_core', owner, 98, 148)]
      : [makeUnit('spark_core', owner, 222, 32), makeUnit('spring_core', owner, 258, 32)],
    creatures: [],
    energy: 0,
    base: makeBase(owner),
  };
}

/**
 * Create the initial authoritative game state from an optional seed.
 * If seed is omitted, Date.now() is used but stored as initialSeed so the
 * run is always reproducible given that seed value.
 */
export function createInitialGameState(seed?: number): GameState {
  const initialSeed = (seed ?? Date.now()) >>> 0;

  // Gameplay PRNG drives deck shuffles, draw order, and any card-game decisions.
  const prng = createPRNG(initialSeed);

  // Sim PRNG drives particle physics. Uses a different seed stream (offset by 1)
  // so the two PRNGs are independent and do not share outputs.
  const sim = createSimState(initialSeed + 1);

  const player = makePlayerState(PLAYER_STARTING_DECK, 'player', prng);
  const enemy  = makePlayerState(ENEMY_STARTING_DECK,  'enemy',  prng);

  player.energy = player.generators.length;

  // Place core cells into the sim grid before any game action.
  placeCoreAtBase(sim, player.base);
  placeCoreAtBase(sim, enemy.base);

  return {
    player,
    enemy,
    turn: 'player',
    phase: 'main',
    selectedCardUid: null,
    selectedAttackerUid: null,
    pendingSpellCardUid: null,
    pendingGeneratorCardUid: null,
    combatLog: [
      `Game started — Player goes first! (seed: ${initialSeed.toString(16)})`,
      'Play generators to increase energy. Creatures attack once per turn.',
    ],
    status: 'playing',
    aiActing: false,
    tick: 0,
    initialSeed,
    prng,
    sim,
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
