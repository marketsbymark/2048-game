/*
 * 2048 engine — pure game logic, no DOM.
 * Works in the browser (window.Game2048) and in Node (module.exports).
 *
 * Rules implemented exactly as in Gabriele Cirulli's original 2048:
 *  - 4x4 board, two starting tiles.
 *  - A move slides every tile as far as it can go in one direction.
 *  - Two equal tiles that collide merge into one tile of double value.
 *  - A tile that was produced by a merge cannot merge again in the same move.
 *  - Merges resolve starting from the edge the tiles move toward
 *    ([2,2,2,2] -> [4,4],  [2,2,4] left -> [4,4], not [8]).
 *  - A move only counts if at least one tile moved or merged.
 *  - After every valid move one new tile spawns on a random empty cell:
 *    value 2 with probability 0.9, value 4 with probability 0.1.
 *  - Score increases by the value of every merged tile created.
 *  - You win when a 2048 tile appears (you may keep playing afterwards).
 *  - The game is over when no empty cell exists and no adjacent equal tiles exist.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Game2048 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRECTIONS = ['up', 'right', 'down', 'left'];
  var VECTORS = {
    up: { r: -1, c: 0 },
    right: { r: 0, c: 1 },
    down: { r: 1, c: 0 },
    left: { r: 0, c: -1 }
  };

  // Seedable deterministic RNG (mulberry32). Falls back to Math.random when no seed.
  function makeRng(seed) {
    if (seed === undefined || seed === null) {
      return { next: Math.random, state: function () { return null; }, setState: function () {} };
    }
    var s = (seed >>> 0) || 0x9e3779b9;
    return {
      next: function () {
        s = (s + 0x6d2b79f5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      state: function () { return s; },
      setState: function (v) { s = v >>> 0; }
    };
  }

  function normalizeDir(dir) {
    if (typeof dir === 'number') return DIRECTIONS[((dir % 4) + 4) % 4];
    if (typeof dir === 'string') {
      var d = dir.toLowerCase();
      if (VECTORS[d]) return d;
      var map = { w: 'up', a: 'left', s: 'down', d: 'right', u: 'up', l: 'left', r: 'right', k: 'up', h: 'left', j: 'down' };
      if (map[d]) return map[d];
    }
    throw new Error('Invalid direction: ' + dir);
  }

  function Game(options) {
    options = options || {};
    this.size = options.size || 4;
    this.startTiles = options.startTiles == null ? 2 : options.startTiles;
    this.winValue = options.winValue || 2048;
    this.rng = makeRng(options.seed);
    this.seed = options.seed == null ? null : options.seed;
    this.reset();
  }

  Game.DIRECTIONS = DIRECTIONS;

  Game.prototype.reset = function (seed) {
    if (seed !== undefined) {
      this.seed = seed;
      this.rng = makeRng(seed);
    }
    this.cells = [];
    for (var r = 0; r < this.size; r++) {
      this.cells.push([]);
      for (var c = 0; c < this.size; c++) this.cells[r].push(null);
    }
    this.tiles = [];
    this.nextId = 1;
    this.score = 0;
    this.moves = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;
    this.lastResult = null;
    for (var i = 0; i < this.startTiles; i++) this.spawn();
    return this;
  };

  // ---- Queries ------------------------------------------------------------

  Game.prototype.grid = function () {
    var g = [];
    for (var r = 0; r < this.size; r++) {
      g.push([]);
      for (var c = 0; c < this.size; c++) g[r].push(this.cells[r][c] ? this.cells[r][c].value : 0);
    }
    return g;
  };

  Game.prototype.emptyCells = function () {
    var out = [];
    for (var r = 0; r < this.size; r++)
      for (var c = 0; c < this.size; c++) if (!this.cells[r][c]) out.push({ r: r, c: c });
    return out;
  };

  Game.prototype.maxTile = function () {
    var m = 0;
    for (var i = 0; i < this.tiles.length; i++) if (this.tiles[i].value > m) m = this.tiles[i].value;
    return m;
  };

  Game.prototype.inBounds = function (r, c) {
    return r >= 0 && c >= 0 && r < this.size && c < this.size;
  };

  // A direction is legal iff some tile has, in that direction, an adjacent
  // empty cell or an adjacent tile of equal value.
  Game.prototype.canMove = function (dir) {
    var v = VECTORS[normalizeDir(dir)];
    for (var i = 0; i < this.tiles.length; i++) {
      var t = this.tiles[i];
      var nr = t.r + v.r, nc = t.c + v.c;
      if (!this.inBounds(nr, nc)) continue;
      var n = this.cells[nr][nc];
      if (!n || n.value === t.value) return true;
    }
    return false;
  };

  Game.prototype.legalMoves = function () {
    var out = [];
    for (var i = 0; i < DIRECTIONS.length; i++) if (this.canMove(DIRECTIONS[i])) out.push(DIRECTIONS[i]);
    return out;
  };

  Game.prototype.movesAvailable = function () {
    return this.legalMoves().length > 0;
  };

  // True when the game accepts no further input: lost, or won without "keep going".
  Game.prototype.isTerminal = function () {
    return this.over || (this.won && !this.keepPlaying);
  };

  Game.prototype.continueAfterWin = function () {
    if (this.won) this.keepPlaying = true;
    return this;
  };

  // ---- Mutation -----------------------------------------------------------

  Game.prototype.spawn = function () {
    var empty = this.emptyCells();
    if (!empty.length) return null;
    var cell = empty[Math.floor(this.rng.next() * empty.length)];
    var value = this.rng.next() < 0.9 ? 2 : 4;
    var tile = { id: this.nextId++, value: value, r: cell.r, c: cell.c };
    this.cells[cell.r][cell.c] = tile;
    this.tiles.push(tile);
    return tile;
  };

  Game.prototype._removeTile = function (tile) {
    if (this.cells[tile.r][tile.c] === tile) this.cells[tile.r][tile.c] = null;
    var i = this.tiles.indexOf(tile);
    if (i >= 0) this.tiles.splice(i, 1);
  };

  /**
   * Apply a move. Returns a result describing what happened so a renderer can
   * animate it:
   * {
   *   moved: boolean, dir, gained: number, score: number,
   *   tiles:   [{ id, value, from:{r,c}, to:{r,c}, mergedInto: id|null }], // every tile that existed before the move
   *   merged:  [{ id, value, r, c, from:[idA, idB] }],                      // tiles created by merges
   *   spawned: { id, value, r, c } | null,
   *   won: boolean (first time 2048 was reached this move), over: boolean
   * }
   */
  Game.prototype.move = function (dir) {
    var d = normalizeDir(dir);
    var result = { moved: false, dir: d, gained: 0, score: this.score, tiles: [], merged: [], spawned: null, won: false, over: this.over };
    if (this.isTerminal()) return result;

    var v = VECTORS[d];
    var rows = [], cols = [], i;
    for (i = 0; i < this.size; i++) { rows.push(i); cols.push(i); }
    if (v.r === 1) rows.reverse();
    if (v.c === 1) cols.reverse();

    var before = {};
    for (i = 0; i < this.tiles.length; i++) {
      var t0 = this.tiles[i];
      before[t0.id] = { id: t0.id, value: t0.value, from: { r: t0.r, c: t0.c }, to: { r: t0.r, c: t0.c }, mergedInto: null };
    }

    var mergedThisMove = {};
    var gained = 0;
    var moved = false;
    var self = this;

    rows.forEach(function (r) {
      cols.forEach(function (c) {
        var tile = self.cells[r][c];
        if (!tile) return;
        // Find farthest empty cell and the cell just beyond it.
        var fr = r, fc = c, nr = r + v.r, nc = c + v.c;
        while (self.inBounds(nr, nc) && !self.cells[nr][nc]) { fr = nr; fc = nc; nr += v.r; nc += v.c; }
        var next = self.inBounds(nr, nc) ? self.cells[nr][nc] : null;

        if (next && next.value === tile.value && !mergedThisMove[next.id]) {
          var merged = { id: self.nextId++, value: tile.value * 2, r: next.r, c: next.c };
          self._removeTile(tile);
          self._removeTile(next);
          self.cells[merged.r][merged.c] = merged;
          self.tiles.push(merged);
          mergedThisMove[merged.id] = true;
          before[tile.id].to = { r: merged.r, c: merged.c };
          before[tile.id].mergedInto = merged.id;
          before[next.id].mergedInto = merged.id;
          result.merged.push({ id: merged.id, value: merged.value, r: merged.r, c: merged.c, from: [next.id, tile.id] });
          gained += merged.value;
          moved = true;
          if (merged.value >= self.winValue && !self.won) { self.won = true; result.won = true; }
        } else if (fr !== r || fc !== c) {
          self.cells[r][c] = null;
          tile.r = fr; tile.c = fc;
          self.cells[fr][fc] = tile;
          before[tile.id].to = { r: fr, c: fc };
          moved = true;
        }
      });
    });

    for (var id in before) result.tiles.push(before[id]);
    if (!moved) return result;

    this.score += gained;
    this.moves++;
    result.moved = true;
    result.gained = gained;
    result.score = this.score;
    result.spawned = this.spawn();
    if (!this.movesAvailable()) this.over = true;
    result.over = this.over;
    this.lastResult = result;
    return result;
  };

  // ---- Serialization (for undo, persistence, and training loops) ----------

  Game.prototype.serialize = function () {
    return {
      size: this.size,
      winValue: this.winValue,
      score: this.score,
      moves: this.moves,
      over: this.over,
      won: this.won,
      keepPlaying: this.keepPlaying,
      nextId: this.nextId,
      seed: this.seed,
      rngState: this.rng.state(),
      tiles: this.tiles.map(function (t) { return { id: t.id, value: t.value, r: t.r, c: t.c }; })
    };
  };

  Game.prototype.load = function (state) {
    this.size = state.size || 4;
    this.winValue = state.winValue || 2048;
    this.cells = [];
    for (var r = 0; r < this.size; r++) {
      this.cells.push([]);
      for (var c = 0; c < this.size; c++) this.cells[r].push(null);
    }
    this.tiles = [];
    var self = this;
    (state.tiles || []).forEach(function (t) {
      var tile = { id: t.id, value: t.value, r: t.r, c: t.c };
      self.cells[tile.r][tile.c] = tile;
      self.tiles.push(tile);
    });
    this.score = state.score || 0;
    this.moves = state.moves || 0;
    this.over = !!state.over;
    this.won = !!state.won;
    this.keepPlaying = !!state.keepPlaying;
    this.nextId = state.nextId || (this.tiles.length + 1);
    if (state.seed != null) {
      this.seed = state.seed;
      this.rng = makeRng(state.seed);
      if (state.rngState != null) this.rng.setState(state.rngState);
    }
    this.lastResult = null;
    return this;
  };

  Game.fromState = function (state) {
    var g = new Game({ size: state.size, startTiles: 0, winValue: state.winValue, seed: state.seed });
    return g.load(state);
  };

  // Build a game from a plain number grid (0 = empty). Handy for tests / agents.
  Game.fromGrid = function (grid, options) {
    options = options || {};
    var g = new Game({ size: grid.length, startTiles: 0, winValue: options.winValue, seed: options.seed });
    for (var r = 0; r < grid.length; r++)
      for (var c = 0; c < grid.length; c++)
        if (grid[r][c]) {
          var t = { id: g.nextId++, value: grid[r][c], r: r, c: c };
          g.cells[r][c] = t; g.tiles.push(t);
        }
    g.score = options.score || 0;
    if (!g.movesAvailable()) g.over = true;
    if (g.maxTile() >= g.winValue) { g.won = true; g.keepPlaying = true; }
    return g;
  };

  Game.prototype.clone = function () {
    return Game.fromState(this.serialize());
  };

  // Compact snapshot for an agent / LLM: everything needed to pick a move.
  Game.prototype.getState = function () {
    return {
      grid: this.grid(),
      score: this.score,
      moves: this.moves,
      maxTile: this.maxTile(),
      legalMoves: this.legalMoves(),
      won: this.won,
      over: this.over,
      terminal: this.isTerminal()
    };
  };

  Game.prototype.toString = function () {
    return this.grid().map(function (row) {
      return row.map(function (v) { return (v || '.').toString().padStart(5); }).join('');
    }).join('\n');
  };

  return Game;
});
