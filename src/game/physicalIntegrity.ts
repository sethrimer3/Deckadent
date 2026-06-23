import type { SimState, SplitBehavior } from './types';

export const DEATH_INTEGRITY_THRESHOLD = 0.2;
export const FULL_OPERATIONAL_INTEGRITY = 0.6;

export interface AttachedBody {
  attachedIndices: number[];
  detachedIndices: number[];
}

/**
 * Select an entity's live body using four-way connected components. The anchor
 * wins when present; otherwise the largest component wins, with lowest grid
 * index as a deterministic tie-break. Detached fragments are intentionally
 * excluded from integrity and can be cleared by the owning entity policy.
 */
export function findAttachedBody(
  sim: SimState,
  ownsCell: (index: number) => boolean,
  anchorX: number | undefined,
  anchorY: number | undefined,
): AttachedBody {
  const owned = new Set<number>();
  for (let i = 0; i < sim.grid.length; i++) if (ownsCell(i)) owned.add(i);
  const components: number[][] = [];
  while (owned.size) {
    const first = Math.min(...owned);
    owned.delete(first);
    const component = [first];
    for (let cursor = 0; cursor < component.length; cursor++) {
      const i = component[cursor], x = i % sim.width, y = (i / sim.width) | 0;
      for (const n of [x > 0 ? i - 1 : -1, x + 1 < sim.width ? i + 1 : -1, y > 0 ? i - sim.width : -1, y + 1 < sim.height ? i + sim.width : -1]) {
        if (n >= 0 && owned.delete(n)) component.push(n);
      }
    }
    component.sort((a, b) => a - b);
    components.push(component);
  }
  if (!components.length) return { attachedIndices: [], detachedIndices: [] };
  const anchor = anchorX === undefined || anchorY === undefined ? -1 : anchorY * sim.width + anchorX;
  const anchored = components.find(component => component.includes(anchor));
  const selected = anchored ?? [...components].sort((a, b) => b.length - a.length || a[0] - b[0])[0];
  return { attachedIndices: selected, detachedIndices: components.flat().filter(i => !selected.includes(i)) };
}

export function integrityRatio(attachedParticleCount: number, originalParticleCount: number): number {
  return originalParticleCount > 0 ? attachedParticleCount / originalParticleCount : 0;
}

export function isPhysicallyAlive(attachedParticleCount: number, originalParticleCount: number): boolean {
  return integrityRatio(attachedParticleCount, originalParticleCount) > DEATH_INTEGRITY_THRESHOLD;
}

export function isOperational(attachedParticleCount: number, originalParticleCount: number): boolean {
  return isPhysicallyAlive(attachedParticleCount, originalParticleCount)
    && integrityRatio(attachedParticleCount, originalParticleCount) >= FULL_OPERATIONAL_INTEGRITY;
}

export function shouldClearDetachedParts(splitBehavior: SplitBehavior | undefined): boolean {
  return (splitBehavior ?? 'die') === 'die';
}
