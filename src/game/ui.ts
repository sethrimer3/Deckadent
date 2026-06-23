import type { GameState, UnitInstance, CardInstance, GameMode } from './types';
import { CARD_DEFS, DECK_SIZE, MIN_CREATURES, MIN_GENERATORS, MIN_SPELLS, PLAYER_STARTING_DECK, validatePlayerDeck } from './cards';
import { canPlayCard } from './rules';
import { applyCommand } from './commands';
import { hashHex } from './stateHash';
import { runEnemyTurn } from './ai';
import { mountCardArtCanvases } from './cardArt';
import { structureRadius } from './structureShapes';
import { getSpellPlacementZone, isPointInPlacementZone } from './spellPlacement';
import { ownerLabel } from './matchFlow';

const ELEMENT_COLOR: Record<string, string> = {
  FIRE: '#e84a1a',
  WATER: '#1a7ae8',
  EARTH: '#a07830',
  NEUTRAL: '#888',
};

const ELEMENT_BG: Record<string, string> = {
  FIRE: '#3d1208',
  WATER: '#08233d',
  EARTH: '#2a1e08',
  NEUTRAL: '#1a1a1a',
};

let _gs: GameState;
let _renderFn: () => void;
let _canvas: HTMLCanvasElement;
let _startMatch: ((mode: GameMode, address?: string, playerDeckIds?: string[]) => void) | null = null;
let _menuView: 'modes' | 'deck' = 'modes';
const DECK_STORAGE_KEY = 'deckadent-player-deck-v1';
let _playerDeck = loadPlayerDeck();

function loadPlayerDeck(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.every(id => typeof id === 'string' && CARD_DEFS[id])) return saved;
  } catch { /* Use the supplied legal deck. */ }
  return [...PLAYER_STARTING_DECK];
}

function savePlayerDeck(): void {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(_playerDeck));
}

// ─── Drag state ───────────────────────────────────────────────────────────────
// Module-level so drawDragOverlay can read it every animation frame.

let _dragActive  = false;
let _dragStart   = { x: 0, y: 0 };
let _dragCurrent = { x: 0, y: 0 };

// Stored so we can remove them if a second drag somehow starts before the first ends.
let _docMoveHandler: ((e: MouseEvent) => void) | null = null;
let _docUpHandler:   ((e: MouseEvent) => void) | null = null;

function toCanvasCoords(e: MouseEvent): { x: number; y: number } {
  const rect = _canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(_canvas.width  - 1, Math.round(((e.clientX - rect.left) / rect.width)  * _canvas.width))),
    y: Math.max(0, Math.min(_canvas.height - 1, Math.round(((e.clientY - rect.top)  / rect.height) * _canvas.height))),
  };
}

function removeDragListeners(): void {
  if (_docMoveHandler) { document.removeEventListener('mousemove', _docMoveHandler); _docMoveHandler = null; }
  if (_docUpHandler)   { document.removeEventListener('mouseup',   _docUpHandler);   _docUpHandler   = null; }
}

export function initUI(
  gs: GameState,
  canvas: HTMLCanvasElement,
  renderFn: () => void,
  startMatch?: (mode: GameMode, address?: string, playerDeckIds?: string[]) => void,
  _getSession?: () => unknown,
): void {
  _gs = gs;
  _canvas = canvas;
  _renderFn = renderFn;
  _startMatch = startMatch ?? null;
}

// ─── Drag overlay renderer ────────────────────────────────────────────────────
// Called every animation frame from main.ts, on top of the sim canvas.

const _EL_COLOR: Record<string, string> = {
  FIRE: '#e84a1a', WATER: '#1a7ae8', EARTH: '#c09040', NEUTRAL: '#aaa',
};

export function isDragActive(): boolean { return _dragActive; }

