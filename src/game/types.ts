import type { PRNGState } from './prng';

export type { PRNGState };

export type ParticleType = 'EMPTY' | 'WATER' | 'FIRE' | 'SAND' | 'SMOKE' | 'SPARK' | 'CORE';
export type CardType = 'GENERATOR' | 'CREATURE' | 'SPELL';
export type ElementType = 'FIRE' | 'WATER' | 'EARTH' | 'NEUTRAL';
export type Owner = 'player' | 'enemy';
export type GameStatus = 'playing' | 'win' | 'lose';
export type TurnPhase = 'main' | 'targeting-spell' | 'targeting-attack' | 'placing-generator';

// ---------------------------------------------------------------------------
// Simulation state — fully serializable, owns the particle grid and sim PRNG.
// ---------------------------------------------------------------------------

export interface SimParticle {
  type: ParticleType;
  lifetime: number;
  // `moved` is intentionally absent — it is a per-tick scratch value held in
  // a module-level Uint8Array in sandSim.ts and is never serialized.
}

export interface SimState {
  width: number;
  height: number;
  /** Flat row-major particle grid: index = y * width + x. JSON-serializable. */
  grid: SimParticle[];
  /** Deterministic PRNG for all particle physics. Serialized alongside grid. */
  prng: PRNGState;
}

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  element: ElementType;
  hp?: number;
  attack?: number;
  rulesText: string;
  effectKey: string;
  spellDamage?: number;
}

export interface CardInstance {
  uid: string;
  defId: string;
}

// ---------------------------------------------------------------------------
// Units, bases, players
// ---------------------------------------------------------------------------

export interface UnitInstance {
  uid: string;
  defId: string;
  hp: number;
  maxHp: number;
  attack: number;
  hasAttacked: boolean;
  owner: Owner;
  simX?: number;
  simY?: number;
}

export interface BaseInstance {
  owner: Owner;
  hp: number;
  maxHp: number;
  /** Center of this base/core structure in sim coordinates. */
  simX: number;
  simY: number;
}

export interface PlayerState {
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  generators: UnitInstance[];
  creatures: UnitInstance[];
  energy: number;
  /** Physical base/core entity on the battlefield. */
  base: BaseInstance;
}

// ---------------------------------------------------------------------------
// GameState — the complete authoritative serializable game state.
// ---------------------------------------------------------------------------

export interface GameState {
  player: PlayerState;
  enemy: PlayerState;
  turn: Owner;
  phase: TurnPhase;
  selectedCardUid: string | null;
  selectedAttackerUid: string | null;
  pendingSpellCardUid: string | null;
  pendingGeneratorCardUid: string | null;
  combatLog: string[];
  status: GameStatus;
  aiActing: boolean;
  /** Authoritative tick counter. Increments once per fixed sim step. */
  tick: number;
  /** Seed used to create this game — required for replay. */
  initialSeed: number;
  /** Gameplay PRNG: deck shuffles, draw order. Distinct stream from sim PRNG. */
  prng: PRNGState;
  /** Full simulation state. GameState owns this; it is part of authoritative state. */
  sim: SimState;
}
