# Deckadent — Technical Architecture

## Phase 1 + Phase 2: Deterministic Foundation (completed)

---

### Ownership diagram

```
GameState
├── initialSeed: number          — replay/debug anchor
├── prng: PRNGState              — gameplay PRNG (shuffles, draw order)
├── tick: number                 — authoritative fixed-step clock
├── turn / phase / status        — card-game authority
├── player: PlayerState
│   ├── deck / hand / discard
│   ├── generators[] / creatures[]
│   └── base: BaseInstance       — physical base in sim coordinates
├── enemy: PlayerState  (same)
└── sim: SimState                — owns the full particle simulation
    ├── width / height
    ├── grid: SimParticle[]      — flat row-major particle array
    └── prng: PRNGState          — sim PRNG (particle physics)
```

`GameState` is the single authoritative serializable root. Everything inside it
can be JSON-stringified to produce a complete snapshot for replay or lockstep.

---

### Seeded PRNG (`src/game/prng.ts`)

Mulberry32 — fast, seedable, uint32, no `Math.random`.

Two independent PRNG streams:
- **`gs.prng`** — gameplay PRNG. Deck shuffles, card draw order. Seeded from `initialSeed`.
- **`gs.sim.prng`** — sim PRNG. All particle physics (falling direction, fire spread, spark ignition, smoke drift, particle spawning lifetimes). Seeded from `initialSeed + 1`.

`Math.random` survives **only** in `renderSim` for the fire/spark visual flicker jitter, explicitly labeled `// VISUAL-ONLY`.

---

### Fixed-step accumulator (`src/main.ts`)

```
requestAnimationFrame  → rendering (display refresh rate)
fixed tick accumulator → updateSim(gs.sim) + resolveSimDamage(gs)
```

Each frame:
1. `dt = min(elapsed, 200ms)` — caps dt to prevent tick storms after tab switch.
2. Accumulator drains in `FIXED_DT = 33.3ms` chunks (30 ticks/sec), up to `MAX_TICKS_PER_FRAME = 5`.
3. Each tick: `gs.tick++`, `updateSim(gs.sim)`, `resolveSimDamage(gs)`.
4. After all ticks: `renderSim`, `renderGeneratorStructures`, `renderBaseStructures`.

`gs.tick` is the authoritative simulation clock. Wall-clock time drives rendering only.

---

### SimState owns the simulation (`src/game/sandSim.ts`)

All module-level mutable simulation state has been removed. Every function takes `SimState` explicitly:

```typescript
createSimState(seed: number): SimState
addParticle(sim, x, y, type): void
updateSim(sim): void
renderSim(ctx, sim): void
simRand(sim): number            // convenience wrapper for nextFloat(sim.prng)
```

A module-level `_movedScratch: Uint8Array` is the only module-level mutable variable remaining. It is a per-tick scratch buffer for the "moved" flags used by the cellular automaton step. It is **not game state** — it is reset at the start of every `updateSim` call and never serialized.

`CORE` is a new particle type: static, never falls, rendered teal. Core cells are placed at game init by `state.ts` and represent the physical base/core structures.

---

### Command model (`src/game/commands.ts`)

All gameplay mutations go through `applyCommand(gs, cmd)`:

| Kind           | Owner validated? | Notes                                    |
|----------------|:---------------:|------------------------------------------|
| `playCard`     | ✓               | validates target before any mutation     |
| `attackTarget` | ✓               |                                          |
| `endTurn`      | ✓               |                                          |
| `selectTarget` | —               | UI coordination, no state mutation       |

Validation checks:
- `gs.status === 'playing'`
- `cmd.owner === gs.turn` (for turn-sensitive commands)
- Rules-level validity (energy, hand membership, target existence)

Accepted commands go to `_commandLog` (the future replay record).
Rejected commands go to `_rejectedLog` (accessible via `getRejectedLog()`).

Commands that fail rules validation are never pushed to the authoritative log.

---

### AI routes through commands (`src/game/ai.ts`)

`runEnemyTurn` computes AI actions as `Command` objects and calls `applyCommand`.
The AI command log is unified with the player command log — both appear in `getCommandLog()`.
Visual timing delays (setTimeout) are purely presentational and do not affect command contents.

