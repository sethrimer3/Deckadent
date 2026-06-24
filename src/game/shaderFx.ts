import type { GameState, ParticleType } from './types';

// Visual-only post-processing. This module must never mutate game or simulation state.
const SHADER_FX_ENABLED = true;
const SHADER_FX_QUALITY: 'low' | 'medium' = 'low';
const MAX_EFFECT_DRAWS = SHADER_FX_QUALITY === 'low' ? 260 : 420;
const SAMPLE_STRIDE = SHADER_FX_QUALITY === 'low' ? 3 : 2;
const VIGNETTE_ALPHA = 0.16;

function pulse(tick: number, speed: number, min: number, max: number): number {
  return min + (Math.sin(tick * speed) * 0.5 + 0.5) * (max - min);
}

function shouldSample(x: number, y: number, tick: number, stride: number): boolean {
  return (x * 17 + y * 31 + tick) % stride === 0;
}

function materialGlowColor(type: ParticleType): string | null {
  if (type === 'FIRE') return 'rgba(214, 90, 31, 0.16)';
  if (type === 'SPARK') return 'rgba(241, 200, 90, 0.20)';
  return null;
}

/** Draws inexpensive, deterministic-looking canvas effects above the material grid only. */
export function renderShaderFx(ctx: CanvasRenderingContext2D, gs: GameState): void {
  if (!SHADER_FX_ENABLED) return;

  const { width, height, grid } = gs.sim;
  const { tick } = gs;
  let draws = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // One sparse pass keeps this independent from the authoritative simulation.
  for (let i = 0; i < grid.length && draws < MAX_EFFECT_DRAWS; i++) {
    const particle = grid[i];
    if (particle.type === 'EMPTY' || !shouldSample(i % width, (i / width) | 0, tick, SAMPLE_STRIDE)) continue;

    const x = i % width;
    const y = (i / width) | 0;
    const glow = materialGlowColor(particle.type);

    if (glow) {
      ctx.fillStyle = glow;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      draws++;
      continue;
    }

    if (particle.type === 'CORE') {
      ctx.fillStyle = `rgba(201, 154, 58, ${pulse(tick + x + y, 0.12, 0.035, 0.09)})`;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      draws++;
    } else if (particle.type === 'WATER' && (x + y + tick) % 5 === 0) {
      ctx.fillStyle = 'rgba(150, 174, 178, 0.12)';
      ctx.fillRect(x, y, 2, 1);
      draws++;
    } else if (particle.type === 'ICE' && (x * 3 + y + tick) % 7 === 0) {
      ctx.fillStyle = 'rgba(235, 250, 255, 0.18)';
      ctx.fillRect(x, y, 1, 1);
      draws++;
    } else if (particle.type === 'SMOKE' && (x + y * 2 + tick) % 11 === 0) {
      ctx.fillStyle = 'rgba(190, 195, 215, 0.045)';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      draws++;
    }
  }

  ctx.restore();

  // The vignette is intentionally normal compositing so it adds depth without bleaching cells.
  ctx.save();
  ctx.fillStyle = `rgba(7, 6, 4, ${VIGNETTE_ALPHA})`;
  for (let i = 0; i < 10; i++) ctx.fillRect(i, i, width - i * 2, 1);
  ctx.restore();
}
