# 2048 — Mechanics and Training Report

Repository: https://github.com/marketsbymark/2048-game
Files covered: `engine.js`, `index.html`, `test.js`

This report documents the game exactly as built: its architecture, the rules it
implements, a financial framing useful for reasoning about policies, the
programmatic interface for training an agent, and the verification performed.

---

## 1. Architecture

The project is deliberately dependency-free. It has no build step, no framework,
no network access, and no storage beyond the browser's `localStorage`.

| File | Role |
|---|---|
| `engine.js` | The rules engine. Pure logic, no DOM. Exposed as `module.exports` in Node and `window.Game2048` in the browser (UMD wrapper). |
| `index.html` | The user interface. Loads `engine.js` with a plain `<script>` tag, renders the board, handles input and animation, persists state. |
| `test.js` | Rule-conformance tests for the engine, run with `node test.js`. |
| `serve.js` | Optional zero-dependency static server for local testing. |

### Engine / UI split

The engine owns all state: a `size × size` array of cell references, a flat list
of tile objects `{ id, value, r, c }`, the score, move counter, and the
`over` / `won` / `keepPlaying` flags. Every tile carries a stable numeric `id`,
which is what allows the UI to animate: the engine's `move()` returns, for every
tile that existed before the move, where it started and where it ended, which
tiles were created by merges and from which two source tiles, and which tile
spawned. The UI never re-derives any of this. It slides existing DOM elements to
their new positions over 100 ms, creates merged tiles with a "pop" animation and
the spawned tile with an "appear" animation (both delayed 100 ms so the slide
finishes first), and removes the two source elements of each merge.

Because the engine has no DOM dependency, the same file drives a headless
training loop in Node and the visible page in a browser. In the browser the live
instance is exposed as `window.game`, and `window.ui` wraps the animated actions.

### Randomness

The engine uses a seedable mulberry32 generator when a `seed` is supplied, and
`Math.random` otherwise. The generator's integer state is included in
`serialize()`, so a saved game resumes with the identical random sequence.

---

## 2. Exact mechanics

These rules were implemented from, and cross-checked against, Gabriele
Cirulli's original `game_manager.js` and `grid.js`.

### Board and setup

- The board is 4 × 4 (the engine accepts other sizes, but 4 is the game).
- A new game places **two** tiles using the normal spawn rule below.
- Score starts at 0.

### Spawn rule

After every **valid** move, exactly **one** new tile is added:

- Cell: chosen **uniformly at random among the currently empty cells**.
- Value: **2 with probability 0.9, 4 with probability 0.1**
  (the original's `Math.random() < 0.9 ? 2 : 4`).

No tile spawns after a rejected move.

### Slide-and-merge algorithm

A move has a direction: up, right, down or left. Tiles are processed **starting
from the edge they are moving toward**. Moving left, columns are visited
0 → 3; moving right, 3 → 0; moving up, rows 0 → 3; moving down, rows 3 → 0.
Lines (rows for horizontal moves, columns for vertical moves) are independent.

For each tile, in that order:

1. Walk in the move direction across empty cells to find the **farthest empty
   cell** it can reach, and look at the **next cell beyond it**.
2. If the next cell holds a tile of **equal value** that was **not itself
   produced by a merge during this move**, the two tiles **merge** into one
   tile of double value at that cell. The score increases by the new value.
3. Otherwise the tile simply moves to the farthest empty cell (which may be
   its own cell, meaning it did not move).

The "not produced by a merge this move" condition is the one rule players most
often get wrong. Its consequences, all verified by tests:

| Line (moving left) | Result | Why |
|---|---|---|
| `[2, 2, 2, 2]` | `[4, 4, _, _]` | first pair merges, second pair merges; the two 4s do **not** merge into 8 |
| `[2, 2, 4, _]` | `[4, 4, _, _]` | the new 4 is a merge product and cannot absorb the existing 4; **never** `[8]` |
| `[2, 2, 2, _]` | `[4, 2, _, _]` | the pair nearest the destination edge merges first; moving right gives `[_, _, 2, 4]` |
| `[4, 2, 2, 4]` | `[4, 4, 4, _]` | the two 2s merge; the resulting 4 cannot merge with either neighbour |
| `[2, _, _, 2]` | `[4, _, _, _]` | gaps are irrelevant; a tile slides then merges with whatever it hits |

### Valid and rejected moves

A move counts only if **at least one tile moved or merged**. A move that would
change nothing is rejected: no spawn, no score, no move-count increment, no
render. This is what forces the player to actually change the board each turn.

### Legal-move definition

A direction is legal if and only if some tile has, in that direction, an
adjacent **empty** cell or an adjacent tile of **equal value**. This is exactly
equivalent to "the move would change the board": an adjacent empty cell means
the tile slides; an adjacent equal tile means the first such pair encountered
merges. The engine's `canMove(dir)` and `legalMoves()` implement this test
without simulating the move.

### Scoring

The score increases by the **value of every tile created by a merge**. Merging
two 2s adds 4; a move that merges `[2,2,2,2]` into `[4,4]` adds 8. Sliding
without merging adds nothing. The best score is stored separately and updated
whenever the score exceeds it.

### Win

The first time a **2048** tile is created, `won` becomes true and the "You win!"
overlay appears. Input is blocked until the player chooses **Keep going** (which
sets `keepPlaying` and clears the overlay) or starts a new game. After keep
going, the win never re-triggers; tiles above 2048 render with the dark
"super" style.

### Game over

After a valid move and its spawn, the game is over if **no legal move remains**,
which is the same as: **no empty cell and no two adjacent equal tiles**. A full
board that still contains an adjacent equal pair is *not* over. The check runs
only after a successful move.

### Terminal state

`isTerminal()` is `over || (won && !keepPlaying)`. While terminal, `move()`
returns `{ moved: false }` and changes nothing.

---

## 3. A financial framing for reasoning about policies

The game is a small, fully observable, stochastic control problem, and several
of its quantities map cleanly onto finance vocabulary. The mapping is a thinking
aid for designing and evaluating policies, not part of the engine.

- **Score as realized return.** Score only increases when a merge is executed.
  Board value can sit unrealized in unmerged tiles; a merge realizes it.
- **Tile tiers as compounding.** Every tile is a power of two. Producing the
  next tier doubles the position and requires two equal positions to be
  brought together, so progress is geometric in value but linear in the number
  of merges required at each tier.
- **Empty cells as liquidity.** Empty cells are the only resource that keeps
  the player able to act. Every move consumes one cell (the spawn) and every
  merge frees one. A policy that runs out of empty cells has no room to
  manoeuvre, exactly as an illiquid book cannot rebalance.
- **Game over as absorbing ruin.** Once no legal move exists the state is
  absorbing: no further return can be earned. Policies should be evaluated on
  their tendency to avoid ruin, not only on their peak score.
- **Expected value added per move.** Merges do not change the total value on
  the board; only spawns add value. A spawn adds
  `0.9 × 2 + 0.1 × 4 = 2.2` on average. A 2048 tile requires the board to have
  accumulated at least 2048 in total value, so reaching it takes roughly
  `2048 / 2.2 ≈ 930` valid moves after the two starting tiles. This is a hard
  floor: no policy reaches 2048 materially faster, and a policy that survives
  fewer moves cannot reach it at all.
- **Seeded games as controlled experiments.** With a `seed`, the sequence of
  spawns is fixed, so two policies can be compared on identical random draws,
  and any single run can be replayed move for move. Unseeded games sample a
  fresh draw each time and are appropriate for measuring a policy's
  distribution of outcomes.

---

## 4. Training interface

`engine.js` is designed to be driven by a policy, whether a script, a
reinforcement-learning loop, or a language model choosing moves from a text
snapshot.

### Observing the state

```js
const Game = require('./engine.js');
const game = new Game({ seed: 42 });   // seed is optional
game.getState();
```

`getState()` returns:

| Field | Meaning |
|---|---|
| `grid` | 4 × 4 array of numbers, `0` for empty |
| `score` | current score |
| `moves` | number of valid moves made |
| `maxTile` | largest tile on the board |
| `legalMoves` | subset of `['up','right','down','left']` that would change the board |
| `won` | a 2048 tile has been created at some point |
| `over` | no legal move remains |
| `terminal` | the game accepts no further input (`over`, or `won` without keep going) |

`game.toString()` prints the grid as aligned text, convenient for prompting a
language model.

### Acting

```js
const r = game.move('left');   // also accepts 'up'/'right'/'down', 0–3, or w/a/s/d
```

`move()` returns:

| Field | Meaning |
|---|---|
| `moved` | `false` if the move was rejected (nothing changed) or the game is terminal |
| `dir` | the normalized direction |
| `gained` | score added by this move (sum of merged tile values) |
| `score` | score after the move |
| `tiles` | every pre-existing tile: `{ id, value, from:{r,c}, to:{r,c}, mergedInto }` |
| `merged` | tiles created by merges: `{ id, value, r, c, from:[idA, idB] }` |
| `spawned` | the new tile `{ id, value, r, c }`, or `null` |
| `won` | `true` only on the move that first creates 2048 |
| `over` | `true` if no legal move remains after this move |

To play past 2048, call `game.continueAfterWin()` when `game.won` is true.

### Reward

`gained` is the natural per-step reward: it is the game's own score delta,
non-negative, and sums to the final score. Suggested shaping, if a policy
learns slowly from score alone:

- **Survival bonus.** A small constant per valid move rewards staying out of
  the absorbing state.
- **Liquidity term.** Reward proportional to the number of empty cells after
  the move, or a penalty as the board fills.
- **Illegal-move penalty.** Choosing a direction that returns `moved: false`
  wastes a step; penalize it or restrict the action set to `legalMoves`.
- **Monotonicity or corner term.** A bonus when the largest tile sits in a
  corner and rows or columns are ordered, encoding the well-known human
  strategy.
- **Terminal signal.** A negative reward at `over`, and a bonus at the first
  `won`, to give the episode boundaries a clear value.

### Helpers for experiments

| Call | Use |
|---|---|
| `game.clone()` | independent copy for look-ahead search or Monte Carlo rollouts |
| `game.serialize()` / `Game.fromState(s)` | JSON-safe snapshot and restore, including RNG state |
| `Game.fromGrid(grid, { score })` | construct a specific position for tests or curriculum |
| `game.canMove(dir)` | test one direction without moving |
| `game.reset(seed)` | start a new episode, optionally reseeding |

### Browser hooks

`index.html` exposes the live engine as `window.game` and an animated wrapper as
`window.ui`:

- `ui.move(dir)` plays a move with animation and returns `true` if it was valid
- `ui.state()` returns `game.getState()`
- `ui.newGame()`, `ui.undo()`, `ui.keepGoing()`

An agent can therefore drive the visible page through a browser-automation tool
while a human watches.

---

## 5. Verification record

### Rules cross-check

The move algorithm, spawn rule, scoring, win, game-over and input handling were
compared line by line with the original 2048 source
(`js/game_manager.js`, `js/grid.js`, `js/keyboard_input_manager.js` from
github.com/gabrielecirulli/2048). The engine reproduces the original's
traversal order, farthest-position search, `mergedFrom` guard, single spawn per
valid move, `0.9 / 0.1` value split, and `over || (won && !keepPlaying)`
termination.

### Automated tests (`node test.js`, 21 passing)

| Area | Tests |
|---|---|
| Setup | two starting tiles of value 2 or 4, score 0, not over |
| Spawn probability | 20,000 seeded spawns fall within 88–92 % twos; 20,000 unseeded spawns likewise, and every non-2 is a 4 |
| Spawn placement | 24,000 spawns on a board with 12 empty cells land uniformly (each within ±1.2 points of 1/12) and never on an occupied cell |
| Sliding | tiles slide fully left and right without merging |
| Merging and score | a pair merges and scores its value |
| Merge guard | `[2,2,2,2]` → `[4,4]`; `[2,2,4]` → `[4,4]` not `[8]` |
| Merge priority | `[2,2,2]` left → `[4,2]`, right → `[2,4]`; `[4,2,2,4]` → `[4,4,4]` |
| Gaps | `[2,_,_,2]` → `[4]` |
| Vertical | columns merge correctly moving up and down |
| No-op moves | rejected: no spawn, no score, no move count |
| Single spawn | exactly one tile appears after a valid move |
| Legal moves | only board-changing directions are reported; a full checkerboard reports none; a board with one horizontal pair reports left and right only |
| Game over | full board with no merges is over and blocks input; full board with a merge is not over |
| Win | 1024 + 1024 sets `won`, blocks input, and `continueAfterWin()` unblocks it |
| Animation data | `move()` reports from/to, merge sources, and the spawned tile |
| Reproducibility | two games with the same seed and moves match exactly; serialize/load preserves RNG state across a subsequent move |
| Invariants | 1,000 seeded random playouts: every legal move moves, score equals the running sum of `gained`, tile count bookkeeping holds, cells and tile list agree, all values are powers of two, and a game reported over has no legal move |

### Browser checks (built-in browser, `serve.js` on port 5173)

- 60 scripted moves through `ui.move`: the number of tile elements in the DOM
  equalled the engine's tile count, and the saved state was written.
- A constructed board with exactly one remaining merge was played to game over:
  the "Game over!" overlay appeared, `legalMoves()` was empty, and further input
  was blocked.
- A constructed `[1024, 1024]` board produced the "You win!" overlay and blocked
  input; "Keep going" cleared it and re-enabled moves.
- No console errors at any point.
- Layout checked at phone width (375 px), a 640 px column and the desktop pane,
  in both light and dark colour schemes.

---

*Based on 2048 by Gabriele Cirulli, itself based on 1024 by Veewo Studio and
conceptually similar to Threes by Asher Vollmer.*
