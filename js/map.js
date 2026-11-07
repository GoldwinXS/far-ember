// Ember Squad: the battle grid. Map generation, line of sight, cover and pathfinding.
import { makeRng } from './data.js';

// cover: 1 half, 2 full. los: blocks line of sight. hp: destroyed by blasts. boom: explodes with this radius.
export const OBJ = {
  wall: { cover: 2, los: true },
  window: { cover: 1 },
  crate: { cover: 1, hp: true },
  lowwall: { cover: 1, hp: true },
  fence: { cover: 1, hp: true },
  hedge: { cover: 1, hp: true },
  car: { cover: 1, hp: true, boom: 1.6 },
  tractor: { cover: 1, hp: true, boom: 1.6 },
  barrel: { cover: 1, hp: true, boom: 1.6 },
  tree: { cover: 1, hp: true },
  rock: { cover: 1 },
  hay: { cover: 1, hp: true },
  container: { cover: 2, los: true },
  barrier: { cover: 1, hp: true },
  pillar: { cover: 2, los: true },
  shard: { cover: 1, hp: true },
  spire: { cover: 2, los: true },
};

export const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.5], [1, -1, 1.5], [-1, 1, 1.5], [-1, -1, 1.5]];

export class GameMap {
  constructor(w, h, biome) {
    this.w = w;
    this.h = h;
    this.biome = biome;
    this.ground = new Array(w * h).fill('grass');
    this.road = new Uint8Array(w * h); // 1 = runs along x, 2 = along y, 3 = crossing
    this.obj = new Array(w * h).fill(null);
    this.objects = [];
    this.decor = []; // purely visual: lintels, painted lines, outside props
    this.buildings = [];
    this.peekCache = new Map();
  }
  idx(x, y) { return y * this.w + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  objAt(x, y) { return this.inside(x, y) ? this.obj[this.idx(x, y)] : null; }
  free(x, y) { return this.inside(x, y) && !this.obj[this.idx(x, y)]; }
  place(type, tiles, extra = {}) {
    for (const [x, y] of tiles) if (!this.free(x, y)) return null;
    const o = { id: this.objects.length, type, tiles, ...extra };
    this.objects.push(o);
    for (const [x, y] of tiles) this.obj[this.idx(x, y)] = o;
    return o;
  }
  remove(o) {
    if (o.gone) return;
    o.gone = true;
    for (const [x, y] of o.tiles) if (this.obj[this.idx(x, y)] === o) this.obj[this.idx(x, y)] = null;
  }
  blocksLOS(x, y) {
    if (!this.inside(x, y)) return true;
    const o = this.obj[this.idx(x, y)];
    return !!(o && OBJ[o.type].los);
  }
  coverVal(x, y) {
    const o = this.objAt(x, y);
    return o ? OBJ[o.type].cover : 0;
  }

  // Line of sight between tile centres. Walls and containers block; low cover does not.
  clearLine(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const steps = Math.ceil(Math.hypot(dx, dy) * 4);
    let lx = ax, ly = ay;
    for (let i = 1; i < steps; i++) {
      const tx = Math.round(ax + (dx * i) / steps), ty = Math.round(ay + (dy * i) / steps);
      if (tx === lx && ty === ly) continue;
      if (!((tx === ax && ty === ay) || (tx === bx && ty === by)) && this.blocksLOS(tx, ty)) return false;
      if (tx !== lx && ty !== ly && this.blocksLOS(lx, ty) && this.blocksLOS(tx, ly)) return false;
      lx = tx; ly = ty;
    }
    return true;
  }
  // Tiles a unit standing here can lean out to (only next to a wall corner).
  peeks(x, y) {
    const k = this.idx(x, y);
    let p = this.peekCache.get(k);
    if (p) return p;
    p = [];
    if (DIR4.some(([dx, dy]) => this.blocksLOS(x + dx, y + dy))) {
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (this.inside(nx, ny) && !this.blocksLOS(nx, ny)) p.push([nx, ny]);
      }
    }
    this.peekCache.set(k, p);
    return p;
  }
  canSee(ax, ay, bx, by, range) {
    if (Math.hypot(bx - ax, by - ay) > range) return false;
    if (this.clearLine(ax, ay, bx, by)) return true;
    for (const [px, py] of this.peeks(ax, ay)) if (this.clearLine(px, py, bx, by)) return true;
    for (const [px, py] of this.peeks(bx, by)) if (this.clearLine(ax, ay, px, py)) return true;
    return false;
  }
  // Best cover a unit at (tx,ty) gets against a shooter at (sx,sy). 0 means flanked.
  coverFrom(tx, ty, sx, sy) {
    let best = 0;
    const vx = sx - tx, vy = sy - ty;
    for (const [dx, dy] of DIR4) {
      const c = this.coverVal(tx + dx, ty + dy);
      if (!c) continue;
      const along = vx * dx + vy * dy;
      const perp = Math.abs(vx * dy - vy * dx);
      if (along > 0 && along >= perp * 0.5) best = Math.max(best, c);
    }
    return best;
  }
  coverDirs(x, y) {
    const out = [];
    for (const [dx, dy] of DIR4) {
      const c = this.coverVal(x + dx, y + dy);
      if (c) out.push({ dx, dy, c });
    }
    return out;
  }
}