---

### State hash (`src/game/stateHash.ts`)

`hashHex(gs)` — djb2 over all authoritative state:
- `initialSeed`, `gs.prng.seed`, `gs.sim.prng.seed`
- `tick`, `turn`, `status`, `phase`
- Per player: energy, base hp/position, full deck/hand/discard (uid+defId in order), all units (uid, defId, hp, hasAttacked, simX, simY)
- Sim grid: particle type for every cell + lifetime for every non-EMPTY cell (row-major)

Excluded: UI selection state, `aiActing`, combat log strings, visual-only data.

Displayed in the UI header. Changes every tick (particle aging is authoritative).

---

### Physical base/core scaffolding

- `BaseInstance` (in `types.ts`): `owner`, `hp`, `maxHp`, `simX`, `simY`.
- Player base: sim center (160, 164). Enemy base: (160, 16).
- 13 CORE cells (diamond cluster) placed at each base position at game init.
- `renderBaseStructures` draws a pixelated fortress outline around each base.
  The interior is intentionally empty — CORE cells rendered by `renderSim` show through.
- `base.hp` is reduced by fire/spark contact via `resolveSimDamage`.

---

### Particle-overlap damage (`src/game/simDamage.ts`)

Runs every 30 ticks (~1 second). Uses `gs.sim.prng` for all random decisions.

- Units with `simX/simY`: if any FIRE/SPARK cell is within radius 6, ~35% chance of 1 HP damage.
- Bases: if any FIRE/SPARK within radius 6, ~25% chance of 1 HP damage to `base.hp`.

This is scaffolding for the simulation-authority damage model described in
`DESIGN_GUIDELINES.md §Cards as Physical Actions`. Direct HP subtraction from card plays
and attacks (in `rules.ts`) remains the primary damage source.

---

### Current limitations

- **No networking.** Hotseat only. Commands are logged in memory and lost on reload.
- **Generator win/loss still primary.** `base.hp` reaches 0 but does not end the game yet.
  TODO in `rules.ts:checkWinLoss` and `simDamage.ts`.
- **No replay file.** Command log is in-memory. A future pass should write it to `localStorage`
  on game end and add a replay loader.
- **Creatures have no sim position by default.** Only generators and explicitly placed units
  have `simX/simY`. Particle damage cannot reach creatures without sim coordinates.
- **CORE cells not yet linked to `base.hp` per-cell.** `base.hp` is decremented by the
  damage resolver; the sim CORE cells are visual and don't drive the HP counter yet.

---

---

## Phase 3: Creature Placement, Battlefield Bodies & Core Authority (completed)

---

### Creature placement

- `TurnPhase` now includes `'placing-creature'`.
- `GameState` has a `pendingCreatureCardUid` field parallel to `pendingGeneratorCardUid`.
- When the player clicks a CREATURE card, the UI enters the `placing-creature` phase and shows a prompt to click the lower battlefield half.
- On canvas click, a `playCard` command is issued with `placement: { x, y }`.
- `playCard` in `rules.ts` requires `placement` for all CREATURE cards; plays without it are rejected.
- Placement is validated in both `commands.ts` (bounds + side check) and `rules.ts` (side guard with rejection).
- Enemy AI assigns deterministic creature placement in the upper half (`y: 32..72`).

### Creature sim positions

- All creatures are given `simX/simY` from placement at play time.
- The state hash already covers `simX/simY` per unit — no hash changes needed.

### Battlefield creature renderer (`src/game/battlefieldEntities.ts`)

- `renderCreatureEntities(ctx, gs)` — called from the main loop after `renderBaseStructures`.
- Each creature type has a distinct pixel-art body:
  - **Emberling**: fire-orange body with flame tips.
  - **Water Wisp**: blue circular orb with inner glow.
  - **Stone Mite**: grey stone-shelled crawler with glowing eyes.
- A tiny HP bar is drawn above enemy creatures and below player creatures.
- DOM unit cards in the sidebar remain for readability; the canvas body is the spatial reference.

### Core cell authority (`src/game/state.ts`, `src/game/simDamage.ts`)

