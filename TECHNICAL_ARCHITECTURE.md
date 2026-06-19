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

### Next recommended phase

**Phase 3: Creature sim placement & sim-primary damage**

1. Assign `simX/simY` to creatures when played (placement prompt like generators).
2. Render creature entities on the sim canvas.
3. Link CORE cell destruction to `base.hp` — count remaining CORE cells, make that authoritative.
4. Add core destruction as a win/loss condition (replace generator-based).
5. Introduce a replay format: write `getCommandLog()` to `localStorage`; add `?replay=` loader.
6. Add a `WALL` particle type (card-placed structures that block projectiles).
