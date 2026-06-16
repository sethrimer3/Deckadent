export const SIM_W = 320;
export const SIM_H = 180;

export type ParticleType = 'EMPTY' | 'WATER' | 'FIRE' | 'SAND' | 'SMOKE' | 'SPARK';

interface Particle {
  type: ParticleType;
  lifetime: number;
  moved: boolean;
}

const FIRE_MAX = 50;
const SMOKE_MAX = 70;
const SPARK_MAX = 35;

const SIZE = SIM_W * SIM_H;
let grid: Particle[] = [];

function empty(): Particle {
  return { type: 'EMPTY', lifetime: 0, moved: false };
}

export function initSim(): void {
  grid = Array.from({ length: SIZE }, empty);
}

export function addParticle(x: number, y: number, type: ParticleType): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= SIM_W || yi < 0 || yi >= SIM_H) return;
  const lt = type === 'FIRE' ? FIRE_MAX + Math.random() * 20
           : type === 'SMOKE' ? SMOKE_MAX + Math.random() * 20
           : type === 'SPARK' ? SPARK_MAX + Math.random() * 15
           : 0;
  grid[yi * SIM_W + xi] = { type, lifetime: lt, moved: false };
}

function g(x: number, y: number): Particle {
  if (x < 0 || x >= SIM_W || y < 0 || y >= SIM_H) return { type: 'SAND', lifetime: 0, moved: false };
  return grid[y * SIM_W + x];
}

function moveTo(x: number, y: number, nx: number, ny: number): void {
  const src = grid[y * SIM_W + x];
  const dst = grid[ny * SIM_W + nx];
  src.moved = true;
  dst.moved = true;
  grid[y * SIM_W + x] = dst;
  grid[ny * SIM_W + nx] = src;
  // After swap, the original particle is at (nx, ny); mark dest as moved so we don't re-process
  grid[ny * SIM_W + nx].moved = true;
}

function isEmpty(x: number, y: number): boolean {
  return g(x, y).type === 'EMPTY';
}

export function updateSim(): void {
  // Clear moved flags
  for (let i = 0; i < SIZE; i++) grid[i].moved = false;

  // Process bottom to top (falling), per-row alternating direction
  for (let y = SIM_H - 1; y >= 0; y--) {
    const ltr = (y & 1) === 0;
    for (let xi = 0; xi < SIM_W; xi++) {
      const x = ltr ? xi : SIM_W - 1 - xi;
      const p = grid[y * SIM_W + x];
      if (p.moved || p.type === 'EMPTY') continue;

      switch (p.type) {
        case 'SAND': stepSand(x, y); break;
        case 'WATER': stepWater(x, y); break;
        case 'FIRE': stepFire(x, y, p); break;
        case 'SMOKE': stepSmoke(x, y, p); break;
        case 'SPARK': stepSpark(x, y, p); break;
      }
    }
  }
}

function stepSand(x: number, y: number): void {
  if (y + 1 >= SIM_H) return;
  const below = g(x, y + 1).type;
  if (below === 'EMPTY' || below === 'WATER') { moveTo(x, y, x, y + 1); return; }
  const d = Math.random() < 0.5 ? 1 : -1;
  if (x + d >= 0 && x + d < SIM_W && (g(x + d, y + 1).type === 'EMPTY' || g(x + d, y + 1).type === 'WATER')) {
    moveTo(x, y, x + d, y + 1); return;
  }
  if (x - d >= 0 && x - d < SIM_W && (g(x - d, y + 1).type === 'EMPTY' || g(x - d, y + 1).type === 'WATER')) {
    moveTo(x, y, x - d, y + 1);
  }
}

function stepWater(x: number, y: number): void {
  if (y + 1 < SIM_H && isEmpty(x, y + 1)) { moveTo(x, y, x, y + 1); return; }
  // Check for fire to extinguish
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < SIM_W && ny >= 0 && ny < SIM_H && g(nx, ny).type === 'FIRE') {
      grid[ny * SIM_W + nx] = { type: 'SMOKE', lifetime: 25, moved: true };
      grid[y * SIM_W + x] = empty();
      return;
    }
  }
  const d = Math.random() < 0.5 ? 1 : -1;
  if (x + d >= 0 && x + d < SIM_W && isEmpty(x + d, y)) { moveTo(x, y, x + d, y); return; }
  if (x - d >= 0 && x - d < SIM_W && isEmpty(x - d, y)) { moveTo(x, y, x - d, y); }
}