- `base.maxHp` is now 13 (matching the 13 CORE cells in the initial diamond).
- `countCoreCells(sim, base)` counts CORE cells within radius 5 of the base center.
- `resolveSimDamage` calls `erodeCoreCells` each 30-tick cycle: CORE cells adjacent to FIRE/SPARK have a 4% chance of being removed from the grid.
- After CORE erosion, `syncBaseHp` sets `base.hp = countCoreCells(...)` for each base.
- The HP bar on the fortress now reflects actual remaining CORE cells.

### Core-based win/loss

- `checkWinLoss` in `rules.ts` now checks CORE cell counts, not generator counts.
- If the player's core integrity reaches 0 → `status = 'lose'`.
- If the enemy's core integrity reaches 0 → `status = 'win'`.
- Win/loss overlay messages updated accordingly.

### Particle damage improvements

- WATER element creatures take much lower fire damage (8% vs 35%) — water resists fire.
- Combat log entries for particle damage are throttled to one entry per unit per 3 seconds.
- CORE cell erosion by fire is now the primary path to reducing base HP.

### Reduced direct damage

- Creature `playCard` no longer places creatures without sim positions — all creatures are physical.
- Spell and attack direct HP damage remains as a temporary fallback for the abstract card combat layer.
- TODO (sim-authority): route card attacks through sim particles so all damage resolves physically.

### Strengthened command validation

- `commands.ts` validates placement bounds (`[0, SIM_W) × [0, SIM_H)`).
- Player creatures must be in the lower half (`y ≥ 90`); enemy in the upper half (`y < 90`).
- Rejected commands record the reason in `_rejectedLog`.

---

### Current limitations (Phase 3)

- **No creature movement.** Creatures stay at their placed position; they don't walk or chase.
- **No creature–creature collision.** Multiple creatures can occupy the same cell.
- **Creature attacks still abstract.** `attackTarget` subtracts HP directly; no sim particles are spawned. TODO: spawn element-specific particles from attacker toward target.
- **CORE erosion is slow by design.** Low probability (4%) keeps early games playable. May need tuning once creatures spawn fire reliably near the enemy base.
- **No replay file.** Command log is in-memory.
- **No networking.** Hotseat only.

---

---

## Phase 4: Sim-Authority Attacks & CombatEffect System (completed)

---

### CombatEffect system (`src/game/combatEffects.ts`, `src/game/types.ts`)

- `CombatEffect` is a serializable authoritative record stored in `gs.combatEffects[]`.
- Fields: `id`, `owner`, `element`, `effectKind` (`beam|spray|burst`), `sourcePos`, `targetPos`, `startTick`, `durationTicks`.
- Positions are captured at enqueue time — deterministic even if source/target moves or dies.
- `enqueueEffect(gs, owner, element, sourcePos, targetPos)` adds an effect.
- `updateCombatEffects(gs)` runs every tick (before `updateSim`), spawning a slice of particles per effect:
  - **beam** (WATER, 10 ticks): 3 water particles along the line + splash at target per tick.
  - **spray** (FIRE, 8 ticks): 4 fire/spark scattered toward target per tick.
  - **burst** (EARTH, 6 ticks): 8→5→2 sand particles dropped above target, tapering.
- Effects expire and are removed when `durationTicks` is exhausted.
- `combatEffects` is included in `stateHash.ts`.

### Sim-authority attacks and spells (`src/game/rules.ts`)

- `attackTarget` no longer subtracts HP directly. It marks `hasAttacked = true` and calls `enqueueEffect`.
- `playCard` (SPELL) no longer subtracts HP. It spends energy, discards, and calls `enqueueEffect`.
- Combat log reads: `"Emberling fires spray toward enemy base."` not `"for N damage."`
- All damage now resolves through `simDamage.ts` via particle contact.
- `elementToEffectKind` maps: FIRE→spray, WATER→beam, EARTH→burst, NEUTRAL→spray.

### Base targeting (`src/game/commands.ts`, `src/game/rules.ts`, `src/game/ui.ts`, `src/game/ai.ts`)

- `attackTarget` command now accepts `targetBase?: Owner` (mutually exclusive with `targetUid`).
- `playCard` command accepts `targetBase?: Owner` for spells targeting a base.
- Validation: `targetBase` must be the opponent's base; cannot target own base.
- UI shows an "⚔ Enemy Base" button in the enemy zone during targeting phases.
- Player base HP shown in both player and enemy zones for reference.
- AI falls back to `targetBase: 'player'` when no unit targets are available.