export function drawDragOverlay(ctx: CanvasRenderingContext2D, gs: GameState): void {
  const { phase } = gs;
  if (gs.matchPhase === 'planning') {
    ctx.save();
    ctx.fillStyle = 'rgba(92, 122, 145, 0.07)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = 'rgba(190, 215, 230, 0.72)';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('SIM FROZEN', 8, 15);
    ctx.restore();
  }
  const showPlacementZone = (phase === 'targeting-spell' && gs.pendingSpellCardUid)
    || (phase === 'placing-generator' && gs.pendingGeneratorCardUid)
    || (phase === 'placing-creature' && gs.pendingCreatureCardUid)
    || (phase === 'placing-structure' && gs.pendingStructureCardUid);
  if (showPlacementZone) {
    const zone = getSpellPlacementZone('player');
    ctx.save();
    ctx.fillStyle = 'rgba(35, 95, 120, 0.18)';
    ctx.fillRect(0, zone.minY, ctx.canvas.width, zone.maxYExclusive - zone.minY);
    ctx.fillStyle = 'rgba(105, 25, 30, 0.12)';
    ctx.fillRect(0, 0, ctx.canvas.width, zone.minY);
    ctx.strokeStyle = 'rgba(130, 210, 235, 0.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(0, zone.minY); ctx.lineTo(ctx.canvas.width, zone.minY); ctx.stroke();
    ctx.fillStyle = 'rgba(180, 225, 235, 0.9)'; ctx.font = '10px serif'; ctx.fillText('CASTING ZONE', 7, zone.minY + 13);
    ctx.restore();
  }
  if (!_dragActive) return;

  if (phase === 'targeting-spell' && gs.pendingSpellCardUid) {
    const card = gs.player.hand.find(c => c.uid === gs.pendingSpellCardUid);
    if (!card) return;
    const def   = CARD_DEFS[card.defId];
    const color = _EL_COLOR[def.element] ?? '#fff';
    const sx    = gs.player.base.simX;
    const sy    = gs.player.base.simY;
    const tx    = _dragCurrent.x;
    const ty    = _dragCurrent.y;
    const valid = isPointInPlacementZone('player', ty);

    ctx.save();
    // Trajectory line
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = valid ? color : '#e55';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // Arrowhead at target
    const angle = Math.atan2(ty - sy, tx - sx);
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle   = valid ? color : '#e55';
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(angle) * 5, ty + Math.sin(angle) * 5);
    ctx.lineTo(tx + Math.cos(angle + 2.5) * 6, ty + Math.sin(angle + 2.5) * 6);
    ctx.lineTo(tx + Math.cos(angle - 2.5) * 6, ty + Math.sin(angle - 2.5) * 6);
    ctx.closePath();
    ctx.fill();

    // Glow ring at target
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = valid ? color : '#e55';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(tx, ty, 5, 0, Math.PI * 2);
    ctx.stroke();

    // Source pulse ring at player base
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    return;
  }

  if (phase === 'placing-creature' || phase === 'placing-generator') {
    const cardUid = gs.pendingCreatureCardUid ?? gs.pendingGeneratorCardUid;
    if (!cardUid) return;
    const card = gs.player.hand.find(c => c.uid === cardUid);
    if (!card) return;
    const def   = CARD_DEFS[card.defId];
    const color = _EL_COLOR[def.element] ?? '#fff';
    const { x, y } = _dragCurrent;

    const validY = isPointInPlacementZone('player', y);
    const boxColor = validY ? color : '#e44';

    ctx.save();
    // Ghost box at placement position
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = boxColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(x - 7, y - 7, 14, 14);

    // March direction arrow (always toward enemy = upward for player)
    const arrowLen = 36;
    const arrowTy  = Math.max(2, y - arrowLen);
    ctx.setLineDash([4, 3]);
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, arrowTy);
    ctx.stroke();

    // Arrowhead
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.moveTo(x, arrowTy - 4);
    ctx.lineTo(x - 3, arrowTy + 4);
    ctx.lineTo(x + 3, arrowTy + 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    return;
  }

  if (phase === 'placing-structure' && gs.pendingStructureCardUid) {
    const card = gs.player.hand.find(c => c.uid === gs.pendingStructureCardUid);
    if (!card) return;
    const def    = CARD_DEFS[card.defId];
    const color  = _EL_COLOR[def.element] ?? '#aaa';
    const radius = structureRadius(def.structureShape ?? 'wall_line');
    const { x, y } = _dragCurrent;
    const validY = isPointInPlacementZone('player', y);
    const outlineColor = validY ? color : '#e44';

    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 2]);
    // Horizontal footprint bar
    ctx.strokeRect(x - radius, y - 4, radius * 2, 8);
    // Center dot
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle   = outlineColor;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Look up the name of a card in the player's hand by its uid. */
function pendingCardName(gs: GameState, uid: string | null): string {
  if (!uid) return '';
  const card = gs.player.hand.find(c => c.uid === uid);
  return card ? (CARD_DEFS[card.defId]?.name ?? '') : '';
}

/** Look up the name of a player creature by its uid. */
function attackerName(gs: GameState, uid: string | null): string {
  if (!uid) return 'Creature';
  const u = gs.player.creatures.find(c => c.uid === uid);
  return u ? (CARD_DEFS[u.defId]?.name ?? 'Creature') : 'Creature';
}

