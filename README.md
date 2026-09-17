# 2048

A faithful, portable, offline build of Gabriele Cirulli's 2048. No build step, no
dependencies, no network calls, nothing stored except `localStorage` on your own device.

## Play

- Double-click `index.html`, or run `node serve.js` and open http://localhost:5173.
- Arrow keys, WASD, or swipe. `Z` undoes a move. Score and best score persist across reloads.
- Share the folder (or just `index.html` + `engine.js`) and it runs anywhere.

## Rules (verified against the original source)

| Rule | Value |
|---|---|
| Board | 4 × 4, starts with 2 tiles |
| New tile after each valid move | one tile, on a uniformly random empty cell |
| New tile value | 2 with probability 0.9, 4 with probability 0.1 |
| Merge | equal tiles that collide become one tile of double value; a tile made by a merge cannot merge again in the same move |
| Merge order | resolved from the edge the tiles move toward: `[2,2,2,_]` left → `[4,2]`, `[2,2,4]` left → `[4,4]` |
| Valid move | at least one tile must move or merge, otherwise nothing happens |
| Score | plus the value of every tile created by a merge |
| Win | first 2048 tile; "Keep going" continues past it |
| Game over | no empty cell and no adjacent equal tiles |

Run the rule tests with:

```bash
node test.js
```

## Driving the game from code (LLM / RL training)

`engine.js` is pure logic with no DOM, usable from Node or the browser.

```js
const Game = require('./engine.js');
const game = new Game({ seed: 42 });          // seed is optional; omit for Math.random
while (!game.isTerminal()) {
  if (game.won) game.continueAfterWin();       // play past 2048
  const s = game.getState();                   // { grid, score, moves, maxTile, legalMoves, won, over, terminal }
  const dir = s.legalMoves[0];                 // your policy goes here: 'up' | 'right' | 'down' | 'left'
  const r = game.move(dir);                    // { moved, gained, score, merged, spawned, won, over, ... }
  const reward = r.gained;                     // score delta is the natural reward signal
}
console.log(game.score, game.maxTile());
```

Useful extras: `game.clone()`, `game.serialize()` / `Game.fromState()`, `Game.fromGrid(grid)`,
`game.canMove(dir)`, `game.toString()`. Seeded games are fully reproducible.

In the browser the same instance is exposed as `window.game`, and `window.ui.move('left')`
plays a move with animation, so an agent can drive the visible page too
(`ui.state()`, `ui.newGame()`, `ui.undo()`, `ui.keepGoing()`).

## Files

- `index.html` – the game UI (single page, loads `engine.js`)
- `engine.js` – rules engine, UMD (browser + Node)
- `test.js` – 21 rule-conformance tests
- `serve.js` – optional zero-dependency static server for local testing
