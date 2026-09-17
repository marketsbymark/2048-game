// Rule-conformance tests for engine.js. Run:  node test.js
'use strict';
const assert = require('assert');
const Game = require('./engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.message || e)); process.exitCode = 1; }
}
function afterMove(grid, dir) {
  const g = Game.fromGrid(grid);
  const res = g.move(dir);
  // strip the spawned tile so we can compare the deterministic part
  if (res.spawned) { const gr = g.grid(); gr[res.spawned.r][res.spawned.c] = 0; return { grid: gr, res, game: g }; }
  return { grid: g.grid(), res, game: g };
}
const row = (a, b, c, d) => [[a, b, c, d], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];

console.log('2048 engine tests');

test('starts with two tiles of value 2 or 4 and score 0', () => {
  for (let i = 0; i < 50; i++) {
    const g = new Game();
    assert.strictEqual(g.tiles.length, 2);
    g.tiles.forEach(t => assert.ok(t.value === 2 || t.value === 4));
    assert.strictEqual(g.score, 0);
    assert.strictEqual(g.over, false);
  }
});

test('spawn distribution ~90% twos, 10% fours', () => {
  const g = new Game({ seed: 42, startTiles: 0 });
  let twos = 0, n = 20000;
  for (let i = 0; i < n; i++) { const t = g.spawn(); if (t.value === 2) twos++; g._removeTile(t); }
  const p = twos / n;
  assert.ok(p > 0.88 && p < 0.92, 'p(2)=' + p);
});

test('spawn cell is uniform over empty cells (matches original: random empty cell)', () => {
  const g = Game.fromGrid(row(2, 4, 8, 16)); // 12 empty cells
  const counts = {}; const n = 24000;
  for (let i = 0; i < n; i++) { const t = g.spawn(); counts[t.r + ',' + t.c] = (counts[t.r + ',' + t.c] || 0) + 1; g._removeTile(t); }
  assert.strictEqual(Object.keys(counts).length, 12);
  Object.values(counts).forEach(k => assert.ok(Math.abs(k / n - 1 / 12) < 0.012, 'cell freq ' + k / n));
  assert.ok(!counts['0,0'] && !counts['0,3'], 'never spawns on an occupied cell');
});

test('unseeded games use Math.random and still obey the 90/10 rule', () => {
  const g = new Game({ startTiles: 0 });
  let twos = 0, n = 20000;
  for (let i = 0; i < n; i++) { const t = g.spawn(); if (t.value === 2) twos++; else assert.strictEqual(t.value, 4); g._removeTile(t); }
  assert.ok(twos / n > 0.88 && twos / n < 0.92, 'p(2)=' + twos / n);
});

test('slides tiles all the way with no merge', () => {
  assert.deepStrictEqual(afterMove(row(0, 2, 0, 4), 'left').grid[0], [2, 4, 0, 0]);
  assert.deepStrictEqual(afterMove(row(0, 2, 0, 4), 'right').grid[0], [0, 0, 2, 4]);
});

test('merges a pair and scores the merged value', () => {
  const { grid, res } = afterMove(row(2, 2, 0, 0), 'left');
  assert.deepStrictEqual(grid[0], [4, 0, 0, 0]);
  assert.strictEqual(res.gained, 4);
  assert.strictEqual(res.score, 4);
});

test('[2,2,2,2] left -> [4,4] (a merged tile cannot merge again)', () => {
  const { grid, res } = afterMove(row(2, 2, 2, 2), 'left');
  assert.deepStrictEqual(grid[0], [4, 4, 0, 0]);
  assert.strictEqual(res.gained, 8);
});

test('[2,2,4] left -> [4,4], not [8]', () => {
  assert.deepStrictEqual(afterMove(row(2, 2, 4, 0), 'left').grid[0], [4, 4, 0, 0]);
});

test('[2,2,2] left -> [4,2] and right -> [2,4] (merge priority toward the move edge)', () => {
  assert.deepStrictEqual(afterMove(row(2, 2, 2, 0), 'left').grid[0], [4, 2, 0, 0]);
  assert.deepStrictEqual(afterMove(row(0, 2, 2, 2), 'right').grid[0], [0, 0, 2, 4]);
});

test('[4,2,2,4] left -> [4,4,4]', () => {
  assert.deepStrictEqual(afterMove(row(4, 2, 2, 4), 'left').grid[0], [4, 4, 4, 0]);
});

test('tiles separated by gaps merge: [2,0,0,2] left -> [4]', () => {
  assert.deepStrictEqual(afterMove(row(2, 0, 0, 2), 'left').grid[0], [4, 0, 0, 0]);
});