### Footprint helpers (`src/game/footprint.ts`)

- Centralises all radius constants and footprint geometry.
- `getUnitFootprint(unit)` → `{ cx, cy, radius: 5 }` or `null` if no sim position.
- `getBaseFootprint(base)` → `{ cx, cy, radius: 5 }`.
- `countParticlesInFootprint(sim, fp, types)` — used by `simDamage.ts`.
- `CORE_RADIUS = 3` — tighter radius for per-CORE-cell erosion checks.

### Expanded simDamage (`src/game/simDamage.ts`)

- Uses footprint helpers exclusively — no scattered radius constants.
- FIRE/SPARK damage: FIRE element (40%), WATER resists (8%), EARTH partial resist (20%).
- SAND damage: chips at non-EARTH units (10%); EARTH units shrug it off (4%).
- CORE erosion and `syncBaseHp` unchanged from Phase 3.

### Command validation additions (`src/game/commands.ts`)

- Generator placement validated for side (same half-field rule as creatures).
- `attackTarget` must have exactly one of `targetUid` / `targetBase`.
- `targetBase` must be opponent's base — own base attacks rejected with reason.
- Rejected placement commands no longer clear the placement UI (fix in `ui.ts`).

---

### Current limitations (Phase 4)

- **No creature movement.** Creatures stay at placed position. TODO: per-tick deterministic drift.
- **No WALL particle.** Card-placed structures deferred to Phase 5.
- **No replay file.** Command log is in-memory only.
- **No networking.** Hotseat only.
- **CORE erosion rate is conservative.** Tuning may be needed after creature movement is added.

---

---

## Phase 5: Deterministic Replay Foundation & Creature Movement (completed)

---

### Determinism gap fixes

#### GameState-owned effect ID counter (`src/game/types.ts`, `src/game/state.ts`)

- `GameState.nextEffectId: number` replaces the old module-level `_effectId` counter in `state.ts`.
- `newEffectId(gs)` takes `gs` and increments `gs.nextEffectId`.
- `gs.nextEffectId` is included in the state hash — desync from divergent effect ID sequences is now detectable.
- `CombatEffect.owner` is now included in the state hash (it was previously hashed without the owner field).

#### UID counter reset for replay (`src/game/state.ts`)

- `resetUidCounter()` resets the module-level `_uid` counter to 0.
- `createInitialGameState()` calls `resetUidCounter()` internally so every fresh game assigns UIDs from 1 in the same order.
- This makes replay verification produce identical UIDs without requiring `nextUid` to be moved into `GameState`.

---

### Command tick validation (`src/game/commands.ts`)

- `validate(gs, cmd, skipTickCheck)` rejects turn-sensitive commands where `cmd.tick !== gs.tick`.
- Commands issued by the UI and AI always carry `tick: gs.tick` at creation time, so live play is unaffected.
- `applyCommand(gs, cmd, skipTickCheck = false)` exposes `skipTickCheck` for the replay runner: the runner advances `gs.tick` to `cmd.tick` before applying each command, then passes `skipTickCheck = true`.
- Rejected commands record the reason in `_rejectedLog` as before.

#### Tick policy

For local hotseat:
- Accepted only when `cmd.tick === gs.tick` at the moment `applyCommand` is called.
- AI commands are constructed with `tick: gs.tick` in `computeNextAICommand`, so they always pass.
- Player UI commands are constructed with `tick: gs.tick` at event time, so they always pass.

For replay:
- The replay runner fast-forwards the sim to `cmd.tick`, then applies with `skipTickCheck = true`.
- This means the same command log is valid both live and in replay without tick-renumbering.

---

### Generator placement requirement (`src/game/rules.ts`)

- `playCard` for `GENERATOR` now requires a `placement` field (same as `CREATURE`).
- Placement is validated for side: player generators must be in the lower half (`y >= SIM_H/2`); enemy in the upper half (`y < SIM_H/2`).
- Missing or side-invalid generator placement returns `false` without mutating state.
- Starting generators are placed directly via `makePlayerState` in `state.ts` — they bypass `playCard` so this requirement does not affect game initialization.
- AI generator placement already included `placement` coordinates — no AI changes needed.

