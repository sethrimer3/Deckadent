// ---------------------------------------------------------------------------
// Material system — every sim particle carries a MaterialType that drives
// physical behaviour (hardness, flammability, conductivity, density).
//
// Rendering color is stored separately on SimParticle.color and is independent
// of material type. Materials are physics/gameplay only.
// ---------------------------------------------------------------------------

export enum MaterialType {
  VOID    = 0,  // background / empty — never treated as solid material
  STONE   = 1,  // castle walls, fortress shells, stone creatures
  STEEL   = 2,  // reinforced castle sections, metal structures
  WATER   = 3,  // water elementals, water spell particles, liquid cells
  FIRE    = 4,  // fire creatures, fire spray particles, spark cells
  SAND    = 5,  // sand/earth cells, easily displaced
  WOOD    = 6,  // wooden structures, organic matter, vine tangles
  FLESH   = 7,  // creature body cells (non-elemental)
  CRYSTAL = 8,  // crystal/magic structures, energy conduits
  ASH     = 9,  // burned-out remnants after fire destruction
  ICE     = 10, // frozen cells
  MAGIC   = 11, // spell effect cells with no physical analog
}

export interface MaterialProps {
  label: string;
  /** 0.0–1.0: resistance to damage — higher = harder to destroy */
  hardness: number;
  /** 0.0–1.0: likelihood fire destroys this material */
  flammability: number;
  /** 0.0–1.0: how well the material spreads fire/energy */
  conductivity: number;
  /** relative mass/weight (affects displacement/physics) */
  density: number;
  /** canonical hex color for this material — used as visual fallback only */
  color: string;
  /** false = indestructible (e.g. VOID background) */
  destructible: boolean;
  /** true = when destroyed by fire, leave an ASH cell instead of becoming EMPTY */
  leavesAsh: boolean;
}

export const MaterialTable: Record<MaterialType, MaterialProps> = {
  [MaterialType.VOID]: {
    label: 'Void', hardness: 0.00, flammability: 0.00, conductivity: 0.00,
    density: 0.0, color: '#0f0a1c', destructible: false, leavesAsh: false,
  },
  [MaterialType.STONE]: {
    label: 'Stone', hardness: 0.85, flammability: 0.02, conductivity: 0.05,
    density: 2.5, color: '#888070', destructible: true, leavesAsh: false,
  },
  [MaterialType.STEEL]: {
    label: 'Steel', hardness: 0.95, flammability: 0.01, conductivity: 0.10,
    density: 4.0, color: '#8090a0', destructible: true, leavesAsh: false,
  },
  [MaterialType.WATER]: {
    label: 'Water', hardness: 0.10, flammability: 0.00, conductivity: 0.30,
    density: 1.0, color: '#2860e0', destructible: true, leavesAsh: false,
  },
  [MaterialType.FIRE]: {
    label: 'Fire', hardness: 0.05, flammability: 1.00, conductivity: 0.90,
    density: 0.2, color: '#e64600', destructible: true, leavesAsh: false,
  },
  [MaterialType.SAND]: {
    label: 'Sand', hardness: 0.20, flammability: 0.15, conductivity: 0.10,
    density: 1.3, color: '#b99e52', destructible: true, leavesAsh: false,
  },
  [MaterialType.WOOD]: {
    label: 'Wood', hardness: 0.35, flammability: 0.80, conductivity: 0.50,
    density: 0.7, color: '#23701e', destructible: true, leavesAsh: true,
  },
  [MaterialType.FLESH]: {
    label: 'Flesh', hardness: 0.30, flammability: 0.40, conductivity: 0.20,
    density: 0.9, color: '#cc7755', destructible: true, leavesAsh: false,
  },
  [MaterialType.CRYSTAL]: {
    label: 'Crystal', hardness: 0.70, flammability: 0.05, conductivity: 0.60,
    density: 1.8, color: '#80e8ff', destructible: true, leavesAsh: false,
  },
  [MaterialType.ASH]: {
    label: 'Ash', hardness: 0.05, flammability: 0.00, conductivity: 0.05,
    density: 0.3, color: '#606060', destructible: true, leavesAsh: false,
  },
  [MaterialType.ICE]: {
    label: 'Ice', hardness: 0.50, flammability: 0.00, conductivity: 0.15,
    density: 0.9, color: '#a0dcff', destructible: true, leavesAsh: false,
  },
  [MaterialType.MAGIC]: {
    label: 'Magic', hardness: 0.15, flammability: 0.10, conductivity: 0.80,
    density: 0.1, color: '#c060ff', destructible: true, leavesAsh: false,
  },
};

// ---------------------------------------------------------------------------
// Fire-erosion probability formula.
//
// A normalized BASE probability is scaled by (1 - hardness) * (1 + flammability)
// so that harder/less-flammable materials survive fire much longer.
//
// STONE_EROSION_FACTOR = (1 - 0.85) * (1 + 0.02) = 0.153
//   — used to normalize base probabilities so that STONE cells produce the
//     same removal rate as the hand-tuned constants from before the material system.
// ---------------------------------------------------------------------------
export const STONE_EROSION_FACTOR = (1 - MaterialTable[MaterialType.STONE].hardness)
  * (1 + MaterialTable[MaterialType.STONE].flammability);

/**
 * Compute the effective fire-removal probability for a cell given its material
 * and the normalized base probability (tuned for STONE).
 */
export function fireErosionProb(material: MaterialType, stoneNormalizedBase: number): number {
  const mat = MaterialTable[material];
  if (!mat.destructible) return 0;
  return stoneNormalizedBase / STONE_EROSION_FACTOR * (1 - mat.hardness) * (1 + mat.flammability);
}

/**
 * Compute the effective physical-removal probability for a cell given its material
 * and the normalized base probability (tuned for STONE).
 * Used for collapse/sand/physical damage to cells.
 */
export function physicalErosionProb(material: MaterialType, stoneNormalizedBase: number): number {
  const mat = MaterialTable[material];
  if (!mat.destructible) return 0;
  return stoneNormalizedBase / STONE_EROSION_FACTOR * (1 - mat.hardness);
}
