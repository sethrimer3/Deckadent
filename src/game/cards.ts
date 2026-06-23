import type { CardDef } from './types';

export const CARD_DEFS: Record<string, CardDef> = {
  spark_core: {
    id: 'spark_core',
    name: 'Spark Core',
    type: 'GENERATOR',
    cost: 0,
    element: 'FIRE',
    hp: 3,
    attack: 0,
    rulesText: 'Physical generator. Produces 1 energy/turn. Can be burned and destroyed.',
    effectKey: 'none',
  },
  spring_core: {
    id: 'spring_core',
    name: 'Spring Core',
    type: 'GENERATOR',
    cost: 0,
    element: 'WATER',
    hp: 3,
    attack: 0,
    rulesText: 'Physical generator. Produces 1 energy/turn. Water-based — resists fire.',
    effectKey: 'none',
  },
  emberling: {
    id: 'emberling',
    name: 'Emberling',
    type: 'CREATURE',
    cost: 1,
    element: 'FIRE',
    hp: 3,
    attack: 1,
    collisionEnergy: 3,
    rulesText: 'Advances toward enemy base. On a structure, explodes to burn sand nearby. Dissipates after 3 collisions.',
    effectKey: 'fire_spray',
  },
  water_wisp: {
    id: 'water_wisp',
    name: 'Water Wisp',
    type: 'CREATURE',
    cost: 1,
    element: 'WATER',
    hp: 3,
    attack: 1,
    collisionEnergy: 4,
    rulesText: 'Glides toward enemy base. On a structure, emits a cutting water beam. Dissipates after 4 collisions.',
    effectKey: 'water_beam',
  },
  stone_mite: {
    id: 'stone_mite',
    name: 'Stone Mite',
    type: 'CREATURE',
    cost: 2,
    element: 'EARTH',
    hp: 5,
    attack: 1,
    collisionEnergy: 5,
    rulesText: 'Slow crawler toward enemy base. On a structure, delivers a crushing sand impact. Dissipates after 5 collisions.',
    effectKey: 'sand_burst',
  },
  splash: {
    id: 'splash',
    name: 'Splash',
    type: 'SPELL',
    cost: 1,
    element: 'WATER',
    rulesText: 'Fires a water beam from your base toward target. Water extinguishes fire.',
    effectKey: 'water_beam',
    spellDamage: 1,
  },
  ignite: {
    id: 'ignite',
    name: 'Ignite',
    type: 'SPELL',
    cost: 1,
    element: 'FIRE',
    rulesText: 'Fires a fire spray from your base toward target. Fire erodes core cells.',
    effectKey: 'fire_spray',
    spellDamage: 1,
  },
  collapse: {
    id: 'collapse',
    name: 'Collapse',
    type: 'SPELL',
    cost: 2,
    element: 'EARTH',
    rulesText: 'Drops heavy sand from above onto target. High volume — buries units.',
    effectKey: 'sand_burst',
    spellDamage: 2,
  },
  frost_shard: {
    id: 'frost_shard',
    name: 'Frost Shard',
    type: 'SPELL',
    cost: 2,
    element: 'WATER',
    effectKind: 'freeze',
    rulesText: 'Fires a shard of ice toward target. Ice freezes nearby water, counters fire units hard.',
    effectKey: 'freeze',
    spellDamage: 2,
  },

  // ── Structure cards ───────────────────────────────────────────────────────
  stone_wall: {
    id: 'stone_wall',
    name: 'Stone Wall',
    type: 'STRUCTURE',
    cost: 1,
    element: 'EARTH',
    rulesText: 'Places a solid 12-wide stone barrier. Blocks sand, water, and fire. Erodes under sustained fire.',
    effectKey: 'none',
    structureShape: 'wall_line',
  },
  channel: {
    id: 'channel',
    name: 'Channel',
    type: 'STRUCTURE',
    cost: 2,
    element: 'EARTH',
    rulesText: 'Places two stone rails with a gap. Channels water and sand through the corridor.',
    effectKey: 'none',
    structureShape: 'channel',
  },
  firebreak: {
    id: 'firebreak',
    name: 'Firebreak',
    type: 'STRUCTURE',
    cost: 1,
    element: 'EARTH',
    rulesText: 'Places a sparse alternating stone barrier. Slows fire spread — does not fully stop it.',
    effectKey: 'none',
    structureShape: 'firebreak',
  },
  vine_tangle: {
    id: 'vine_tangle',
    name: 'Vine Tangle',
    type: 'STRUCTURE',
    cost: 1,
    element: 'NEUTRAL',
    rulesText: 'Places a dense organic vine barrier. Blocks enemy advance but ignites rapidly from fire.',
    effectKey: 'none',
    structureShape: 'vine_tangle',
  },
};

export const PLAYER_STARTING_DECK: string[] = [
  'spark_core', 'spark_core',
  'spring_core', 'spring_core',
  'emberling', 'emberling', 'emberling', 'emberling',
  'water_wisp', 'water_wisp', 'water_wisp', 'water_wisp',
  'stone_mite', 'stone_mite', 'stone_mite',
  'splash', 'ignite', 'frost_shard', 'collapse',
  'stone_wall',
];

export const DECK_SIZE = 20;
export const MIN_GENERATORS = 4;
export const MIN_CREATURES = 11;
export const MIN_SPELLS = 4;

export interface DeckValidation {
  valid: boolean;
  generators: number;
  creatures: number;
  spells: number;
  message: string;
}

/** The player deck must have reliable energy, actions, and a creature majority. */
export function validatePlayerDeck(deckIds: readonly string[]): DeckValidation {
  const counts = { generators: 0, creatures: 0, spells: 0 };
  for (const id of deckIds) {
    const type = CARD_DEFS[id]?.type;
    if (type === 'GENERATOR') counts.generators++;
    else if (type === 'CREATURE') counts.creatures++;
    else if (type === 'SPELL') counts.spells++;
  }
  const valid = deckIds.length === DECK_SIZE
    && counts.generators >= MIN_GENERATORS
    && counts.creatures >= MIN_CREATURES
    && counts.spells >= MIN_SPELLS
    && counts.creatures > DECK_SIZE / 2;
  const message = valid
    ? 'Deck is ready.'
    : `Need ${DECK_SIZE} cards: ${Math.max(0, MIN_GENERATORS - counts.generators)} generator, ${Math.max(0, MIN_CREATURES - counts.creatures)} creature, and ${Math.max(0, MIN_SPELLS - counts.spells)} spell minimum remaining.`;
  return { valid, ...counts, message };
}

export const ENEMY_STARTING_DECK: string[] = [
  'spark_core', 'spark_core',
  'spring_core', 'spring_core',
  'emberling', 'emberling',
  'water_wisp', 'water_wisp',
  'stone_mite',
  'splash',
  'ignite', 'ignite',
  'frost_shard',
  'collapse',
  'vine_tangle',
];
