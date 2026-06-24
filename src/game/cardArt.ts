// Purely visual card art for hand cards.
// Procedural canvas sketches — no external image assets required.
// Animations use performance.now() (VISUAL-ONLY: no game state read or written).
// Real PNG/spritesheet assets can be swapped in via getDrawFn() per card id.

export const ART_W = 96;
export const ART_H = 68;

type DrawFn = (ctx: CanvasRenderingContext2D, t: number) => void;

// ─── Global animation loop ────────────────────────────────────────────────────

interface ArtSlot {
  ctx: CanvasRenderingContext2D;
  fn: DrawFn;
}

const _slots: ArtSlot[] = [];
let _rafId = 0;

function globalTick(): void {
  const t = performance.now() * 0.001; // VISUAL-ONLY — wall-clock seconds
  for (const s of _slots) s.fn(s.ctx, t);
  _rafId = requestAnimationFrame(globalTick);
}

export function stopAllCardArtAnimations(): void {
  if (_rafId !== 0) { cancelAnimationFrame(_rafId); _rafId = 0; }
  _slots.length = 0;
}

function addAnimatedSlot(ctx: CanvasRenderingContext2D, fn: DrawFn): void {
  _slots.push({ ctx, fn });
  if (_rafId === 0) _rafId = requestAnimationFrame(globalTick);
}

// ─── Mount ────────────────────────────────────────────────────────────────────

/** Call after renderUI sets innerHTML. Finds all art zones, creates canvases, starts loops. */
export function mountCardArtCanvases(appEl: HTMLElement): void {
  stopAllCardArtAnimations();
  appEl.querySelectorAll<HTMLElement>('[data-card-art]').forEach(zone => {
    const cardId = zone.dataset.cardArt ?? '';
    const canvas = document.createElement('canvas');
    canvas.width = ART_W;
    canvas.height = ART_H;
    canvas.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;';
    zone.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fn = getDrawFn(cardId);
    if (isAnimatedCard(cardId)) {
      addAnimatedSlot(ctx, fn);
    } else {
      fn(ctx, 0);
    }
  });
}

// ─── Asset manifest / dispatch ────────────────────────────────────────────────
// To swap in real assets: replace the return value in getDrawFn() for a given
// cardId with a loader that draws an Image onto ctx. The rest of the system
// (animation loop, mount logic) stays unchanged.

function isAnimatedCard(cardId: string): boolean {
  // Structures are static; everything else runs the animation loop.
  return cardId !== 'stone_wall' && cardId !== 'channel' && cardId !== 'firebreak';
}