---

### Deterministic creature movement (`src/game/movement.ts`)

`updateCreatureMovement(gs)` is called once per fixed tick (between `updateCombatEffects` and `updateSim`).

#### Movement rules

- Player creatures march upward (`simY--`) toward the enemy base.
- Enemy creatures march downward (`simY++`) toward the player base.
- Movement uses modular arithmetic on `gs.tick` — no floating-point accumulator.

#### Speed table

| Creature    | Element | Ticks per pixel step |
|-------------|---------|----------------------|
| Emberling   | FIRE    | 3 (fast)             |
| Water Wisp  | WATER   | 4 (medium / glides)  |
| Stone Mite  | EARTH   | 6 (slow)             |
| fallback    | NEUTRAL | 5                    |

#### Boundaries

- Player creatures clamp at `simY >= 4`.
- Enemy creatures clamp at `simY <= SIM_H - 5`.
- Creatures do not clamp in X during normal movement.

#### Collision separation

After all movement, a deterministic separation pass prevents stacking:
- O(n²) over same-team creature pairs within Chebyshev radius 8.
- Overlapping pair: the unit whose UID string sorts earlier moves left (x−1); the other moves right (x+1).
- UID string comparison is deterministic across machines and sessions.
- Both units are clamped to `[0, SIM_W - 1]`.

Because `simX/simY` are already in the state hash, movement and separation are automatically hashed.

---

### Attack range validation (`src/game/rules.ts`)

- `attackTarget` rejects attacks where the Chebyshev distance between attacker and target exceeds `MAX_ATTACK_RANGE = 160`.
- Uses integer Chebyshev distance (`max(|dx|, |dy|)`) — no floating-point.
- Creatures must advance toward the enemy before their attacks become valid.
- AI already selects targets by UID without range awareness; because AI creatures move like player creatures, they will naturally be in range when they attack.

---

### Replay / localStorage (`src/game/replay.ts`)

#### Format (version `deckadent-replay-v1`)

```typescript
interface ReplayRecord {
  version: string;      // schema version tag
  timestamp: number;    // Unix ms — cosmetic only
  initialSeed: number;  // passed to createInitialGameState
  commands: Command[];  // full accepted command log in order
  finalHash: string;    // hashHex(gs) at game end
  outcome: string;      // 'win' | 'lose'
}
```

Stored under `localStorage['deckadent-latest-replay']`.

#### Save

`saveReplay(gs)` is called once in `main.ts` when `gs.status` transitions out of `'playing'`.

#### Load & verify

`loadLatestReplay()` retrieves and version-checks the record.

`verifyReplay(record)` re-simulates from scratch:
1. `resetUidCounter()` then `createInitialGameState(initialSeed)`.
2. For each command, fast-forward `gs.tick` to `cmd.tick`, then `applyCommand(gs, cmd, skipTickCheck=true)`.
3. Compare `hashHex(gs)` to `record.finalHash`.

To run verification: open the game with `?replay=latest` in the URL. Results are logged to the browser console.

---

### Dev/debug panel (`src/main.ts`)

A compact one-liner overlaid at the bottom of the battle canvas (always visible).

Displays:
- `seed` — initial seed in hex
- `tick` — current `gs.tick`
- `hash` — current `hashHex(gs)` (8 hex chars)
- `fx` — active `gs.combatEffects.length`
- `cmds` — accepted / rejected command counts

Updated each frame after each tick batch completes.

---

### Current limitations (Phase 5)

- **No WALL particle.** Card-placed structures that block projectiles are deferred.
- **No networking.** Hotseat only. Commands are logged to localStorage (replay) but not sent over the network.
- **Single replay slot.** `localStorage` holds only the latest game. A replay history requires a different storage model.
- **UID counter is module-level.** `_uid` in `state.ts` is reset by `createInitialGameState`, which means running two game instances in the same JS context (e.g., iframe) would share the counter. Acceptable for the current single-page hotseat model.
- **CORE erosion rate is conservative.** May need tuning now that creatures advance across the field.
- **No creature–creature collision between teams.** Creatures from opposite teams can still pass through each other.
