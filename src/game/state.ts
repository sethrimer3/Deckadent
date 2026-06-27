import type { GameState, PlayerState, CardInstance, UnitInstance, Owner, BaseInstance, SimState, GameMode } from './types';
import { createPRNG, nextFloat } from './prng';
import type { PRNGState } from './prng';
import { CARD_DEFS, PLAYER_STARTING_DECK, ENEMY_STARTING_DECK } from './cards';
import { createSimState } from './sandSim';
import { initializeGeneratorHealth, placeGeneratorParticles } from './generatorShapes';
import { MaterialType } from './materials';
import { findAttachedBody, isOperational } from './physicalIntegrity';
import { createCell } from './cellDamage';

let _uid = 0;
export function newUid(): string { return `u${++_uid}`; }

/**
 * Reset the module-level UID counter to 0.
 * Call before createInitialGameState when running a deterministic replay
 * so that all unit/card UIDs are assigned in the same order as the original run.
 */
export function resetUidCounter(): void { _uid = 0; }

/**
 * Derive the next effect ID from GameState and increment the counter.
 * Effect IDs are now owned by GameState so they are deterministic and
 * replay-stable — a fresh run from the same seed produces identical IDs.
 */
export function newEffectId(gs: { nextEffectId: number }): string {
  return `fx${++gs.nextEffectId}`;
}

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

export function createUnitInstance(defId: string, owner: Owner, simX?: number, simY?: number): UnitInstance {
  const def = CARD_DEFS[defId];
  const collisionEnergy = def.collisionEnergy;
  const unit: UnitInstance = {
    uid: newUid(),
    defId,
    hp:  def.hp  ?? 3,
    maxHp: def.hp ?? 3,
    attack: def.attack ?? 0,
    hasAttacked: false,
    owner,
    simX,
    simY,
    collisionEnergy,
    maxCollisionEnergy: collisionEnergy,
  };
  if (def.type === 'GENERATOR') initializeGeneratorHealth(unit);
  return unit;
}

// Number of CORE cells in the initial diamond cluster — used for base maxHp.
export const CORE_CELL_COUNT = 13;
// Radius used when attributing CORE cells to a base owner.
export const CORE_SEARCH_RADIUS = 5;

function makeBase(owner: Owner): BaseInstance {
  return {
    owner,
    hp: CORE_CELL_COUNT,
    maxHp: CORE_CELL_COUNT,
    originalParticleCount: CORE_CELL_COUNT,
    survivingParticleCount: CORE_CELL_COUNT,
    anchorX: 160,
    anchorY: owner === 'player' ? 304 : 16,
    splitBehavior: 'die',
    simX: 160,
    simY: owner === 'player' ? 304 : 16,
  };
}

/** Count CORE cells in the sim grid belonging to a given base. */
export function countCoreCells(sim: SimState, base: BaseInstance): number {
  const r = CORE_SEARCH_RADIUS;
  return findAttachedBody(sim, index => {
    const x = index % sim.width, y = (index / sim.width) | 0;
    return sim.grid[index].type === 'CORE' && Math.abs(x - base.simX) <= r && Math.abs(y - base.simY) <= r;
  }, base.anchorX, base.anchorY).attachedIndices.length;
}

/** Default base behavior clears disconnected core shards after they cease to be alive. */
export function clearDetachedCoreCells(sim: SimState, base: BaseInstance): void {
  if ((base.splitBehavior ?? 'die') !== 'die') return;
  const r = CORE_SEARCH_RADIUS;
  const body = findAttachedBody(sim, index => {
    const x = index % sim.width, y = (index / sim.width) | 0;
    return sim.grid[index].type === 'CORE' && Math.abs(x - base.simX) <= r && Math.abs(y - base.simY) <= r;
  }, base.anchorX, base.anchorY);
  for (const index of body.detachedIndices) sim.grid[index] = { type: 'EMPTY', lifetime: 0, material: MaterialType.VOID };
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
      sim.grid[y * sim.width + x] = createCell('CORE', MaterialType.STONE);
    }
  }
}

