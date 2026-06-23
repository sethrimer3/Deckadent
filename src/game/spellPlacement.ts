import type { Owner } from './types';
import { SIM_H } from './sandSim';

/** All free-point card placements use each owner's outer 40% of the battlefield. */
export const SPELL_ZONE_FRACTION = 0.4;
export const SPELL_ZONE_HEIGHT = Math.ceil(SIM_H * SPELL_ZONE_FRACTION);

export interface SpellPlacementZone { minY: number; maxYExclusive: number; }

export function getSpellPlacementZone(owner: Owner): SpellPlacementZone {
  return owner === 'player'
    ? { minY: SIM_H - SPELL_ZONE_HEIGHT, maxYExclusive: SIM_H }
    : { minY: 0, maxYExclusive: SPELL_ZONE_HEIGHT };
}

export function isSpellPointInCastingZone(owner: Owner, y: number): boolean {
  const zone = getSpellPlacementZone(owner);
  return y >= zone.minY && y < zone.maxYExclusive;
}

/** Alias used by generators, creatures, and structures as well as direct spells. */
export const isPointInPlacementZone = isSpellPointInCastingZone;
