import type { GameState, UnitInstance, CardInstance } from './types';
import { CARD_DEFS } from './cards';
import { canPlayCard } from './rules';
import { applyCommand } from './commands';
import { hashHex } from './stateHash';
import { runEnemyTurn } from './ai';

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

export function initUI(
  gs: GameState,
  canvas: HTMLCanvasElement,
  renderFn: () => void
): void {
  _gs = gs;
  _canvas = canvas;
  _renderFn = renderFn;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hpBar(hp: number, max: number): string {
  const pct = Math.max(0, hp / max) * 100;
  const color = pct > 50 ? '#3c9' : pct > 25 ? '#fa3' : '#e44';
  return `<div class="hp-bar-wrap"><div class="hp-bar" style="width:${pct}%;background:${color}"></div></div>
          <div class="hp-text">${hp}/${max}</div>`;
}

function unitCard(u: UnitInstance, classes: string, clickable: boolean, extra = ''): string {
  const def = CARD_DEFS[u.defId];
  const exhausted = def.type === 'CREATURE' && u.hasAttacked ? ' exhausted' : '';
  const onClick = clickable ? `data-uid="${u.uid}"` : '';
  return `<div class="unit-card ${classes}${exhausted}" ${onClick} style="border-color:${ELEMENT_COLOR[def.element]};background:${ELEMENT_BG[def.element]}" ${extra}>
    <div class="unit-name">${def.name}</div>
    <div class="unit-type-badge" style="background:${ELEMENT_COLOR[def.element]}">${def.element}</div>
    ${def.type === 'CREATURE' ? `<div class="unit-atk">ATK ${u.attack}</div>` : ''}
    ${hpBar(u.hp, u.maxHp)}
  </div>`;
}

function handCard(card: CardInstance, gs: GameState): string {
  const def = CARD_DEFS[card.defId];
  const playable = canPlayCard(gs, card.uid);
  const selected = gs.selectedCardUid === card.uid || gs.pendingSpellCardUid === card.uid || gs.pendingGeneratorCardUid === card.uid;
  const cls = [
    'hand-card',
    playable ? 'playable' : 'unplayable',
    selected ? 'selected' : '',
  ].join(' ');
  return `<div class="${cls}" data-card-uid="${card.uid}"
      style="border-color:${ELEMENT_COLOR[def.element]}">
    <div class="card-cost">${def.cost}</div>
    <div class="card-name">${def.name}</div>
    <div class="card-type-badge" style="background:${ELEMENT_COLOR[def.element]}">${def.element} · ${def.type}</div>
    <div class="card-stats">
      ${def.hp !== undefined ? `<span>HP ${def.hp}</span>` : ''}
      ${def.attack !== undefined && def.attack > 0 ? `<span>ATK ${def.attack}</span>` : ''}
    </div>
    <div class="card-rules">${def.rulesText}</div>
  </div>`;
}

// ─── Main render ─────────────────────────────────────────────────────────────

export function renderUI(gs: GameState, appEl: HTMLElement): void {
  const { player, enemy, turn, phase, status } = gs;

  const attackerId = gs.selectedAttackerUid;
  const isTargetingAttack = phase === 'targeting-attack' && attackerId && turn === 'player';
  const isTargetingSpell  = phase === 'targeting-spell' && turn === 'player';

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

  const playerCreatureCards = player.creatures.map(u => {
    const ready = !u.hasAttacked && turn === 'player' && phase === 'main' && !gs.aiActing;
    const sel = gs.selectedAttackerUid === u.uid ? ' attacker-selected' : '';
    return unitCard(u, `creature${sel}${ready ? ' ready' : ''}`, ready, `data-attacker="${u.uid}"`);
  }).join('');

  const playerGenCards = player.generators.map(u =>
    unitCard(u, 'generator', false)
  ).join('');

  const handCards = player.hand.map(c => handCard(c, gs)).join('');

  let phaseMsg = '';
  if (turn === 'enemy' || gs.aiActing) {
    phaseMsg = `<div class="phase-msg enemy-turn">Enemy is acting…</div>`;
  } else if (phase === 'targeting-attack') {
    phaseMsg = `<div class="phase-msg">Select an enemy creature or generator to attack — or click elsewhere to cancel.</div>`;
  } else if (phase === 'targeting-spell') {
    phaseMsg = `<div class="phase-msg">Select a target for your spell — or click elsewhere to cancel.</div>`;
  } else if (phase === 'placing-generator') {
    phaseMsg = `<div class="phase-msg">Click the simulation field to place your generator.</div>`;
  }

  const endTurnBtn = turn === 'player' && !gs.aiActing
    ? `<button id="end-turn-btn" class="end-turn-btn">End Turn</button>`
    : `<button class="end-turn-btn" disabled>End Turn</button>`;

  const logLines = gs.combatLog.slice(-12).map(l => `<div class="log-line">${l}</div>`).join('');
  const stateHash = hashHex(gs);

  appEl.innerHTML = `
<div class="game-root">

  <!-- Instructions -->
  <div class="instructions">
    <b>Deckadent</b> — Turn: <span class="turn-label ${turn}">${turn.toUpperCase()}</span>
    &nbsp;|&nbsp; Energy: <span class="energy">${turn === 'player' ? player.energy : enemy.energy}</span>
    &nbsp;|&nbsp; Deck: ${player.deck.length} · Discard: ${player.discard.length}
    &nbsp;|&nbsp; <span class="debug-hash" title="Deterministic state hash (tick ${gs.tick})">⬡ ${stateHash}</span>
    <span class="hint">Play generators → get energy. Creatures attack once per turn. Spells need a target.</span>
  </div>

  <div class="play-area">
    <!-- Player side -->
    <div class="side player-side">
      <div class="side-title">Player</div>
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
      <div class="zone-label">Creatures (${enemy.creatures.length})</div>
      <div class="unit-row creatures">${enemyCreatureCards || '<span class="empty-zone">No creatures</span>'}</div>
      <div class="zone-label">Generators (${enemy.generators.length}) · Energy ${enemy.energy}</div>
      <div class="unit-row generators">${enemyGenCards || '<span class="empty-zone">No generators</span>'}</div>
    </div>
  </div>

  <!-- Hand + controls -->
  <div class="hand-area">
    <div class="hand-cards">${handCards}</div>
    <div class="controls">
      ${endTurnBtn}
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
    <div class="overlay-msg">${status === 'win' ? 'All enemy generators destroyed.' : 'All your generators destroyed.'}</div>
    <button id="restart-btn">Restart</button>
  </div>
</div>` : ''}
`;

  const slot = appEl.querySelector('#canvas-slot');
  if (slot) slot.appendChild(_canvas);
  _canvas.classList.toggle('placement-active', gs.phase === 'placing-generator');

  bindEvents(gs, appEl);
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindEvents(gs: GameState, appEl: HTMLElement): void {
  appEl.querySelector('#end-turn-btn')?.addEventListener('click', () => {
    if (gs.turn !== 'player' || gs.aiActing || gs.status !== 'playing') return;
    gs.selectedCardUid = null;
    gs.selectedAttackerUid = null;
    gs.pendingSpellCardUid = null;
    gs.pendingGeneratorCardUid = null;
    gs.phase = 'main';
    applyCommand(gs, { kind: 'endTurn', tick: gs.tick, owner: 'player' });
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
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (gs.turn !== 'player' || gs.aiActing || gs.status !== 'playing') return;
      const uid = (el as HTMLElement).dataset.cardUid!;
      const card = gs.player.hand.find(c => c.uid === uid);
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

      // Creature: play immediately via command
      applyCommand(gs, { kind: 'playCard', tick: gs.tick, owner: 'player', cardUid: uid });
      gs.selectedCardUid = null;
      gs.phase = 'main';
      _renderFn();
    });
  });

  appEl.querySelectorAll('[data-attacker]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (gs.turn !== 'player' || gs.aiActing || gs.status !== 'playing') return;
      const uid = (el as HTMLElement).dataset.attacker!;
      const creature = gs.player.creatures.find(c => c.uid === uid);
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

  _canvas.onclick = e => {
    e.stopPropagation();
    if (gs.turn !== 'player' || gs.aiActing || gs.status !== 'playing') return;
    if (gs.phase !== 'placing-generator' || !gs.pendingGeneratorCardUid) return;

    const rect = _canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(_canvas.width - 1, Math.round(((e.clientX - rect.left) / rect.width) * _canvas.width)));
    const y = Math.max(0, Math.min(_canvas.height - 1, Math.round(((e.clientY - rect.top) / rect.height) * _canvas.height)));

    applyCommand(gs, {
      kind: 'playCard',
      tick: gs.tick,
      owner: 'player',
      cardUid: gs.pendingGeneratorCardUid,
      placement: { x, y },
    });
    gs.pendingGeneratorCardUid = null;
    gs.selectedCardUid = null;
    gs.phase = 'main';
    _renderFn();
  };

  appEl.querySelectorAll('[data-target]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (gs.turn !== 'player' || gs.aiActing || gs.status !== 'playing') return;
      const targetUid = (el as HTMLElement).dataset.target!;

      if (gs.phase === 'targeting-attack' && gs.selectedAttackerUid) {
        applyCommand(gs, {
          kind: 'attackTarget',
          tick: gs.tick,
          owner: 'player',
          attackerUid: gs.selectedAttackerUid,
          targetUid,
        });
        gs.selectedAttackerUid = null;
        gs.phase = 'main';
        _renderFn();
      } else if (gs.phase === 'targeting-spell' && gs.pendingSpellCardUid) {
        applyCommand(gs, {
          kind: 'playCard',
          tick: gs.tick,
          owner: 'player',
          cardUid: gs.pendingSpellCardUid,
          targetUid,
        });
        gs.pendingSpellCardUid = null;
        gs.selectedCardUid = null;
        gs.pendingGeneratorCardUid = null;
        gs.phase = 'main';
        _renderFn();
      }
    });
  });

  appEl.querySelector('.game-root')?.addEventListener('click', () => {
    if (gs.phase !== 'main') {
      gs.phase = 'main';
      gs.selectedAttackerUid = null;
      gs.selectedCardUid = null;
      gs.pendingSpellCardUid = null;
      gs.pendingGeneratorCardUid = null;
      _renderFn();
    }
  });
}