function getDrawFn(cardId: string): DrawFn {
  switch (cardId) {
    case 'emberling':   return drawEmberling;
    case 'water_wisp':  return drawWaterWisp;
    case 'stone_mite':  return drawStoneMite;
    case 'spark_core':  return drawSparkCore;
    case 'spring_core': return drawSpringCore;
    case 'stone_wall':  return drawStoneWall;
    case 'channel':     return drawChannel;
    case 'firebreak':   return drawFirebreak;
    case 'ignite':      return drawIgnite;
    case 'splash':      return drawSplash;
    case 'collapse':    return drawCollapse;
    default:            return drawFallback;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
}

// ─── CREATURE / FIRE — Emberling ──────────────────────────────────────────────

function drawEmberling(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2, cy = h * 0.63;

  ctx.fillStyle = '#0e0806';
  ctx.fillRect(0, 0, w, h);

  const pulse = 0.9 + 0.1 * Math.sin(t * 3.8);
  const r = 11 * pulse;

  // Background ember glow
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.8);
  bg.addColorStop(0, 'rgba(180,50,5,0.4)');
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Flame wisps above body
  for (let i = 0; i < 3; i++) {
    const fx = cx + (i - 1) * 7;
    const fh = 9 + 4 * Math.sin(t * 5.5 + i * 1.4);
    const topY = cy - r - fh;
    const fg = ctx.createLinearGradient(fx, cy - r, fx, topY);
    fg.addColorStop(0, 'rgba(255,110,0,0.9)');
    fg.addColorStop(0.5, 'rgba(255,210,20,0.65)');
    fg.addColorStop(1, 'rgba(255,240,80,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(fx, cy - r - fh / 2, 3.5 * pulse, fh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Main body
  const body = ctx.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, r);
  body.addColorStop(0, '#ffcc44');
  body.addColorStop(0.4, '#ff5500');
  body.addColorStop(1, '#991100');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  const ey = cy - 3;
  ctx.fillStyle = '#ffee88';
  ctx.fillRect(cx - 5, ey, 3, 4);
  ctx.fillRect(cx + 2, ey, 3, 4);
  ctx.fillStyle = '#110000';
  ctx.fillRect(cx - 4, ey + 1, 1, 2);
  ctx.fillRect(cx + 3, ey + 1, 1, 2);
}

// ─── CREATURE / WATER — Water Wisp ───────────────────────────────────────────

function drawWaterWisp(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2, cy = h * 0.54;

  ctx.fillStyle = '#040810';
  ctx.fillRect(0, 0, w, h);

  // Expanding ripple rings
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.7 + i / 3) % 1;
    const rr = 9 + phase * 20;
    const alpha = (1 - phase) * 0.45;
    ctx.strokeStyle = `rgba(60,180,255,${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft blue background glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
  glow.addColorStop(0, 'rgba(10,80,180,0.35)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Orb body
  const body = ctx.createRadialGradient(cx - 2, cy - 3, 0, cx, cy, 11);
  body.addColorStop(0, '#eeffff');
  body.addColorStop(0.35, '#88ddff');
  body.addColorStop(0.75, '#2266cc');
  body.addColorStop(1, '#112244');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();

  // Shimmer
  const shimmer = 0.55 + 0.45 * Math.sin(t * 4.2);
  ctx.fillStyle = `rgba(255,255,255,${shimmer * 0.55})`;
  ctx.beginPath();
  ctx.ellipse(cx - 3, cy - 4, 3.5, 2.5, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

// ─── CREATURE / EARTH — Stone Mite ───────────────────────────────────────────

function drawStoneMite(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2;
  const bounce = Math.sin(t * 1.8) * 0.6;
  const cy = h * 0.58 + bounce;

  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, w, h);

  // Legs
  ctx.strokeStyle = '#504040';
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 12, cy - 3);
    ctx.lineTo(cx + side * 19, cy - 6 + bounce);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + side * 12, cy + 2);
    ctx.lineTo(cx + side * 19, cy + 6 + bounce);
    ctx.stroke();
  }

  // Shell body
  ctx.fillStyle = '#706860';
  fillRoundRect(ctx, cx - 13, cy - 8, 26, 16, 5);

  // Shell highlight
  ctx.fillStyle = '#9a8878';
  fillRoundRect(ctx, cx - 11, cy - 6, 22, 5, 3);

  // Dark crevice
  ctx.fillStyle = '#403830';
  ctx.fillRect(cx - 8, cy + 1, 16, 2);

  // Eyes (pulsing glow)
  const ep = 0.6 + 0.4 * Math.sin(t * 2.2);
  const eyeColors = [`rgba(255,200,40,${ep})`, `rgba(255,200,40,${ep})`];
  for (let i = 0; i < 2; i++) {
    const ex = cx + (i === 0 ? -6 : 6);
    const ey = cy - 2;
    ctx.fillStyle = eyeColors[i];
    ctx.beginPath();
    ctx.arc(ex, ey, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#110a00';
    ctx.beginPath();
    ctx.arc(ex, ey, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── GENERATOR / FIRE — Spark Core ───────────────────────────────────────────

function drawSparkCore(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2, cy = h / 2;
  const rot = t * 0.75;

  ctx.fillStyle = '#0e0806';
  ctx.fillRect(0, 0, w, h);

  // Background glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
  glow.addColorStop(0, 'rgba(240,100,10,0.28)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Orbiting spark dots
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + t * 1.3;
    const sr = 17;
    const sx = cx + sr * Math.cos(angle);
    const sy = cy + sr * Math.sin(angle);
    const alpha = 0.35 + 0.45 * Math.sin(t * 3.5 + i * 1.05);
    ctx.fillStyle = `rgba(255,210,40,${alpha})`;
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  }

  // 6-pointed spinning star
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  const rOut = 13, rIn = 6;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a));
    else ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  ctx.closePath();
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, rOut);
  sg.addColorStop(0, '#ffee44');
  sg.addColorStop(0.5, '#ff6600');
  sg.addColorStop(1, '#cc2000');
  ctx.fillStyle = sg;
  ctx.fill();

  // Inner core dot
  ctx.fillStyle = '#ffffc0';
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── GENERATOR / WATER — Spring Core ─────────────────────────────────────────

function drawSpringCore(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2, cy = h * 0.52;

  ctx.fillStyle = '#030810';
  ctx.fillRect(0, 0, w, h);

  // Ripple rings
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.55 + i * 0.34) % 1;
    const rr = 6 + phase * 19;
    const alpha = Math.pow(1 - phase, 1.3) * 0.5;
    ctx.strokeStyle = `rgba(30,150,220,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Background glow
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 20);
  glow.addColorStop(0, 'rgba(0,80,180,0.3)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Water drop shape
  const dh = 19;
  const dg = ctx.createLinearGradient(cx - 9, cy - 11, cx + 9, cy + 8);
  dg.addColorStop(0, '#aae8ff');
  dg.addColorStop(0.45, '#2299dd');
  dg.addColorStop(1, '#113366');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.moveTo(cx, cy - dh / 2);
  ctx.bezierCurveTo(cx + 10, cy - 5, cx + 11, cy + 4, cx, cy + dh / 2 - 1);
  ctx.bezierCurveTo(cx - 11, cy + 4, cx - 10, cy - 5, cx, cy - dh / 2);
  ctx.fill();

  // Highlight
  const bob = 0.5 + 0.5 * Math.sin(t * 2.8);
  ctx.fillStyle = `rgba(210,245,255,${0.45 * bob + 0.15})`;
  ctx.beginPath();
  ctx.ellipse(cx - 2, cy - 5, 3, 4.5, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

// ─── STRUCTURE / EARTH — Stone Wall ──────────────────────────────────────────

function drawStoneWall(ctx: CanvasRenderingContext2D, _t: number): void {
  const w = ART_W, h = ART_H;
  const wx = 6, wy = 6, ww = w - 12, wh = h - 12;

  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, w, h);

  // Wall base
  ctx.fillStyle = '#6a5e50';
  ctx.fillRect(wx, wy, ww, wh);

  // Bricks
  const bh = 9, bw = 15;
  for (let row = 0; row * bh < wh; row++) {
    const offset = (row % 2) * (bw / 2);
    const ry = wy + row * bh;
    // Mortar line
    ctx.fillStyle = '#38302a';
    ctx.fillRect(wx, ry, ww, 1);
    for (let col = -1; (col * bw + offset) < ww + bw; col++) {
      const bx = wx + col * bw + offset;
      const clampX = Math.max(wx, bx + 1);
      const clampW = Math.min(wx + ww, bx + bw - 1) - clampX;
      const clampY = Math.max(wy, ry + 1);
      const clampH = Math.min(wy + wh, ry + bh - 1) - clampY;
      if (clampW <= 0 || clampH <= 0) continue;
      const shade = (col + row) % 3;
      ctx.fillStyle = shade === 0 ? '#7a6c5c' : shade === 1 ? '#6e6050' : '#635448';
      ctx.fillRect(clampX, clampY, clampW, clampH);
    }
  }

  // Outer frame highlight
  ctx.strokeStyle = '#9a8878';
  ctx.lineWidth = 1;
  ctx.strokeRect(wx + 0.5, wy + 0.5, ww - 1, wh - 1);
}

// ─── STRUCTURE / EARTH — Channel ─────────────────────────────────────────────

function drawChannel(ctx: CanvasRenderingContext2D, _t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2;
  const railW = 12, gap = 14;
  const left = cx - gap / 2 - railW;
  const right = cx + gap / 2;
  const railY = 6, railH = h - 12;

  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, w, h);

  // Rails
  for (const rx of [left, right]) {
    ctx.fillStyle = '#6a5e50';
    ctx.fillRect(rx, railY, railW, railH);
    ctx.fillStyle = '#9a8878';
    ctx.fillRect(rx + 1, railY + 1, railW - 3, 4);
    ctx.fillStyle = '#38302a';
    ctx.fillRect(rx, railY, 1, railH);
    ctx.fillRect(rx + railW - 1, railY, 1, railH);
  }

  // Channel floor (darker)
  ctx.fillStyle = '#141210';
  ctx.fillRect(cx - gap / 2, railY, gap, railH);

  // Center guide line
  ctx.strokeStyle = 'rgba(80,70,50,0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, railY + 5);
  ctx.lineTo(cx, railY + railH - 5);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── STRUCTURE / EARTH — Firebreak ───────────────────────────────────────────

function drawFirebreak(ctx: CanvasRenderingContext2D, _t: number): void {
  const w = ART_W, h = ART_H;
  ctx.fillStyle = '#0a0908';
  ctx.fillRect(0, 0, w, h);

  const numPillars = 7;
  const usableW = w - 16;
  const spacing = usableW / (numPillars - 1);
  const pillarW = 6;
  const baseH = h - 12;

  for (let i = 0; i < numPillars; i++) {
    const px = 8 + i * spacing;
    const ph = baseH - (i % 2) * 4;
    const py = 6 + (i % 2) * 2;
    ctx.fillStyle = i % 2 === 0 ? '#706858' : '#5c4e40';
    ctx.fillRect(px - pillarW / 2, py, pillarW, ph);
    // Top highlight
    ctx.fillStyle = '#948070';
    ctx.fillRect(px - pillarW / 2 + 1, py + 1, pillarW - 2, 3);
  }

  // Subtle fire-gap hint
  ctx.strokeStyle = 'rgba(180,80,20,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 4]);
  ctx.beginPath();
  ctx.moveTo(8, h / 2);
  ctx.lineTo(w - 8, h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── SPELL / FIRE — Ignite ────────────────────────────────────────────────────

function drawIgnite(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2, cy = h / 2;

  ctx.fillStyle = '#0e0806';
  ctx.fillRect(0, 0, w, h);

  // Core flash
  const pulse = 0.8 + 0.2 * Math.sin(t * 5.5);
  const coreG = ctx.createRadialGradient(cx, cy, 0, cx, cy, 15 * pulse);
  coreG.addColorStop(0, 'rgba(255,245,200,0.95)');
  coreG.addColorStop(0.15, 'rgba(255,190,30,0.8)');
  coreG.addColorStop(0.55, 'rgba(255,60,0,0.4)');
  coreG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = coreG;
  ctx.fillRect(0, 0, w, h);

  // Radiating sparks
  const numSparks = 9;
  for (let i = 0; i < numSparks; i++) {
    const baseAngle = (i / numSparks) * Math.PI * 2;
    const speed = 0.6 + (i % 3) * 0.18;
    const phase = (t * speed + i * 0.11) % 1;
    const dist = 4 + phase * 18;
    const angle = baseAngle + t * 0.4 + i * 0.07;
    const sx = cx + dist * Math.cos(angle);
    const sy = cy + dist * Math.sin(angle);
    const alpha = Math.pow(1 - phase, 0.8);
    ctx.fillStyle = `rgba(255,${Math.floor(160 * alpha + 60)},0,${alpha * 0.9})`;
    const sz = 1.5 + (1 - phase);
    ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
  }
}

// ─── SPELL / WATER — Splash ───────────────────────────────────────────────────

function drawSplash(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  const cx = w / 2, cy = h * 0.58;

  ctx.fillStyle = '#030810';
  ctx.fillRect(0, 0, w, h);

  // Expanding rings
  for (let i = 0; i < 4; i++) {
    const phase = (t * 0.65 + i * 0.25) % 1;
    const rr = 4 + phase * 22;
    const alpha = Math.pow(1 - phase, 1.4) * 0.7;
    ctx.strokeStyle = `rgba(30,160,255,${alpha})`;
    ctx.lineWidth = Math.max(0.5, 2 - phase * 1.5);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Droplets flying outward
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + t * 0.3;
    const phase = (t * 0.8 + i * 0.2) % 1;
    const dr = 5 + phase * 14;
    const dx = cx + dr * Math.cos(angle);
    const dy = cy + dr * Math.sin(angle) * 0.55;
    const alpha = Math.pow(1 - phase, 1.2) * 0.8;
    ctx.fillStyle = `rgba(80,200,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Central water bead
  const bob = cy + 1.5 * Math.sin(t * 3.5);
  ctx.fillStyle = '#88ddff';
  ctx.beginPath();
  ctx.arc(cx, bob, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,248,255,0.65)';
  ctx.beginPath();
  ctx.arc(cx - 1, bob - 1.5, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

// ─── SPELL / EARTH — Collapse ────────────────────────────────────────────────

function drawCollapse(ctx: CanvasRenderingContext2D, t: number): void {
  const w = ART_W, h = ART_H;
  ctx.fillStyle = '#08090a';
  ctx.fillRect(0, 0, w, h);

  // Falling sand particles (VISUAL-ONLY)
  const sandColors = ['#c8a060', '#b89050', '#a07840', '#d0b068'];
  const numP = 14;
  for (let i = 0; i < numP; i++) {
    const seedA = i * 137.5 + 23;
    const seedB = i * 79.3 + 41;
    const xPos = 6 + ((seedA * 13) % (w - 12));
    const fallSpeed = 0.28 + (seedB % 7) * 0.09;
    const phase = (t * fallSpeed + seedB * 0.017) % 1;
    const yPos = phase * (h + 4) - 2;
    const alpha = phase < 0.15 ? phase / 0.15 : phase > 0.85 ? (1 - phase) / 0.15 : 1;
    const sz = 1.5 + (seedA % 3) * 0.5;

    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = sandColors[i % sandColors.length];
    ctx.fillRect(xPos - sz / 2, yPos - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;

  // Ground accumulation
  ctx.fillStyle = '#8c6e38';
  ctx.fillRect(4, h - 6, w - 8, 4);
  ctx.fillStyle = '#a88040';
  ctx.fillRect(8, h - 8, w - 16, 2);
  // highlight on top of pile
  ctx.fillStyle = 'rgba(200,170,80,0.3)';
  ctx.fillRect(10, h - 9, w - 20, 1);
}

// ─── Fallback (unrecognized cardId) ──────────────────────────────────────────

function drawFallback(ctx: CanvasRenderingContext2D, _t: number): void {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, ART_W, ART_H);
  ctx.fillStyle = '#555';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', ART_W / 2, ART_H / 2);
}
