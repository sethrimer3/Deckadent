import { createPRNG, nextFloat, chance } from './prng';
import type { SimState, SimParticle, ParticleType } from './types';

export const SIM_W = 320;
export const SIM_H = 320;

const FIRE_MAX = 50;
const SMOKE_MAX = 70;
const SPARK_MAX = 35;

// ---------------------------------------------------------------------------
// Scratch buffer — per-tick "moved" flags. Not game state; purely algorithmic.
// Allocated once and reused every updateSim call to avoid GC pressure.
// ---------------------------------------------------------------------------
let _movedScratch = new Uint8Array(SIM_W * SIM_H);

function ensureScratch(size: number): Uint8Array {
  if (_movedScratch.length < size) _movedScratch = new Uint8Array(size);
  return _movedScratch;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createSimState(seed: number): SimState {
  const size = SIM_W * SIM_H;
  const grid: SimParticle[] = Array.from({ length: size }, () => ({ type: 'EMPTY', lifetime: 0 }));
  return { width: SIM_W, height: SIM_H, grid, prng: createPRNG(seed) };
}

export function addParticle(
  sim: SimState,
  x: number,
  y: number,
  type: ParticleType,
  gravity: 1 | -1 = 1,
): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= sim.width || yi < 0 || yi >= sim.height) return;
  // CORE and WALL are structural — placed directly, never via addParticle.
  if (type === 'CORE' || type === 'WALL') return;
  const existing = sim.grid[yi * sim.width + xi];
  if (existing.type !== 'EMPTY') {
    // Effect spawns collide too; they never overwrite an occupied cell.
    resolveCollision(sim, { type, lifetime: 0, gravity }, xi, yi);
    return;
  }
  const lt = type === 'FIRE'  ? FIRE_MAX  + nextFloat(sim.prng) * 20
           : type === 'SMOKE' ? SMOKE_MAX + nextFloat(sim.prng) * 20
           : type === 'SPARK' ? SPARK_MAX + nextFloat(sim.prng) * 15
           : 0;
  sim.grid[yi * sim.width + xi] = { type, lifetime: lt, gravity };
}

/** Convenience: random float from the sim PRNG. Used by effects.ts. */
export function simRand(sim: SimState): number {
  return nextFloat(sim.prng);
}