function hpBar(hp: number, max: number, showIntegrity = false): string {
  const pct = Math.max(0, hp / max) * 100;
  const color = pct > 50 ? '#3c9' : pct > 25 ? '#fa3' : '#e44';
  return `<div class="hp-bar-wrap"><div class="hp-bar" style="width:${pct}%;background:${color}"></div></div>
          <div class="hp-text">${showIntegrity ? `Integrity ${Math.round(pct)}%` : `${hp}/${max}`}</div>`;
}

function unitCard(u: UnitInstance, classes: string, clickable: boolean, extra = ''): string {
  const def = CARD_DEFS[u.defId];
  const exhausted = def.type === 'CREATURE' && u.hasAttacked ? ' exhausted' : '';
  const onClick = clickable ? `data-uid="${u.uid}"` : '';
  return `<div class="unit-card ${classes}${exhausted}" ${onClick} style="border-color:${ELEMENT_COLOR[def.element]};background:${ELEMENT_BG[def.element]}" ${extra}>
    <div class="unit-name">${def.name}</div>
    <div class="unit-type-badge" style="background:${ELEMENT_COLOR[def.element]}">${def.element}</div>
    ${def.type === 'CREATURE' ? `<div class="unit-atk">ATK ${u.attack}</div>` : ''}
    ${hpBar(u.hp, u.maxHp, def.type === 'GENERATOR')}
  </div>`;
}

function handCard(card: CardInstance, gs: GameState): string {
  const def = CARD_DEFS[card.defId];
  const playable = canPlayCard(gs, card.uid);
  const selected = gs.selectedCardUid === card.uid || gs.pendingSpellCardUid === card.uid || gs.pendingGeneratorCardUid === card.uid || gs.pendingCreatureCardUid === card.uid || gs.pendingStructureCardUid === card.uid;
  const cls = [
    'hand-card',
    playable ? 'playable' : 'unplayable',
    selected ? 'selected' : '',
  ].join(' ');
  return `<div class="${cls}" data-card-uid="${card.uid}" draggable="true"
      style="border-color:${ELEMENT_COLOR[def.element]}">
    <div class="card-cost">${def.cost}</div>
    <div class="card-name">${def.name}</div>
    <div class="card-type-badge" style="background:${ELEMENT_COLOR[def.element]}">${def.element} · ${def.type}</div>
    <div class="card-art-zone" data-card-art="${card.defId}"></div>
    <div class="card-stats">
      ${def.hp !== undefined ? `<span>HP ${def.hp}</span>` : ''}
      ${def.attack !== undefined && def.attack > 0 ? `<span>ATK ${def.attack}</span>` : ''}
    </div>
    <div class="card-rules">${def.rulesText}</div>
  </div>`;
}

function renderDeckBuilder(appEl: HTMLElement): void {
  const validation = validatePlayerDeck(_playerDeck);
  const counts = new Map<string, number>();
  for (const id of _playerDeck) counts.set(id, (counts.get(id) ?? 0) + 1);
  const cards = Object.keys(CARD_DEFS).map(id => {
    const def = CARD_DEFS[id], count = counts.get(id) ?? 0;
    return `<div class="deck-card" style="border-color:${ELEMENT_COLOR[def.element]}"><div><b>${def.name}</b><span>${def.type.toLowerCase()} · ${def.cost} energy</span></div><div class="deck-card-controls"><button data-deck-remove="${id}" ${count ? '' : 'disabled'}>−</button><b>${count}</b><button data-deck-add="${id}" ${_playerDeck.length >= DECK_SIZE ? 'disabled' : ''}>+</button></div></div>`;
  }).join('');
  appEl.innerHTML = `<div class="mode-menu"><div class="mode-menu-box deck-builder"><div class="mode-kicker">DECKADENT</div><h1>Deck Builder</h1><p>Build a ${DECK_SIZE}-card deck. Creatures must be the majority.</p><div class="deck-requirements"><span>Generators <b>${validation.generators}/${MIN_GENERATORS}</b></span><span>Creatures <b>${validation.creatures}/${MIN_CREATURES}</b></span><span>Spells <b>${validation.spells}/${MIN_SPELLS}</b></span><span>Cards <b>${_playerDeck.length}/${DECK_SIZE}</b></span></div><div class="deck-validity ${validation.valid ? 'valid' : 'invalid'}">${validation.message}</div><div class="deck-card-list">${cards}</div><button class="mode-option" data-deck-reset><b>Restore starter deck</b></button><button class="mode-option" data-deck-back><b>Back to game modes</b></button></div></div>`;
  appEl.querySelectorAll('[data-deck-add]').forEach(el => el.addEventListener('click', () => { _playerDeck.push((el as HTMLElement).dataset.deckAdd!); savePlayerDeck(); renderUI(_gs, appEl); }));
  appEl.querySelectorAll('[data-deck-remove]').forEach(el => el.addEventListener('click', () => { const id = (el as HTMLElement).dataset.deckRemove!; const index = _playerDeck.lastIndexOf(id); if (index >= 0) _playerDeck.splice(index, 1); savePlayerDeck(); renderUI(_gs, appEl); }));
  appEl.querySelector('[data-deck-reset]')?.addEventListener('click', () => { _playerDeck = [...PLAYER_STARTING_DECK]; savePlayerDeck(); renderUI(_gs, appEl); });
  appEl.querySelector('[data-deck-back]')?.addEventListener('click', () => { _menuView = 'modes'; renderUI(_gs, appEl); });
}

