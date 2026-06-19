import type { SimState, UnitInstance, BaseInstance, ParticleType } from './types';

// ---------------------------------------------------------------------------
// Footprint helpers — centralized radius/position contracts for damage, targeting
// and effect resolution. All gameplay systems should use these instead of
// scattering radius constants across files.
// ---------------------------------------------------------------------------

export interface Footprint {
  cx: number;
  cy: number;
  radius: number;
}

const UNIT_RADIUS    = 5;
const BASE_RADIUS    = 5;
const CORE_RADIUS    = 3;  // tighter radius for per-cell CORE erosion checks

export { CORE_RADIUS };

/** Returns the footprint for a unit, or null if it has no sim position. */
export function getUnitFootprint(unit: UnitInstance): Footprint | null {
  if (unit.simX === undefined || unit.simY === undefined) return null;
  return { cx: unit.simX, cy: unit.simY, radius: UNIT_RADIUS };
}

/** Returns the footprint for a base. Always has a sim position. */
export function getBaseFootprint(base: BaseInstance): Footprint {
  return { cx: base.simX, cy: base.simY, radius: BASE_RADIUS };
}

/** Count particles of the given types within a footprint's bounding square. */
export function countParticlesInFootprint(
  sim: SimState,
  fp: Footprint,
  types: readonly ParticleType[],
): number {
  const typeSet = new Set<string>(types);
  let count = 0;
  const r = fp.radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = fp.cx + dx, ny = fp.cy + dy;
      if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) continue;
      if (typeSet.has(sim.grid[ny * sim.width + nx].type)) count++;
    }
  }
  return count;
}