// Dijkstra over 8 directions, no corner cutting. pass(x,y) says if a unit may cross a tile.
export function reach(m, sx, sy, maxCost, pass) {
  const n = m.w * m.h;
  const cost = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const start = m.idx(sx, sy);
  cost[start] = 0;
  const heap = [[0, start]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  while (heap.length) {
    const [c, k] = pop();
    if (c > cost[k]) continue;
    const x = k % m.w, y = (k / m.w) | 0;
    for (const [dx, dy, w] of DIR8) {
      const nx = x + dx, ny = y + dy;
      if (!m.inside(nx, ny) || !pass(nx, ny)) continue;
      if (dx && dy && (!pass(x + dx, y) || !pass(x, y + dy))) continue;
      const nc = c + w;
      const nk = m.idx(nx, ny);
      if (nc <= maxCost && nc < cost[nk]) {
        cost[nk] = nc;
        prev[nk] = k;
        push([nc, nk]);
      }
    }
  }
  return { cost, prev };
}

export function pathTo(m, r, x, y) {
  const out = [];
  let k = m.idx(x, y);
  if (r.cost[k] === Infinity) return null;
  while (k !== -1) {
    out.push([k % m.w, (k / m.w) | 0]);
    k = r.prev[k];
  }
  return out.reverse();
}

// ---------------------------------------------------------------- generation

function building(m, rng, x0, y0, w, h, style, doorSides) {
  m.buildings.push({ x0, y0, w, h, style, tall: (style === 'brick' || style === 'plaster' || style === 'blue') && rng.chance(0.45) });
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) if (m.obj[m.idx(x, y)]) m.remove(m.obj[m.idx(x, y)]);
  const sides = { n: [], s: [], w: [], e: [] };
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1;
      m.ground[m.idx(x, y)] = style === 'barn' ? 'planks' : style === 'shed' ? 'concrete' : 'floor';
      if (!edge) continue;
      const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
      m.place('wall', [[x, y]], { style });
      if (!corner) {
        if (y === y0) sides.n.push([x, y]);
        else if (y === y0 + h - 1) sides.s.push([x, y]);
        else if (x === x0) sides.w.push([x, y]);
        else sides.e.push([x, y]);
      }
    }
  }
  const outward = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
  const used = new Set();
  for (const side of doorSides) {
    const list = sides[side];
    if (!list.length) continue;
    const [x, y] = list[Math.floor(list.length / 2) + rng.int(-1, 1) * (list.length > 3 ? 1 : 0)] || list[0];
    m.remove(m.objAt(x, y));
    used.add(x + ',' + y);
    m.decor.push({ type: 'lintel', x, y, style, axis: side === 'n' || side === 's' ? 'x' : 'y' });
    const [ox, oy] = outward[side];
    for (let i = 1; i <= 2; i++) {
      const o = m.objAt(x + ox * i, y + oy * i);
      if (o && o.type !== 'wall') m.remove(o);
    }
  }
  if (style !== 'barn') {
    for (const side of ['n', 's', 'w', 'e']) {
      const list = sides[side].filter(([x, y]) => !used.has(x + ',' + y));
      const count = list.length >= 4 ? 2 : list.length >= 2 ? 1 : 0;
      rng.shuffle(list);
      let made = 0;
      for (const [x, y] of list) {
        if (made >= count) break;
        if ([...used].some((u) => { const [ux, uy] = u.split(',').map(Number); return Math.abs(ux - x) + Math.abs(uy - y) < 2; })) continue;
        m.remove(m.objAt(x, y));
        m.place('window', [[x, y]], { style, axis: side === 'n' || side === 's' ? 'x' : 'y' });
        used.add(x + ',' + y);
        made++;
      }
    }
  }
  // a little furniture inside
  const inner = [];
  for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) inner.push([x, y]);
  rng.shuffle(inner);
  const furniture = Math.min(2, Math.floor(inner.length / 8));
  for (let i = 0, made = 0; i < inner.length && made < furniture; i++) {
    const [x, y] = inner[i];
    if (DIR4.some(([dx, dy]) => { const o = m.objAt(x + dx, y + dy); return o && o.type !== 'wall'; })) continue;
    const isDoor = (nx, ny) => (nx === x0 || nx === x0 + w - 1 || ny === y0 || ny === y0 + h - 1) && !m.objAt(nx, ny);
    if (DIR4.some(([dx, dy]) => isDoor(x + dx, y + dy))) continue;
    if (m.place(style === 'barn' ? 'hay' : 'crate', [[x, y]], { style: 'indoor' })) made++;
  }
}