// ─── Main render ─────────────────────────────────────────────────────────────

export function renderUI(gs: GameState, appEl: HTMLElement): void {
  if (gs.matchPhase === 'mode-select') {
    if (_menuView === 'deck') { renderDeckBuilder(appEl); return; }
    const deckValid = validatePlayerDeck(_playerDeck).valid;
    appEl.innerHTML = `<div class="mode-menu"><div class="mode-menu-box"><div class="mode-kicker">DECKADENT</div><h1>Game Mode</h1><p>Choose a local or network session.</p><button data-mode="frozen-hotseat" class="mode-option"><b>Frozen Turn-Based Hotseat</b><span>Playable now · shared device · planning freezes simulation.</span></button><button data-mode="realtime-hotseat" class="mode-option"><b>Real-Time Hotseat</b><span>Playable now · shared device/mobile · simulation runs continuously.</span></button><button data-mode="realtime-lan-host" class="mode-option"><b>Real-Time LAN — Host</b><span>Host-authoritative session scaffold.</span></button><button data-mode="realtime-lan-client" class="mode-option"><b>Real-Time LAN — Join</b><span>Client mirror scaffold · enter host address.</span></button><button class="mode-option disabled" disabled><b>Online Play</b><span>Coming later</span></button></div></div>`;
    appEl.innerHTML = `<div class="mode-menu"><div class="mode-menu-box"><div class="mode-kicker">DECKADENT</div><h1>Game Mode</h1><p>Choose a local or network session.</p><button data-open-deck class="mode-option"><b>Customize Deck</b><span>${validatePlayerDeck(_playerDeck).message}</span></button><button data-mode="frozen-hotseat" class="mode-option" ${deckValid ? '' : 'disabled'}><b>Frozen Turn-Based Hotseat</b><span>Shared device; planning freezes simulation.</span></button><button data-mode="realtime-hotseat" class="mode-option" ${deckValid ? '' : 'disabled'}><b>Real-Time Hotseat</b><span>Shared device; simulation runs continuously.</span></button><button data-mode="realtime-lan-host" class="mode-option" ${deckValid ? '' : 'disabled'}><b>Real-Time LAN — Host</b><span>Host-authoritative session scaffold.</span></button><button data-mode="realtime-lan-client" class="mode-option" ${deckValid ? '' : 'disabled'}><b>Real-Time LAN — Join</b><span>Client mirror scaffold; enter host address.</span></button><button class="mode-option disabled" disabled><b>Online Play</b><span>Coming later</span></button></div></div>`;
    appEl.querySelector('[data-open-deck]')?.addEventListener('click', () => { _menuView = 'deck'; renderUI(_gs, appEl); });
    appEl.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => { const mode = (el as HTMLElement).dataset.mode as GameMode; const address = mode === 'realtime-lan-client' ? window.prompt('Host WebSocket address', 'ws://192.168.1.10:8080') ?? undefined : undefined; if (address !== undefined || mode !== 'realtime-lan-client') _startMatch?.(mode, address, [..._playerDeck]); }));
    return;
  }
  // In real-time hotseat this is the large mobile-safe active-side switch. The
  // same renderer is intentionally reused for either local seat.
  const { turn, phase, status } = gs;
  const player = turn === 'player' ? gs.player : gs.enemy;
  const enemy = turn === 'player' ? gs.enemy : gs.player;
  const activeOwner = turn;
  const planning = gs.matchPhase === 'planning';

  const attackerId = gs.selectedAttackerUid;
  const isTargetingAttack = planning && phase === 'targeting-attack' && attackerId && turn === 'player';
  const isTargetingSpell  = planning && phase === 'targeting-spell' && turn === 'player';

  function targetClass(uid: string, side: 'enemy' | 'player'): string {
    if ((isTargetingAttack || isTargetingSpell) && side === 'enemy') return 'valid-target';
    return '';
  }

  const enemyGenCards = enemy.generators.map(u =>
    unitCard(u, `generator ${targetClass(u.uid, 'enemy')}`, isTargetingAttack || isTargetingSpell, `data-target="${u.uid}"`)
  ).join('');

  const enemyCreatureCards = enemy.creatures.map(u =>
    unitCard(u, `creature ${targetClass(u.uid, 'enemy')}`, isTargetingAttack || isTargetingSpell, `data-target="${u.uid}"`)
  ).join('');

  // Base target button — shown in enemy zone when targeting attack or spell.
  const baseTargetBtn = (isTargetingAttack || isTargetingSpell)
    ? `<button class="base-target-btn valid-target" data-target-base="${activeOwner === 'player' ? 'enemy' : 'player'}"
         title="Target enemy base core (HP ${enemy.base.hp}/${enemy.base.maxHp})">
         ⚔ Enemy Base (${enemy.base.hp}/${enemy.base.maxHp} core)
       </button>`
    : `<div class="base-hp-info">Base: ${enemy.base.hp}/${enemy.base.maxHp} core</div>`;

  const playerCreatureCards = player.creatures.map(u => {
    const ready = !u.hasAttacked && phase === 'main' && !gs.aiActing;
    const sel = gs.selectedAttackerUid === u.uid ? ' attacker-selected' : '';
    return unitCard(u, `creature${sel}${ready ? ' ready' : ''}`, ready, `data-attacker="${u.uid}"`);
  }).join('');

  const playerGenCards = player.generators.map(u =>
    unitCard(u, 'generator', false)
  ).join('');

  const handCards = player.hand.map(c => handCard(c, gs)).join('');

  let phaseMsg = '';
  if (gs.matchPhase === 'simulation') {
    phaseMsg = `<div class="phase-msg simulation-msg">Simulation resolving: ${(gs.simulationTicksRemaining / 30).toFixed(1)}s</div>`;
  } else if (turn === 'enemy' || gs.aiActing) {
    phaseMsg = `<div class="phase-msg enemy-turn">Enemy is acting…</div>`;
  } else if (phase === 'targeting-attack') {
    const aname = attackerName(gs, gs.selectedAttackerUid);
    phaseMsg = `<div class="phase-msg"><b>${aname}</b> — click an enemy unit or the ⚔ Enemy Base button to attack. Click elsewhere to cancel.</div>`;
  } else if (phase === 'targeting-spell') {
    const sname = pendingCardName(gs, gs.pendingSpellCardUid);
    phaseMsg = `<div class="phase-msg">Cast <b>${sname || 'Spell'}</b> — <b>drag on the battlefield</b> to aim and release to fire. Or click an enemy unit / ⚔ button. Click elsewhere to cancel.</div>`;
  } else if (phase === 'placing-generator') {
    phaseMsg = `<div class="phase-msg"><b>Drag in the highlighted lower 40%</b> to position your generator, then release to place.</div>`;
  } else if (phase === 'placing-creature') {
    const cname = pendingCardName(gs, gs.pendingCreatureCardUid);
    phaseMsg = `<div class="phase-msg"><b>Drag in the highlighted lower 40%</b> to deploy <b>${cname || 'Creature'}</b>.</div>`;
  } else if (phase === 'placing-structure') {
    const stname = pendingCardName(gs, gs.pendingStructureCardUid);
    phaseMsg = `<div class="phase-msg"><b>Drag in the highlighted lower 40%</b> to position <b>${stname || 'Structure'}</b>.</div>`;
  }

  const endTurnBtn = planning && !gs.aiActing
    ? `<button id="end-turn-btn" class="end-turn-btn">End Turn</button>`
    : `<button class="end-turn-btn" disabled>End Turn</button>`;

  const logLines = gs.combatLog.slice(-12).map(l => `<div class="log-line">${l}</div>`).join('');
  const stateHash = hashHex(gs);
  const redrawCost = [0, 1, 2, 3][player.redrawsThisTurn];
  const canRedraw = planning && phase === 'main' && status === 'playing' && redrawCost !== undefined && player.energy >= redrawCost && player.deck.length > 0;

  appEl.innerHTML = `
<div class="game-root">

  <!-- Instructions -->
  <div class="instructions">
    <b>Deckadent</b> — <span class="turn-label ${turn}">${gs.matchPhase === 'simulation' ? 'SIMULATION' : `Planning: ${ownerLabel(turn)}`}</span>
    &nbsp;|&nbsp; Energy: <span class="energy">${turn === 'player' ? player.energy : enemy.energy}</span>
    &nbsp;|&nbsp; Deck: ${player.deck.length} · Discard: ${player.discard.length}
    &nbsp;|&nbsp; <span class="debug-hash" title="Deterministic state hash (tick ${gs.tick})">⬡ ${stateHash}</span>
    <span class="hint">${planning ? `SIM FROZEN · Next planning order: ${ownerLabel(gs.planningOrder[0])} → ${ownerLabel(gs.planningOrder[1])}` : 'Card placement locked while the simulation resolves.'}</span>
  </div>

  <div class="play-area">
    <!-- Player side -->
    <div class="side player-side">
      <div class="side-title">Player</div>
      <div class="base-hp-info">Base: ${player.base.hp}/${player.base.maxHp} core</div>
      <div class="zone-label">Creatures (${player.creatures.length})</div>
      <div class="unit-row creatures">${playerCreatureCards || '<span class="empty-zone">No creatures</span>'}</div>
      <div class="zone-label">Generators (${player.generators.length}) · Energy ${player.energy}/${player.generators.length}</div>
      <div class="unit-row generators">${playerGenCards || '<span class="empty-zone">No generators!</span>'}</div>
    </div>

    <!-- Battle canvas -->
    <div class="battle-area">
      ${phaseMsg}
      <div id="canvas-slot"></div>
    </div>

    <!-- Opponent side -->
    <div class="side enemy-side">
      <div class="side-title">Opponent</div>
      ${baseTargetBtn}
      <div class="zone-label">Creatures (${enemy.creatures.length})</div>
      <div class="unit-row creatures">${enemyCreatureCards || '<span class="empty-zone">No creatures</span>'}</div>
      <div class="zone-label">Generators (${enemy.generators.length}) · Energy ${enemy.energy}</div>
      <div class="unit-row generators">${enemyGenCards || '<span class="empty-zone">No generators</span>'}</div>
    </div>
  </div>

  <!-- Hand + controls -->
  <div class="hand-area">
    ${gs.gameMode === 'realtime-hotseat' ? `<button id="seat-toggle-btn" class="seat-toggle">Active controls: ${ownerLabel(activeOwner)} — Switch Player</button>` : ''}
    <div class="hand-cards">${handCards}</div>
    <div class="controls">
      ${endTurnBtn}
      <div class="discard-drop ${canRedraw ? '' : 'disabled'}" data-discard-drop><b>Discard & Draw</b><span>${redrawCost === undefined ? 'No redraws left this turn' : canRedraw ? `Drag a card here · ${redrawCost} energy` : player.deck.length === 0 ? 'Deck empty' : `Need ${redrawCost} energy`}</span></div>
      <span class="deck-info">Deck ${player.deck.length} · Discard ${player.discard.length}</span>
    </div>
  </div>

  <!-- Combat log -->
  <div class="combat-log">${logLines}</div>

</div>

${status !== 'playing' ? `
<div class="overlay">
  <div class="overlay-box">
    <div class="overlay-title">${status === 'win' ? '🏆 Victory!' : '💀 Defeat'}</div>
    <div class="overlay-msg">${status === 'win' ? 'Enemy base core destroyed.' : 'Your base core was destroyed.'}</div>
    <button id="restart-btn">Restart</button>
  </div>