test('vertical moves work on columns', () => {
  const g = Game.fromGrid([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0]]);
  const res = g.move('down');
  const gr = g.grid(); gr[res.spawned.r][res.spawned.c] = 0;
  assert.deepStrictEqual(gr.map(r => r[0]), [0, 0, 4, 4]);
  const g2 = Game.fromGrid([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0]]);
  const res2 = g2.move('up');
  const gr2 = g2.grid(); gr2[res2.spawned.r][res2.spawned.c] = 0;
  assert.deepStrictEqual(gr2.map(r => r[0]), [4, 4, 0, 0]);
});

test('a move that changes nothing is rejected: no spawn, no score, no move count', () => {
  const g = Game.fromGrid(row(2, 4, 8, 16));
  const res = g.move('left');
  assert.strictEqual(res.moved, false);
  assert.strictEqual(res.spawned, null);
  assert.strictEqual(g.tiles.length, 4);
  assert.strictEqual(g.moves, 0);
});

test('exactly one tile spawns after a valid move', () => {
  const g = Game.fromGrid(row(2, 0, 0, 0));
  g.move('right');
  assert.strictEqual(g.tiles.length, 2);
  assert.strictEqual(g.moves, 1);
});

test('legalMoves reports only directions that change the board', () => {
  assert.deepStrictEqual(Game.fromGrid(row(2, 4, 8, 16)).legalMoves(), ['down']);
  const full = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
  assert.deepStrictEqual(Game.fromGrid(full).legalMoves(), []);
  const g = Game.fromGrid([[2, 8, 8, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
  assert.deepStrictEqual(g.legalMoves().sort(), ['left', 'right']);
});

test('game over when the board is full and no merges exist', () => {
  const g = Game.fromGrid([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
  assert.strictEqual(g.over, true);
  assert.strictEqual(g.isTerminal(), true);
  assert.strictEqual(g.move('left').moved, false);
});

test('a full board with an available merge is NOT game over', () => {
  const g = Game.fromGrid([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]]);
  assert.strictEqual(g.over, false);
});

test('winning: creating 2048 sets won, blocks input until continueAfterWin', () => {
  const g = Game.fromGrid(row(1024, 1024, 0, 0));
  const res = g.move('left');
  assert.strictEqual(res.won, true);
  assert.strictEqual(g.won, true);
  assert.strictEqual(g.isTerminal(), true);
  assert.strictEqual(g.move('down').moved, false);
  g.continueAfterWin();
  assert.strictEqual(g.isTerminal(), false);
  assert.strictEqual(g.maxTile(), 2048);
});

test('move result describes animations: from/to, merges, spawn', () => {
  const g = Game.fromGrid(row(2, 0, 2, 0));
  const ids = g.tiles.map(t => t.id);
  const res = g.move('left');
  assert.strictEqual(res.merged.length, 1);
  assert.deepStrictEqual(res.merged[0].from.sort(), ids.sort());
  const mover = res.tiles.find(t => t.from.c === 2);
  assert.deepStrictEqual(mover.to, { r: 0, c: 0 });
  assert.strictEqual(mover.mergedInto, res.merged[0].id);
  assert.ok(res.spawned && res.spawned.id);
});

test('seeded games are reproducible and serialize/load round-trips', () => {
  const a = new Game({ seed: 7 }), b = new Game({ seed: 7 });
  const dirs = ['left', 'up', 'right', 'down'];
  for (let i = 0; i < 200 && !a.isTerminal(); i++) { a.move(dirs[i % 4]); b.move(dirs[i % 4]); }
  assert.deepStrictEqual(a.grid(), b.grid());
  assert.strictEqual(a.score, b.score);
  const c = Game.fromState(a.serialize());
  assert.deepStrictEqual(c.grid(), a.grid());
  c.move('left'); a.move('left');
  assert.deepStrictEqual(c.grid(), a.grid(), 'RNG state survives serialization');
});

test('random playout never violates invariants (1000 games)', () => {
  for (let s = 1; s <= 1000; s++) {
    const g = new Game({ seed: s });
    let expectedScore = 0;
    while (!g.isTerminal()) {
      if (g.won) g.continueAfterWin();
      const legal = g.legalMoves();
      assert.ok(legal.length > 0, 'not terminal but no legal moves');
      const before = g.tiles.length;
      const res = g.move(legal[Math.floor(g.rng.next() * legal.length)]);
      assert.strictEqual(res.moved, true, 'legal move must move');
      expectedScore += res.gained;
      assert.strictEqual(g.score, expectedScore);
      assert.strictEqual(g.tiles.length, before - res.merged.length + 1, 'tile count bookkeeping');
      // cells and tiles agree
      g.tiles.forEach(t => assert.strictEqual(g.cells[t.r][t.c], t));
      let count = 0; g.cells.forEach(r => r.forEach(x => { if (x) count++; }));
      assert.strictEqual(count, g.tiles.length);
      g.tiles.forEach(t => assert.ok(t.value >= 2 && (t.value & (t.value - 1)) === 0, 'powers of two only'));
    }
    assert.ok(g.over || g.won);
    if (g.over) assert.strictEqual(g.legalMoves().length, 0);
  }
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