/** 60% means energy-producing; 20%-60% is damaged/inert; <=20% is destroyed. */
export function isGeneratorOperational(unit: UnitInstance): boolean {
  return isOperational(unit.survivingParticleCount ?? unit.hp, unit.originalParticleCount ?? unit.maxHp);
}

/** Solid simulation shell matching the visible fortress boundary. */
function placeBaseShell(sim: SimState, base: BaseInstance): void {
  const hw = 14, hh = 8;
  for (let dy = -hh; dy <= hh; dy++) {
    for (let dx = -hw; dx <= hw; dx++) {
      if (Math.abs(dx) !== hw && Math.abs(dy) !== hh) continue;
      const x = base.simX + dx, y = base.simY + dy;
      if (x < 0 || x >= sim.width || y < 0 || y >= sim.height) continue;
      const idx = y * sim.width + x;
      if (sim.grid[idx].type === 'EMPTY') sim.grid[idx] = createCell('WALL', MaterialType.STONE, { owner: base.owner });
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
      ? [createUnitInstance('spark_core', owner, 62, 288), createUnitInstance('spring_core', owner, 98, 288)]
      : [createUnitInstance('spark_core', owner, 222, 32), createUnitInstance('spring_core', owner, 258, 32)],
    creatures: [],
    energy: 0,
    redrawsThisTurn: 0,
    base: makeBase(owner),
  };
}

/**
 * Create the initial authoritative game state from an optional seed.
 * If seed is omitted, Date.now() is used but stored as initialSeed so the
 * run is always reproducible given that seed value.
 */
export function createInitialGameState(seed?: number, gameMode: GameMode = 'frozen-hotseat', playerDeckIds: string[] = PLAYER_STARTING_DECK): GameState {
  // Reset UID counter so replay runs assign identical UIDs.
  resetUidCounter();
  const initialSeed = (seed ?? Date.now()) >>> 0;

  // Gameplay PRNG drives deck shuffles, draw order, and any card-game decisions.
  const prng = createPRNG(initialSeed);

  // Sim PRNG drives particle physics. Uses a different seed stream (offset by 1)
  // so the two PRNGs are independent and do not share outputs.
  const sim = createSimState(initialSeed + 1);

  const player = makePlayerState(playerDeckIds, 'player', prng);
  const enemy  = makePlayerState(ENEMY_STARTING_DECK,  'enemy',  prng);

  player.energy = player.generators.length;

  // Place core cells into the sim grid before any game action.
  placeCoreAtBase(sim, player.base);
  placeCoreAtBase(sim, enemy.base);
  placeBaseShell(sim, player.base);
  placeBaseShell(sim, enemy.base);
  for (const unit of [...player.generators, ...enemy.generators]) placeGeneratorParticles(sim, unit);

  return {
    player,
    enemy,
    turn: 'player',
    gameMode,
    matchPhase: 'mode-select',
    planningOrder: ['player', 'enemy'],
    planningIndex: 0,
    planningCycle: 1,
    simulationTicksRemaining: 0,
    simFrozen: true,
    phase: 'main',
    selectedCardUid: null,
    selectedAttackerUid: null,
    pendingSpellCardUid: null,
    pendingGeneratorCardUid: null,
    pendingCreatureCardUid: null,
    pendingStructureCardUid: null,
    combatEffects: [],
    nextEffectId: 0,
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
  ps.energy = ps.generators.filter(isGeneratorOperational).length;
  ps.redrawsThisTurn = 0;
  for (const c of ps.creatures) c.hasAttacked = false;
  drawCard(ps, gs.prng);
  gs.combatLog.push(`--- ${gs.turn === 'player' ? 'Player' : 'Enemy'} turn — Energy: ${ps.energy} ---`);
}