export function updateSim(sim: SimState): void {
  const size = sim.width * sim.height;
  const moved = ensureScratch(size);
  moved.fill(0);

  for (let y = sim.height - 1; y >= 0; y--) {
    const ltr = (y & 1) === 0;
    for (let xi = 0; xi < sim.width; xi++) {
      const x = ltr ? xi : sim.width - 1 - xi;
      const i = y * sim.width + x;
      if (moved[i]) continue;
      const p = sim.grid[i];
      // EMPTY, CORE, and WALL are static — no step needed
      if (p.type === 'EMPTY' || p.type === 'CORE' || p.type === 'WALL') continue;

      switch (p.type) {
        case 'SAND':  stepSand(sim, moved, x, y); break;
        case 'WATER': stepWater(sim, moved, x, y); break;
        case 'FIRE':  stepFire(sim, moved, x, y, p); break;
        case 'SMOKE': stepSmoke(sim, moved, x, y, p); break;
        case 'SPARK': stepSpark(sim, moved, x, y, p); break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function g(sim: SimState, x: number, y: number): SimParticle {
  if (x < 0 || x >= sim.width || y < 0 || y >= sim.height)
    return { type: 'SAND', lifetime: 0 }; // treat out-of-bounds as solid
  return sim.grid[y * sim.width + x];
}

function isEmpty(sim: SimState, x: number, y: number): boolean {
  const t = g(sim, x, y).type;
  return t === 'EMPTY';
}

function moveTo(sim: SimState, moved: Uint8Array, x: number, y: number, nx: number, ny: number): void {
  const si = y * sim.width + x;
  const di = ny * sim.width + nx;
  const src = sim.grid[si];
  const dst = sim.grid[di];
  sim.grid[si] = dst;
  sim.grid[di] = src;
  moved[si] = 1;
  moved[di] = 1;
}

/** Every occupied target is a collision. Specific pairs define the outcome;
 * all other material pairs block instead of passing through each other. */
function resolveCollision(sim: SimState, source: SimParticle, x: number, y: number): void {
  const target = g(sim, x, y);
  const waterHeat = (source.type === 'WATER' && (target.type === 'FIRE' || target.type === 'SPARK'))
    || ((source.type === 'FIRE' || source.type === 'SPARK') && target.type === 'WATER');
  if (waterHeat) {
    sim.grid[y * sim.width + x] = { type: 'SMOKE', lifetime: 25 };
    return;
  }
  if ((source.type === 'FIRE' || source.type === 'SPARK') && target.type === 'WALL') {
    const i = y * sim.width + x;
    const durability = target.lifetime - 1;
    sim.grid[i] = durability <= 0 ? { type: 'EMPTY', lifetime: 0 } : { ...target, lifetime: durability };
  }
}

function tryMove(sim: SimState, moved: Uint8Array, x: number, y: number, nx: number, ny: number): boolean {
  if (nx < 0 || nx >= sim.width || ny < 0 || ny >= sim.height) return false;
  const source = sim.grid[y * sim.width + x];
  const target = sim.grid[ny * sim.width + nx];
  if (target.type === 'EMPTY') { moveTo(sim, moved, x, y, nx, ny); return true; }
  // Sand displaces water as its density interaction; neither is overwritten.
  if (source.type === 'SAND' && target.type === 'WATER') { moveTo(sim, moved, x, y, nx, ny); return true; }
  resolveCollision(sim, source, nx, ny);
  return false;
}

// ---------------------------------------------------------------------------
// Step functions
// ---------------------------------------------------------------------------

function stepSand(sim: SimState, moved: Uint8Array, x: number, y: number): void {
  const gravity = sim.grid[y * sim.width + x].gravity ?? 1;
  const nextY = y + gravity;
  if (nextY < 0 || nextY >= sim.height) return;
  if (tryMove(sim, moved, x, y, x, nextY)) return;
  const d = chance(sim.prng, 0.5) ? 1 : -1;
  if (x + d >= 0 && x + d < sim.width) {
    if (tryMove(sim, moved, x, y, x + d, nextY)) return;
  }
  if (x - d >= 0 && x - d < sim.width) {
    tryMove(sim, moved, x, y, x - d, nextY);
  }
}

function stepWater(sim: SimState, moved: Uint8Array, x: number, y: number): void {
  const gravity = sim.grid[y * sim.width + x].gravity ?? 1;
  const nextY = y + gravity;
  if (nextY >= 0 && nextY < sim.height && tryMove(sim, moved, x, y, x, nextY)) return;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height && g(sim, nx, ny).type === 'FIRE') {
      sim.grid[ny * sim.width + nx] = { type: 'SMOKE', lifetime: 25 };
      sim.grid[y * sim.width + x]   = { type: 'EMPTY', lifetime: 0 };
      return;
    }
  }
  const d = chance(sim.prng, 0.5) ? 1 : -1;
  if (x + d >= 0 && x + d < sim.width && tryMove(sim, moved, x, y, x + d, y)) return;
  if (x - d >= 0 && x - d < sim.width) tryMove(sim, moved, x, y, x - d, y);
}

function stepFire(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  p.lifetime--;
  if (p.lifetime <= 0) {
    sim.grid[y * sim.width + x] = chance(sim.prng, 0.35)
      ? { type: 'SMOKE', lifetime: SMOKE_MAX }
      : { type: 'EMPTY', lifetime: 0 };
    return;
  }
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height && g(sim, nx, ny).type === 'WATER') {
      sim.grid[y  * sim.width + x]  = { type: 'SMOKE', lifetime: 20 };
      sim.grid[ny * sim.width + nx] = { type: 'EMPTY', lifetime: 0 };
      return;
    }
  }
  if (y - 1 >= 0 && chance(sim.prng, 0.25) && tryMove(sim, moved, x, y, x, y - 1)) {
    return;
  }
  if (chance(sim.prng, 0.06)) {
    const dx = chance(sim.prng, 0.5) ? 1 : -1;
    const nx = x + dx;
    if (nx >= 0 && nx < sim.width && isEmpty(sim, nx, y)) {
      sim.grid[y * sim.width + nx] = { type: 'FIRE', lifetime: Math.round(p.lifetime * 0.4) };
    } else if (nx >= 0 && nx < sim.width) {
      resolveCollision(sim, p, nx, y);
    }
  }
}

