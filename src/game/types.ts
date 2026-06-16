export type ParticleType = 'EMPTY' | 'WATER' | 'FIRE' | 'SAND' | 'SMOKE' | 'SPARK';
export type CardType = 'GENERATOR' | 'CREATURE' | 'SPELL';
export type ElementType = 'FIRE' | 'WATER' | 'EARTH' | 'NEUTRAL';
export type Owner = 'player' | 'enemy';
export type GameStatus = 'playing' | 'win' | 'lose';
export type TurnPhase = 'main' | 'targeting-spell' | 'targeting-attack';

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
}

export interface PlayerState {
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  generators: UnitInstance[];
  creatures: UnitInstance[];
  energy: number;
}

export interface GameState {
  player: PlayerState;
  enemy: PlayerState;
  turn: Owner;
  phase: TurnPhase;
  selectedCardUid: string | null;
  selectedAttackerUid: string | null;
  pendingSpellCardUid: string | null;
  combatLog: string[];
  status: GameStatus;
  aiActing: boolean;
}
