import { addParticle, SIM_W, SIM_H } from './sandSim';
import type { GameState, Owner, UnitInstance } from './types';

function calcSimPos(
  owner: Owner,
  zone: 'generator' | 'creature',
  index: number,
  total: number
): { x: number; y: number } {
  const count = Math.max(1, total);
  const spacing = Math.min(55, (SIM_W - 40) / count);
  const startX = SIM_W / 2 - (spacing * (count - 1)) / 2;
  const x = Math.round(startX + spacing * index);

  const y = owner === 'enemy'
    ? (zone === 'generator' ? 22 : 62)
    : (zone === 'creature' ? 118 : 158);

  return { x: Math.max(8, Math.min(SIM_W - 8, x)), y };
}

export function getUnitSimPos(gs: GameState, uid: string): { x: number; y: number } {
  const zones: Array<{ owner: Owner; zone: 'generator' | 'creature'; arr: UnitInstance[] }> = [
    { owner: 'enemy',  zone: 'generator', arr: gs.enemy.generators },
    { owner: 'enemy',  zone: 'creature',  arr: gs.enemy.creatures  },
    { owner: 'player', zone: 'creature',  arr: gs.player.creatures  },
    { owner: 'player', zone: 'generator', arr: gs.player.generators },
  ];
  for (const { owner, zone, arr } of zones) {
    const idx = arr.findIndex(u => u.uid === uid);
    if (idx !== -1) {
      const unit = arr[idx];
      if (typeof unit.simX === 'number' && typeof unit.simY === 'number') {
        return { x: unit.simX, y: unit.simY };
      }
      return calcSimPos(owner, zone, idx, arr.length);
    }
  }
  return { x: SIM_W / 2, y: SIM_H / 2 };
}

export function spawnWaterBeam(fx: number, fy: number, tx: number, ty: number): void {
  const dx = tx - fx, dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 1.1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(fx + dx * t);
    const y = Math.round(fy + dy * t);
    addParticle(x, y, 'WATER');
    if (Math.random() < 0.4) addParticle(x + (Math.random() < 0.5 ? 1 : -1), y, 'WATER');
  }
}

export function spawnFireSpray(fx: number, fy: number, tx: number, ty: number): void {
  const dx = tx - fx, dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len * 0.75);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(fx + dx * t + (Math.random() - 0.5) * 7);
    const y = Math.round(fy + dy * t + (Math.random() - 0.5) * 7);
    addParticle(x, y, Math.random() < 0.5 ? 'SPARK' : 'FIRE');
  }
  for (let i = 0; i < 18; i++) {
    addParticle(tx + Math.round((Math.random() - 0.5) * 14), ty + Math.round((Math.random() - 0.5) * 14), 'FIRE');
  }
}

export function spawnSandBurst(fx: number, fy: number, tx: number, ty: number): void {
  // Ignore fx/fy — drop sand from above the target
  void fx; void fy;
  for (let i = 0; i < 45; i++) {
    addParticle(
      tx + Math.round((Math.random() - 0.5) * 26),
      ty - 30 - Math.round(Math.random() * 25),
      'SAND'
    );
  }
}

export function triggerEffect(
  gs: GameState,
  effectKey: string,
  attackerUid: string | null,
  targetUid: string
): void {
  const tPos = getUnitSimPos(gs, targetUid);
  const fPos = attackerUid
    ? getUnitSimPos(gs, attackerUid)
    : { x: SIM_W / 2, y: SIM_H / 2 };

  switch (effectKey) {
    case 'water_beam': spawnWaterBeam(fPos.x, fPos.y, tPos.x, tPos.y); break;
    case 'fire_spray': spawnFireSpray(fPos.x, fPos.y, tPos.x, tPos.y); break;
    case 'sand_burst': spawnSandBurst(fPos.x, fPos.y, tPos.x, tPos.y); break;
  }
}