function stepSmoke(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  p.lifetime--;
  if (p.lifetime <= 0) { sim.grid[y * sim.width + x] = { type: 'EMPTY', lifetime: 0 }; return; }
  if (y - 1 >= 0 && chance(sim.prng, 0.35) && tryMove(sim, moved, x, y, x, y - 1)) {
    return;
  }
  const d = chance(sim.prng, 0.5) ? 1 : -1;
  if (x + d >= 0 && x + d < sim.width && y - 1 >= 0 && chance(sim.prng, 0.15)) {
    tryMove(sim, moved, x, y, x + d, y - 1);
  }
}

function stepSpark(sim: SimState, moved: Uint8Array, x: number, y: number, p: SimParticle): void {
  p.lifetime--;
  if (p.lifetime <= 0) { sim.grid[y * sim.width + x] = { type: 'EMPTY', lifetime: 0 }; return; }
  if (chance(sim.prng, 0.08)) {
    const nx = x + (chance(sim.prng, 0.5) ? 1 : -1);
    const ny = y + (chance(sim.prng, 0.5) ? 1 : -1);
    if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height && isEmpty(sim, nx, ny)) {
      sim.grid[ny * sim.width + nx] = { type: 'FIRE', lifetime: FIRE_MAX };
    } else if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height) {
      resolveCollision(sim, p, nx, ny);
    }
  }
  const dx = chance(sim.prng, 0.5) ? 1 : -1;
  const dy = chance(sim.prng, 0.55) ? -1 : (chance(sim.prng, 0.5) ? 1 : -1);
  const nx = x + dx, ny = y + dy;
  if (nx >= 0 && nx < sim.width && ny >= 0 && ny < sim.height) tryMove(sim, moved, x, y, nx, ny);
}

// ---------------------------------------------------------------------------
// Rendering — reads SimState, must not mutate it. Math.random allowed here
// for purely visual effects (fire flicker jitter) that do not affect game state.
// ---------------------------------------------------------------------------

const COLORS: Record<ParticleType, readonly [number, number, number]> = {
  EMPTY: [15, 10, 28],
  WATER: [40, 110, 230],
  FIRE:  [230, 70, 10],
  SAND:  [185, 158, 82],
  SMOKE: [95, 95, 108],
  SPARK: [255, 220, 40],
  CORE:  [0, 210, 160],  // teal — physically significant base/core cells
  WALL:  [120, 105, 80], // stone grey-brown — player-placed structural barrier
};

export function renderSim(ctx: CanvasRenderingContext2D, sim: SimState): void {
  const img = ctx.createImageData(sim.width, sim.height);
  const d = img.data;
  const { grid } = sim;

  for (let i = 0; i < grid.length; i++) {
    const p = grid[i];
    const pi = i * 4;
    const [r, g, b] = p.color ? hexToRgb(p.color) : COLORS[p.type];
    // VISUAL-ONLY: fire/spark flicker jitter uses Math.random — not gameplay-affecting.
    const jitter = (p.type === 'FIRE' || p.type === 'SPARK') ? (Math.random() * 30 | 0) : 0;
    d[pi]     = Math.min(255, r + jitter);
    d[pi + 1] = Math.min(255, g + (p.type === 'FIRE' ? jitter * 0.5 : 0));
    d[pi + 2] = b;
    d[pi + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
