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

### Next recommended phase

**Phase 4: Creature movement & sim-authority attacks**

1. Each creature walks toward the enemy base each tick (deterministic step logic).
2. `attackTarget` spawns element particles toward the target's sim position instead of directly subtracting HP.
3. Add a `WALL` particle type for card-placed structures.
4. Write `getCommandLog()` to `localStorage` on game end; add a `?replay=` loader.