function areaClear(m, x0, y0, w, h) {
  if (x0 < 0 || y0 < 0 || x0 + w > m.w || y0 + h > m.h) return false;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (m.obj[m.idx(x, y)]) return false;
  return true;
}

function scatter(m, rng, type, count, ok, extra) {
  let made = 0;
  for (let tries = 0; tries < count * 30 && made < count; tries++) {
    const x = rng.int(0, m.w - 1), y = rng.int(0, m.h - 1);
    if (!m.free(x, y) || !ok(x, y)) continue;
    if (m.place(type, [[x, y]], typeof extra === 'function' ? extra() : extra || {})) made++;
  }
  return made;
}

function line(m, type, x, y, dx, dy, len, gapEvery, extra) {
  for (let i = 0; i < len; i++) {
    if (gapEvery && i % gapEvery === gapEvery - 1) continue;
    const tx = x + dx * i, ty = y + dy * i;
    if (m.free(tx, ty)) m.place(type, [[tx, ty]], { axis: dx ? 'x' : 'y', ...(extra || {}) });
  }
}

function genTown(m, rng, spawnBox) {
  const W = m.w, H = m.h;
  const ry = rng.int(8, 10), rx = rng.int(8, 11);
  for (let x = 0; x < W; x++) {
    for (const y of [ry, ry + 1]) { m.ground[m.idx(x, y)] = 'road'; m.road[m.idx(x, y)] |= 1; }
    for (const y of [ry - 1, ry + 2]) if (m.ground[m.idx(x, y)] !== 'road') m.ground[m.idx(x, y)] = 'pave';
  }
  for (let y = 0; y < H; y++) {
    for (const x of [rx, rx + 1]) { m.ground[m.idx(x, y)] = 'road'; m.road[m.idx(x, y)] |= 2; }
    for (const x of [rx - 1, rx + 2]) if (m.ground[m.idx(x, y)] !== 'road') m.ground[m.idx(x, y)] = 'pave';
  }
  const lots = [
    [0, 0, rx - 1, ry - 1],
    [rx + 3, 0, W - rx - 3, ry - 1],
    [0, ry + 3, rx - 1, H - ry - 3],
    [rx + 3, ry + 3, W - rx - 3, H - ry - 3],
  ];
  const styles = ['brick', 'plaster', 'blue', 'brick'];
  rng.shuffle(styles);
  lots.forEach(([lx, ly, lw, lh], i) => {
    const bottom = ly > ry;
    const bw = Math.min(lw - 2, rng.int(5, 7)), bh = Math.min(lh - (bottom ? 5 : 2), rng.int(4, 6));
    if (bw < 4 || bh < 4) return;
    const bx = lx + rng.int(1, Math.max(1, lw - bw - 1));
    const by = bottom ? ly + 1 : ly + rng.int(1, Math.max(1, lh - bh - 1));
    const toRoadX = bx + bw / 2 < rx ? 'e' : 'w';
    const toRoadY = by + bh / 2 < ry ? 's' : 'n';
    building(m, rng, bx, by, bw, bh, styles[i], rng.chance(0.5) ? [toRoadX, toRoadY] : [toRoadY]);
    // garden wall, hedge or picket fence along one lot edge, with gaps to walk through
    const gy = by + bh + 1;
    if (gy < ly + lh - 1 && !bottom) line(m, rng.pick(['lowwall', 'hedge', 'fence']), lx + 1, gy, 1, 0, lw - 2, 4, { picket: true });
    else if (bottom) {
      const fx = bx + bw / 2 < rx ? lx + lw - 1 : lx;
      line(m, rng.chance(0.5) ? 'fence' : 'hedge', fx, ly + 1, 0, 1, Math.min(lh - 5, 5), 3, { picket: true });
    }
  });
  // cars along the roads
  let cars = 0;
  for (let tries = 0; tries < 80 && cars < 5; tries++) {
    if (rng.chance(0.5)) {
      const x = rng.int(1, W - 3), y = rng.pick([ry, ry + 1]);
      if (Math.abs(x - rx) < 3) continue;
      if (m.place('car', [[x, y], [x + 1, y]], { axis: 'x', color: rng.int(0, 5) })) cars++;
    } else {
      const x = rng.pick([rx, rx + 1]), y = rng.int(1, H - 6);
      if (Math.abs(y - ry) < 3) continue;
      if (m.place('car', [[x, y], [x, y + 1]], { axis: 'y', color: rng.int(0, 5) })) cars++;
    }
  }
  const grass = (x, y) => m.ground[m.idx(x, y)] === 'grass';
  const pave = (x, y) => m.ground[m.idx(x, y)] === 'pave';
  // sandbag walls thrown across the streets
  for (let i = 0; i < 3; i++) {
    const horiz = rng.chance(0.5);
    const x = horiz ? rx - 1 + rng.int(-1, 1) : rx + rng.int(-1, 2), y = horiz ? rng.int(2, ry - 3) : ry + rng.int(-1, 2);
    const tx = horiz ? rng.int(1, W - 4) : x, ty = horiz ? y : rng.int(2, H - 7);
    if (!nearSpawn(tx, ty, spawnBox, 2)) line(m, 'lowwall', tx, ty, horiz ? 1 : 0, horiz ? 0 : 1, 2, 0);
  }
  scatter(m, rng, 'tree', 10, (x, y) => grass(x, y) && !nearSpawn(x, y, spawnBox, 2), () => ({ kind: rng.int(0, 2) }));
  scatter(m, rng, 'crate', 7, (x, y) => (grass(x, y) || pave(x, y)) && !nearSpawn(x, y, spawnBox, 1));
  scatter(m, rng, 'barrel', 3, (x, y) => pave(x, y) && !nearSpawn(x, y, spawnBox, 3));
  scatter(m, rng, 'lowwall', 6, (x, y) => grass(x, y) && !nearSpawn(x, y, spawnBox, 1), () => ({ axis: rng.chance(0.5) ? 'x' : 'y' }));
  return { spawn: [rx, H - 1] };
}