</div>` : ''}
`;

  const slot = appEl.querySelector('#canvas-slot');
  if (slot) slot.appendChild(_canvas);
  _canvas.classList.toggle('placement-active', planning && (gs.phase === 'placing-generator' || gs.phase === 'placing-creature' || gs.phase === 'placing-structure' || gs.phase === 'targeting-spell'));

  bindEvents(gs, appEl);
  mountCardArtCanvases(appEl);
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindEvents(gs: GameState, appEl: HTMLElement): void {
  const actionLocked = () => gs.gameMode === 'frozen-hotseat' && gs.matchPhase !== 'planning';
  appEl.querySelector('#seat-toggle-btn')?.addEventListener('click', () => {
    gs.turn = gs.turn === 'player' ? 'enemy' : 'player';
    gs.combatLog.push(`Active hotseat controls: ${ownerLabel(gs.turn)}.`);
    _renderFn();
  });
  appEl.querySelector('#end-turn-btn')?.addEventListener('click', () => {
    if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;
    gs.selectedCardUid = null;
    gs.selectedAttackerUid = null;
    gs.pendingSpellCardUid = null;
    gs.pendingGeneratorCardUid = null;
    gs.phase = 'main';
    applyCommand(gs, { kind: 'endTurn', tick: gs.tick, owner: gs.turn, source: 'local' });
    _renderFn();
    const nextTurn: string = gs.turn;
    if (nextTurn === 'enemy') {
      runEnemyTurn(gs, _renderFn, () => {
        if (gs.status === 'playing') _renderFn();
      });
    }
  });

  appEl.querySelector('#restart-btn')?.addEventListener('click', () => {
    window.location.reload();
  });

  appEl.querySelectorAll('[data-card-uid]').forEach(el => {
    el.addEventListener('dragstart', e => {
      const uid = (el as HTMLElement).dataset.cardUid!;
      const transfer = (e as DragEvent).dataTransfer;
      transfer?.setData('text/plain', uid);
      if (transfer) transfer.effectAllowed = 'move';
    });
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;
      const uid = (el as HTMLElement).dataset.cardUid!;
      const card = (gs.turn === 'player' ? gs.player : gs.enemy).hand.find(c => c.uid === uid);
      if (!card) return;
      const def = CARD_DEFS[card.defId];

      if (!canPlayCard(gs, uid)) return;

      if (def.type === 'SPELL') {
        gs.pendingSpellCardUid = uid;
        gs.pendingGeneratorCardUid = null;
        gs.selectedCardUid = uid;
        gs.phase = 'targeting-spell';
        gs.selectedAttackerUid = null;
        _renderFn();
        return;
      }

      if (def.type === 'GENERATOR') {
        gs.pendingGeneratorCardUid = uid;
        gs.pendingSpellCardUid = null;
        gs.selectedCardUid = uid;
        gs.phase = 'placing-generator';
        gs.selectedAttackerUid = null;
        _renderFn();
        return;
      }

      if (def.type === 'STRUCTURE') {
        gs.pendingStructureCardUid = uid;
        gs.pendingSpellCardUid = null;
        gs.pendingGeneratorCardUid = null;
        gs.pendingCreatureCardUid = null;
        gs.selectedCardUid = uid;
        gs.phase = 'placing-structure';
        gs.selectedAttackerUid = null;
        _renderFn();
        return;
      }

      // Creature: enter placement phase so player clicks a battlefield position.
      gs.pendingCreatureCardUid = uid;
      gs.pendingSpellCardUid = null;
      gs.pendingGeneratorCardUid = null;
      gs.pendingStructureCardUid = null;
      gs.selectedCardUid = uid;
      gs.phase = 'placing-creature';
      gs.selectedAttackerUid = null;
      _renderFn();
    });
  });

  const discardDrop = appEl.querySelector('[data-discard-drop]');
  discardDrop?.addEventListener('dragover', e => {
    if (!(discardDrop as HTMLElement).classList.contains('disabled')) e.preventDefault();
  });
  discardDrop?.addEventListener('drop', e => {
    e.preventDefault();
    if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;
    const cardUid = (e as DragEvent).dataTransfer?.getData('text/plain');
    if (!cardUid) return;
    applyCommand(gs, { kind: 'redrawCard', tick: gs.tick, owner: gs.turn, cardUid, source: 'local' });
    _renderFn();
  });

  appEl.querySelectorAll('[data-attacker]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;
      const uid = (el as HTMLElement).dataset.attacker!;
      const creature = (gs.turn === 'player' ? gs.player : gs.enemy).creatures.find(c => c.uid === uid);
      if (!creature || creature.hasAttacked) return;

      if (gs.phase === 'targeting-attack' && gs.selectedAttackerUid === uid) {
        gs.phase = 'main';
        gs.selectedAttackerUid = null;
      } else {
        gs.selectedAttackerUid = uid;
        gs.phase = 'targeting-attack';
        gs.selectedCardUid = null;
        gs.pendingSpellCardUid = null;
        gs.pendingGeneratorCardUid = null;
      }
      _renderFn();
    });
  });

  // Clear legacy onclick — all canvas interaction is now drag-based.
  _canvas.onclick = null;

  _canvas.onmousedown = e => {
    e.preventDefault();
    e.stopPropagation();
    if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;

    const isPlacingGen       = gs.phase === 'placing-generator' && !!gs.pendingGeneratorCardUid;
    const isPlacingCreature  = gs.phase === 'placing-creature'  && !!gs.pendingCreatureCardUid;
    const isPlacingStructure = gs.phase === 'placing-structure' && !!gs.pendingStructureCardUid;
    const isTargetingSpell   = gs.phase === 'targeting-spell'   && !!gs.pendingSpellCardUid;
    if (!isPlacingGen && !isPlacingCreature && !isPlacingStructure && !isTargetingSpell) return;

    // Clean up any stale drag listeners from a prior interrupted drag.
    removeDragListeners();

    const start = toCanvasCoords(e);
    _dragActive  = true;
    _dragStart   = start;
    _dragCurrent = { ...start };

    _docMoveHandler = (me: MouseEvent) => {
      _dragCurrent = toCanvasCoords(me);
    };

    _docUpHandler = (me: MouseEvent) => {
      _dragCurrent = toCanvasCoords(me);
      _dragActive  = false;
      removeDragListeners();

      // The release position is the action target for both spells and placements.
      const { x, y } = _dragCurrent;
      const cardUid = isTargetingSpell   ? gs.pendingSpellCardUid!
                    : isPlacingGen       ? gs.pendingGeneratorCardUid!
                    : isPlacingCreature  ? gs.pendingCreatureCardUid!
                    : gs.pendingStructureCardUid!;

      const ok = applyCommand(gs, {
        kind: 'playCard', tick: gs.tick, owner: gs.turn, source: 'local',
        cardUid, placement: { x, y },
      });

      if (ok) {
        gs.pendingSpellCardUid    = null;
        gs.pendingGeneratorCardUid = null;
        gs.pendingCreatureCardUid  = null;
        gs.pendingStructureCardUid = null;
        gs.selectedCardUid         = null;
        gs.phase = 'main';
      }
      _renderFn();
    };

    document.addEventListener('mousemove', _docMoveHandler);
    document.addEventListener('mouseup',   _docUpHandler);
  };

  appEl.querySelectorAll('[data-target]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;
      const targetUid = (el as HTMLElement).dataset.target!;

      if (gs.phase === 'targeting-attack' && gs.selectedAttackerUid) {
        const ok = applyCommand(gs, {
          kind: 'attackTarget', tick: gs.tick, owner: gs.turn, source: 'local',
          attackerUid: gs.selectedAttackerUid, targetUid,
        });
        if (ok) { gs.selectedAttackerUid = null; gs.phase = 'main'; }
        _renderFn();
      } else if (gs.phase === 'targeting-spell' && gs.pendingSpellCardUid) {
        const ok = applyCommand(gs, {
          kind: 'playCard', tick: gs.tick, owner: gs.turn, source: 'local',
          cardUid: gs.pendingSpellCardUid, targetUid,
        });
        if (ok) {
          gs.pendingSpellCardUid = null; gs.selectedCardUid = null;
          gs.pendingGeneratorCardUid = null; gs.phase = 'main';
        }
        _renderFn();
      }
    });
  });

  // Base targeting — fires at enemy base directly.
  appEl.querySelectorAll('[data-target-base]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (actionLocked() || gs.aiActing || gs.status !== 'playing') return;
      const targetBase = (el as HTMLElement).dataset.targetBase as 'player' | 'enemy';

      if (gs.phase === 'targeting-attack' && gs.selectedAttackerUid) {
        const ok = applyCommand(gs, {
          kind: 'attackTarget', tick: gs.tick, owner: gs.turn, source: 'local',
          attackerUid: gs.selectedAttackerUid, targetBase,
        });
        if (ok) { gs.selectedAttackerUid = null; gs.phase = 'main'; }
        _renderFn();
      } else if (gs.phase === 'targeting-spell' && gs.pendingSpellCardUid) {
        const ok = applyCommand(gs, {
          kind: 'playCard', tick: gs.tick, owner: gs.turn, source: 'local',
          cardUid: gs.pendingSpellCardUid, targetBase,
        });
        if (ok) {
          gs.pendingSpellCardUid = null; gs.selectedCardUid = null;
          gs.pendingGeneratorCardUid = null; gs.phase = 'main';
        }
        _renderFn();
      }
    });
  });

  appEl.querySelector('.game-root')?.addEventListener('click', () => {
    if (gs.phase !== 'main') {
      // Also cancel any in-progress drag.
      _dragActive = false;
      removeDragListeners();
      gs.phase = 'main';
      gs.selectedAttackerUid = null;
      gs.selectedCardUid = null;
      gs.pendingSpellCardUid = null;
      gs.pendingGeneratorCardUid = null;
      gs.pendingCreatureCardUid = null;
      gs.pendingStructureCardUid = null;
      _renderFn();
    }
  });
}
