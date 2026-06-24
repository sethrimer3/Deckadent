import type { GameState } from './types';
import { PALETTE } from './visualTheme';

function hash(x: number, y: number, seed: number): number { let n = (x * 374761393 + y * 668265263 + seed) | 0; n = (n ^ (n >>> 13)) * 1274126177; return (n ^ (n >>> 16)) >>> 0; }
/** Deterministic packed-earth canvas layer, drawn before the material grid. */
export function renderBattlefieldBackground(ctx: CanvasRenderingContext2D, gs: GameState): void {
  const { width: w, height: h } = ctx.canvas; const seed = gs.initialSeed;
  ctx.fillStyle = PALETTE.voidBlack; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(138,90,50,.11)'; ctx.fillRect(0, Math.floor(h * .6), w, Math.ceil(h * .4));
  ctx.fillStyle = 'rgba(142,36,24,.07)'; ctx.fillRect(0, 0, w, Math.floor(h * .4));
  for (let y = 3; y < h; y += 5) for (let x = 2; x < w; x += 5) {
    const n = hash(x, y, seed); if ((n & 15) > 3) continue;
    ctx.fillStyle = (n & 16) ? '#1a1510' : '#241b13'; ctx.fillRect(x, y, 1, 1);
    if ((n & 127) === 0) { ctx.fillStyle = '#3a3026'; ctx.fillRect(x + 1, y, 2, 1); ctx.fillRect(x + 2, y + 1, 1, 1); }
  }
  ctx.fillStyle = 'rgba(201,154,58,.25)';
  for (let x = 2; x < w; x += 8) ctx.fillRect(x, Math.floor(h * .6), 3, 1);
}