function genFarm(m, rng, spawnBox) {
  const W = m.w, H = m.h;
  // a dirt track wandering up from the bottom
  let px = Math.floor(W / 2);
  for (let y = H - 1; y >= 0; y--) {
    if (y % 4 === 0) px = Math.max(3, Math.min(W - 4, px + rng.int(-1, 1)));
    m.ground[m.idx(px, y)] = 'dirt';
    m.ground[m.idx(px + 1, y)] = 'dirt';
  }
  // fields
  for (let i = 0; i < 3; i++) {
    const fw = rng.int(5, 7), fh = rng.int(4, 6);
    const fx = rng.int(0, W - fw), fy = rng.int(1, H - fh - 6);
    let ok = true;
    for (let y = fy; y < fy + fh && ok; y++) for (let x = fx; x < fx + fw; x++) if (m.ground[m.idx(x, y)] !== 'grass') ok = false;
    if (!ok) continue;
    for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) m.ground[m.idx(x, y)] = 'field';
    line(m, 'fence', fx, fy - 1, 1, 0, fw, 3);
    if (rng.chance(0.6)) line(m, 'fence', fx - 1, fy, 0, 1, fh, 3);
  }
  // barn and shed
  const left = px > W / 2;
  const bx = left ? rng.int(1, 3) : rng.int(W - 10, W - 8), by = rng.int(2, 5);
  building(m, rng, bx, by, 7, 6, 'barn', [left ? 'e' : 'w', 's']);
  const sx = left ? rng.int(W - 7, W - 6) : rng.int(1, 2), sy = rng.int(9, 12);
  building(m, rng, sx, sy, 4, 4, 'shed', [left ? 'w' : 'e']);
  // hay around the barn
  for (let i = 0; i < 6; i++) {
    const x = bx + rng.int(-1, 7), y = by + 6 + rng.int(0, 2);
    if (m.free(x, y) && m.ground[m.idx(x, y)] !== 'dirt') m.place('hay', [[x, y]]);
  }
  // tractor
  for (let t = 0; t < 30; t++) {
    const x = rng.int(2, W - 4), y = rng.int(3, H - 8);
    if (areaClear(m, x - 1, y - 1, 4, 3) && m.place('tractor', [[x, y], [x + 1, y]], { axis: 'x' })) break;
  }
  // stone walls
  for (let i = 0; i < 3; i++) {
    const horiz = rng.chance(0.6);
    const x = rng.int(1, W - 6), y = rng.int(2, H - 7);
    line(m, 'lowwall', x, y, horiz ? 1 : 0, horiz ? 0 : 1, rng.int(3, 5), 0, { stone: true });
  }
  const open = (x, y) => m.ground[m.idx(x, y)] === 'grass';
  // tree clumps
  for (let c = 0; c < 4; c++) {
    const cx = rng.int(1, W - 2), cy = rng.int(1, H - 8);
    for (let i = 0; i < 5; i++) {
      const x = cx + rng.int(-2, 2), y = cy + rng.int(-2, 2);
      if (m.inside(x, y) && m.free(x, y) && open(x, y) && rng.chance(0.6)) m.place('tree', [[x, y]], { kind: rng.int(0, 2) });
    }
  }
  scatter(m, rng, 'rock', 5, (x, y) => open(x, y) && !nearSpawn(x, y, spawnBox, 1));
  scatter(m, rng, 'tree', 4, (x, y) => open(x, y) && !nearSpawn(x, y, spawnBox, 2), () => ({ kind: rng.int(0, 2) }));
  return { spawn: [Math.floor(W / 2), H - 1] };
}

