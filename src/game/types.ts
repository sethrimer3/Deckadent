import type { PRNGState } from './prng';

export type { PRNGState };

export type ParticleType = 'EMPTY' | 'WATER' | 'FIRE' | 'SAND' | 'SMOKE' | 'SPARK';
export type CardType = 'GENERATOR' | 'CREATURE' | 'SPELL';
export type ElementType = 'FIRE' | 'WATER' | 'EARTH' | 'NEUTRAL';
export type Owner = 'player' | 'enemy';
export type GameStatus = 'playing' | 'win' | 'lose';
export type TurnPhase = 'main' | 'targeting-spell' | 'targeting-attack' | 'placing-generator';

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

// ---------------------------------------------------------------------------
// BaseInstance — physical structure on the battlefield.
// TODO (see DESIGN_GUIDELINES.md §Physical Bases & Cores): bases should take
// physical particle damage, block attacks, and losing the core should end the
// game instead of the current generator-based win condition.
// ---------------------------------------------------------------------------
export interface BaseInstance {
  owner: Owner;
  hp: number;
  maxHp: number;
  /** Simulation grid X coordinate of the base structure center. */
  simX: number;
  /** Simulation grid Y coordinate of the base structure center. */
  simY: number;
}

export interface PlayerState {
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  generators: UnitInstance[];
  creatures: UnitInstance[];
  energy: number;
  /** Physical base entity on the battlefield. Not yet used for win/loss — see TODO above. */
  base: BaseInstance;
}

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
  /** Authoritative simulation tick counter. Increments once per fixed sim step. */
  tick: number;
  /** Seeded PRNG for all gameplay-affecting randomness. Serializable. */
  prng: PRNGState;
}
