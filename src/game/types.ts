import type { PRNGState } from './prng';
import type { MaterialType } from './materials';

export type { PRNGState };
export type { MaterialType };

export type ParticleType = 'EMPTY' | 'WATER' | 'FIRE' | 'SAND' | 'SMOKE' | 'SPARK' | 'CORE' | 'WALL' | 'ICE' | 'VINE';
export type CardType = 'GENERATOR' | 'CREATURE' | 'SPELL' | 'STRUCTURE';
export type ElementType = 'FIRE' | 'WATER' | 'EARTH' | 'NEUTRAL';
export type Owner = 'player' | 'enemy';
export type GameStatus = 'playing' | 'win' | 'lose';
export type TurnPhase = 'main' | 'targeting-spell' | 'targeting-attack' | 'placing-generator' | 'placing-creature' | 'placing-structure';
export type EffectKind = 'beam' | 'spray' | 'burst' | 'freeze';

// ---------------------------------------------------------------------------
// CombatEffect — serializable, authoritative record of a pending sim event.
// Enqueued by rules.ts; resolved tick-by-tick in combatEffects.ts.
// Positions are captured at enqueue time so effects are deterministic even
// if the source or target moves or dies during resolution.
// ---------------------------------------------------------------------------
export interface CombatEffect {
  id: string;
  owner: Owner;
  element: ElementType;
  effectKind: EffectKind;
  sourcePos: { x: number; y: number };
  targetPos: { x: number; y: number };
  startTick: number;
  durationTicks: number;
}

// ---------------------------------------------------------------------------
// Simulation state — fully serializable, owns the particle grid and sim PRNG.
// ---------------------------------------------------------------------------

export interface SimParticle {
  type: ParticleType;
  lifetime: number;
  /** Physical material type — drives hardness, flammability, and erosion rates.
   * Independent of rendering color; color is stored in the `color` field. */
  material: MaterialType;
  /** Direction that gravity pulls this particle: 1 is down, -1 is up. */
  gravity?: 1 | -1;
  /** Owning side for structures; omitted for non-structure particles. */
  owner?: Owner;
  /** Optional display tint for a structural cell. Rendering-only, but serialized
   * with the cell so physical buildings retain their material identity. */
  color?: string;
  /** Unit that owns this individual structural cell, when it is a generator. */
  structureUid?: string;
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
  collisionEnergy?: number;
  spellDamage?: number;
  /** For STRUCTURE cards: which shape helper to apply at placement. */
  structureShape?: string;
  /** Override the EffectKind derived from element (e.g. frost_shard uses 'freeze'). */
  effectKind?: EffectKind;
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
  collisionEnergy?: number;
  maxCollisionEnergy?: number;
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
  pendingCreatureCardUid: string | null;
  pendingStructureCardUid: string | null;
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
  /** Active combat effects being resolved into the sim each tick. Authoritative. */
  combatEffects: CombatEffect[];
  /**
   * Monotonically increasing counter for assigning CombatEffect IDs.
   * Owned by GameState so effect IDs are deterministic and replay-stable.
   * Included in the state hash.
   */
  nextEffectId: number;
}