function genYard(m, rng, spawnBox) {
  const W = m.w, H = m.h;
  m.ground.fill('concrete');
  // warehouse
  const wl = rng.chance(0.5);
  const wx = wl ? 1 : W - 9, wy = rng.int(1, 3);
  building(m, rng, wx, wy, 8, 6, 'metal', [wl ? 'e' : 'w', 's']);
  // container rows
  for (const rowY of [3, 7, 11, 14]) {
    let x = rng.int(0, 3);
    while (x < W - 2) {
      const len = rng.int(2, 3);
      const vertical = rng.chance(0.25);
      const tiles = [];
      for (let i = 0; i < len; i++) tiles.push(vertical ? [x, rowY + i - 1] : [x + i, rowY]);
      if (tiles.every(([tx, ty]) => m.free(tx, ty) && ty < H - 6) && rng.chance(0.75)) {
        m.place('container', tiles, { axis: vertical ? 'y' : 'x', color: rng.int(0, 4) });
      }
      x += (vertical ? 1 : len) + rng.int(2, 4);
    }
  }
  for (let y = 0; y < H; y += 1) if (y % 5 === 2) m.decor.push({ type: 'paint', x: Math.floor(W / 2), y });
  const open = (x, y) => m.ground[m.idx(x, y)] === 'concrete';
  scatter(m, rng, 'crate', 12, (x, y) => open(x, y) && !nearSpawn(x, y, spawnBox, 1));
  scatter(m, rng, 'barrel', 5, (x, y) => open(x, y) && !nearSpawn(x, y, spawnBox, 3));
  for (let i = 0; i < 3; i++) {
    const horiz = rng.chance(0.5);
    line(m, 'barrier', rng.int(1, W - 5), rng.int(2, H - 7), horiz ? 1 : 0, horiz ? 0 : 1, rng.int(2, 4), 0);
  }
  return { spawn: [Math.floor(W / 2), H - 1] };
}

function genSpire(m, rng, spawnBox) {
  const W = m.w, H = m.h;
  m.ground.fill('alien');
  const cx = Math.floor(W / 2) - 1, cy = 4;
  m.place('spire', [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx - 0.5, y - cy - 0.5);
    if (d < 4) m.ground[m.idx(x, y)] = 'alienglow';
  }
  scatter(m, rng, 'pillar', 12, (x, y) => !nearSpawn(x, y, spawnBox, 3) && Math.hypot(x - cx, y - cy) > 3 &&
    !DIR4.some(([dx, dy]) => m.blocksLOS(x + dx, y + dy) && m.inside(x + dx, y + dy)));
  scatter(m, rng, 'shard', 26, (x, y) => !nearSpawn(x, y, spawnBox, 1) && Math.hypot(x - cx, y - cy) > 2.5);
  return { spawn: [Math.floor(W / 2), H - 1] };
}