function stepFire(x: number, y: number, p: Particle): void {
  p.lifetime--;
  if (p.lifetime <= 0) {
    grid[y * SIM_W + x] = Math.random() < 0.35
      ? { type: 'SMOKE', lifetime: SMOKE_MAX, moved: true }
      : empty();
    return;
  }
  // Extinguished by adjacent water
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as [number, number][]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < SIM_W && ny >= 0 && ny < SIM_H && g(nx, ny).type === 'WATER') {
      grid[y * SIM_W + x] = { type: 'SMOKE', lifetime: 20, moved: true };
      grid[ny * SIM_W + nx] = empty();
      return;
    }
  }
  // Rise
  if (y - 1 >= 0 && isEmpty(x, y - 1) && Math.random() < 0.25) {
    moveTo(x, y, x, y - 1); return;
  }
  // Spread sideways creating new small fires
  if (Math.random() < 0.06) {
    const dx = Math.random() < 0.5 ? 1 : -1;
    const nx = x + dx;
    if (nx >= 0 && nx < SIM_W && isEmpty(nx, y)) {
      grid[y * SIM_W + nx] = { type: 'FIRE', lifetime: Math.round(p.lifetime * 0.4), moved: true };
    }
  }
}

function stepSmoke(x: number, y: number, p: Particle): void {
  p.lifetime--;
  if (p.lifetime <= 0) { grid[y * SIM_W + x] = empty(); return; }
  if (y - 1 >= 0 && isEmpty(x, y - 1) && Math.random() < 0.35) {
    moveTo(x, y, x, y - 1); return;
  }
  const d = Math.random() < 0.5 ? 1 : -1;
  if (x + d >= 0 && x + d < SIM_W && y - 1 >= 0 && isEmpty(x + d, y - 1) && Math.random() < 0.15) {
    moveTo(x, y, x + d, y - 1);
  }
}

function stepSpark(x: number, y: number, p: Particle): void {
  p.lifetime--;
  if (p.lifetime <= 0) { grid[y * SIM_W + x] = empty(); return; }
  // Occasionally ignite adjacent empty cells
  if (Math.random() < 0.08) {
    const nx = x + Math.round((Math.random() - 0.5) * 2);
    const ny = y + Math.round((Math.random() - 0.5) * 2);
    if (nx >= 0 && nx < SIM_W && ny >= 0 && ny < SIM_H && isEmpty(nx, ny)) {
      grid[ny * SIM_W + nx] = { type: 'FIRE', lifetime: FIRE_MAX, moved: true };
    }
  }
  // Move randomly with upward bias
  const dx = Math.round((Math.random() - 0.5) * 2);
  const dy = Math.random() < 0.55 ? -1 : Math.round((Math.random() - 0.5) * 2);
  const nx = x + dx, ny = y + dy;
  if (nx >= 0 && nx < SIM_W && ny >= 0 && ny < SIM_H && isEmpty(nx, ny)) {
    moveTo(x, y, nx, ny);
  }
}

// Particle colors as [r, g, b]
const COLORS: Record<ParticleType, readonly [number, number, number]> = {
  EMPTY: [15, 10, 28],
  WATER: [40, 110, 230],
  FIRE: [230, 70, 10],
  SAND: [185, 158, 82],
  SMOKE: [95, 95, 108],
  SPARK: [255, 220, 40],
};

export function renderSim(ctx: CanvasRenderingContext2D): void {
  const img = ctx.createImageData(SIM_W, SIM_H);
  const d = img.data;

  for (let i = 0; i < SIZE; i++) {
    const p = grid[i];
    const pi = i * 4;
    if (p.type === 'EMPTY') {
      d[pi] = 15; d[pi + 1] = 10; d[pi + 2] = 28; d[pi + 3] = 255;
    } else {
      const [r, g, b] = COLORS[p.type];
      // Slight flicker for fire/spark
      const jitter = (p.type === 'FIRE' || p.type === 'SPARK') ? (Math.random() * 30 | 0) : 0;
      d[pi]     = Math.min(255, r + jitter);
      d[pi + 1] = Math.min(255, g + (p.type === 'FIRE' ? jitter * 0.5 : 0));
      d[pi + 2] = b;
      d[pi + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}