function nearSpawn(x, y, box, pad) {
  return x >= box[0] - pad && x <= box[2] + pad && y >= box[1] - pad && y <= box[3] + pad;
}

function flood(m, sx, sy) {
  const seen = new Uint8Array(m.w * m.h);
  const q = [[sx, sy]];
  seen[m.idx(sx, sy)] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy;
      if (!m.inside(nx, ny) || seen[m.idx(nx, ny)] || m.obj[m.idx(nx, ny)]) continue;
      seen[m.idx(nx, ny)] = 1;
      q.push([nx, ny]);
    }
  }
  return seen;
}

// Build a mission map. Same seed always gives the same map (needed to resume saves).
export function generateMap(biome, seed, opts = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rng = makeRng(seed * 7919 + attempt * 104729 + 17);
    const size = biome === 'spire' ? 24 : 22;
    const m = new GameMap(size, size, biome);
    const cx = Math.floor(size / 2);
    const spawnBox = [cx - 3, size - 3, cx + 3, size - 1];
    const gen = { town: genTown, farm: genFarm, yard: genYard, spire: genSpire }[biome];
    const info = gen(m, rng, spawnBox);
    // a few bits of cover at the start line
    const [sx] = info.spawn;
    const sb = [sx - 3, size - 3, sx + 4, size - 1];
    for (let y = sb[1]; y <= sb[3]; y++) for (let x = sb[0]; x <= sb[2]; x++) { const o = m.objAt(x, y); if (o && o.type !== 'wall') m.remove(o); }
    const startCover = biome === 'spire' ? 'shard' : biome === 'farm' ? 'hay' : biome === 'yard' ? 'barrier' : 'crate';
    for (const dx of [-3, 0, 3]) {
      const x = sx + dx + rng.int(0, 1), y = size - 5;
      if (m.free(x, y)) m.place(startCover, [[x, y]], { axis: 'x' });
    }
    const spawnTiles = [];
    for (let y = size - 1; y >= size - 3; y--) for (let x = sx - 2; x <= sx + 3; x++) if (m.free(x, y)) spawnTiles.push([x, y]);
    spawnTiles.sort((a, b) => Math.abs(a[0] - sx - 0.5) + (size - 1 - a[1]) * 0.8 - (Math.abs(b[0] - sx - 0.5) + (size - 1 - b[1]) * 0.8));
    if (spawnTiles.length < 6) continue;
    const seen = flood(m, spawnTiles[0][0], spawnTiles[0][1]);
    const reachable = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (seen[m.idx(x, y)]) reachable.push([x, y]);
    const far = reachable.filter(([, y]) => y < size - 9);
    if (far.length < 40) continue;
    // cache and evac zone for "grab the cache" missions
    let cache = null, evac = null;
    if (opts.type === 'recover') {
      const spots = far.filter(([x, y]) => y < size * 0.4 && m.coverDirs(x, y).length > 0);
      if (!spots.length) continue;
      cache = rng.pick(spots);
      const side = cache[0] < size / 2 ? 1 : -1;
      const candidates = reachable.filter(([x, y]) => y > size - 8 && y < size - 1 && (side > 0 ? x > size * 0.6 : x < size * 0.4));
      rng.shuffle(candidates);
      for (const [x, y] of candidates) {
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!m.inside(x + dx, y + dy) || !seen[m.idx(x + dx, y + dy)]) ok = false;
        if (ok) { evac = [x, y]; break; }
      }
      if (!evac) continue;
    }
    if (opts.type === 'final') evac = null;
    // outside decoration ring
    const dr = makeRng(seed + 99);
    for (let i = 0; i < 70; i++) {
      const a = dr() * Math.PI * 2, r = size * 0.62 + dr() * size * 0.5;
      const x = size / 2 + Math.cos(a) * r, y = size / 2 + Math.sin(a) * r;
      if (x > -2 && x < size + 1 && y > -2 && y < size + 1) continue;
      m.decor.push({ type: 'outside', x, y, k: dr(), s: 0.7 + dr() * 0.8 });
    }
    return { map: m, spawnTiles, reachable: seen, far, cache, evac, attempt };
  }
  throw new Error('map generation failed');
}
