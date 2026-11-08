'use strict';

const T = 32;
const N = 20;
const START_MONEY = 5000;
const ENTRANCE = { x: 10, y: 19 };
const DAY_SECONDS = 20;
const MAX_VISITORS = 20;
const WALK_SPEED = 42;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const TYPES = {
  path:     { name: 'Path',           cost: 10,   w: 1, h: 1 },
  carousel: { name: 'Carousel',       cost: 500,  w: 2, h: 2, fee: 15, upkeep: 20, attraction: true },
  ferris:   { name: 'Ferris Wheel',   cost: 1200, w: 2, h: 2, fee: 30, upkeep: 45, attraction: true },
  coaster:  { name: 'Roller Coaster', cost: 2500, w: 4, h: 3, fee: 60, upkeep: 90, attraction: true },
  food:     { name: 'Food Stand',     cost: 300,  w: 1, h: 1, fee: 8,  upkeep: 10 },
  tree:     { name: 'Tree',           cost: 50,   w: 1, h: 1 },
};

const fmt = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const $ = id => document.getElementById(id);

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1600);
}

class ParkScene extends Phaser.Scene {
  constructor() { super('park'); }

  create() {
    this.tool = 'path';
    this.drawGrass();
    this.pathGfx = this.add.graphics().setDepth(1);
    this.preview = this.add.graphics().setDepth(5000);
    this.previewText = this.add.text(0, 0, '', {
      fontFamily: 'Trebuchet MS', fontSize: '12px', fontStyle: 'bold', color: '#ffffff', stroke: '#23324a', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(5001);
    this.clouds = [0, 1, 2].map(i => this.add.graphics({ x: i * 240, y: 80 + i * 190 }).setDepth(4000)
      .fillStyle(0x23324a, 0.05).fillEllipse(0, 0, 150, 60).fillEllipse(50, -15, 90, 50).fillEllipse(-45, 10, 80, 40));
    this.newGame();

    this.input.on('pointermove', p => {
      this.hover = this.tileAt(p);
      if (p.isDown && (this.tool === 'path' || this.tool === 'bulldoze')) this.applyTool();
    });
    this.input.on('pointerdown', p => { this.hover = this.tileAt(p); this.applyTool(); });
    this.input.on('pointerout', () => { this.hover = null; });
    buildMenu(this);
    window.__scene = this;
  }

  tileAt(p) {
    const x = Math.floor(p.worldX / T), y = Math.floor(p.worldY / T);
    return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
  }

  drawGrass() {
    const g = this.add.graphics().setDepth(0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      g.fillStyle((x + y) % 2 ? 0x7fd35b : 0x76cb52).fillRect(x * T, y * T, T, T);
      const r = (x * 7 + y * 13) % 5;
      if (r === 0) g.fillStyle(0x69b947).fillRect(x * T + 8, y * T + 12, 2, 5).fillRect(x * T + 12, y * T + 10, 2, 7);
      if (r === 3) g.fillStyle(0xfff27a).fillCircle(x * T + 22, y * T + 22, 2);
    }
    g.lineStyle(4, 0x5aa83d).strokeRect(2, 2, N * T - 4, N * T - 4);
  }

  // ---------- state ----------
  newGame(data) {
    if (this.buildings) this.buildings.forEach(b => b.view.destroy());
    if (this.gate) this.gate.destroy();
    this.grid = Array.from({ length: N }, () => Array(N).fill(null));
    this.buildings = [];
    this.nextId = 1;
    this.money = START_MONEY;
    this.day = 1;
    this.dayTimer = 0;
    this.spawnTimer = 0;
    this.totalVisitors = 0;
    this.speed = 1;
    if (this.visitors) this.visitors.forEach(v => v.view.destroy());
    this.visitors = [];

    this.grid[ENTRANCE.y][ENTRANCE.x - 1] = 'gate';
    this.grid[ENTRANCE.y][ENTRANCE.x + 1] = 'gate';
    this.grid[ENTRANCE.y][ENTRANCE.x] = 'path';
    this.gate = this.drawGate();

    if (data) {
      this.money = data.money; this.day = data.day; this.totalVisitors = data.totalVisitors || 0;
      data.paths.forEach(([x, y]) => { this.grid[y][x] = 'path'; });
      data.buildings.forEach(([type, x, y]) => this.addBuilding(type, x, y));
    } else {
      for (let y = 15; y < 19; y++) this.grid[y][ENTRANCE.x] = 'path';
    }
    this.gridChanged();
  }

  canPlace(type, x, y) {
    const t = TYPES[type];
    if (x < 0 || y < 0 || x + t.w > N || y + t.h > N) return false;
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) if (this.grid[y + j][x + i] !== null) return false;
    return true;
  }

  applyTool() {
    const h = this.hover;
    if (!h) return;
    if (this.tool === 'bulldoze') return this.bulldoze(h.x, h.y);
    const t = TYPES[this.tool];
    if (!this.canPlace(this.tool, h.x, h.y)) return;
    if (this.money < t.cost) { toast('Not enough money!'); return; }
    this.money -= t.cost;
    if (this.tool === 'path') this.grid[h.y][h.x] = 'path';
    else this.addBuilding(this.tool, h.x, h.y, true);
    this.gridChanged();
    this.floatText(h.x * T + t.w * T / 2, h.y * T, '-' + fmt(t.cost), '#ffdd57');
    this.updateUI();
  }

  bulldoze(x, y) {
    const c = this.grid[y][x];
    if (c === null || c === 'gate' || (x === ENTRANCE.x && y === ENTRANCE.y)) return;
    let refund;
    if (c === 'path') { this.grid[y][x] = null; refund = TYPES.path.cost / 2; }
    else {
      const b = this.buildings.find(b => b.id === c);
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.grid[b.y + j][b.x + i] = null;
      b.view.destroy();
      this.buildings = this.buildings.filter(o => o !== b);
      refund = TYPES[b.type].cost / 2;
    }
    this.money += refund;
    this.gridChanged();
    this.floatText(x * T + T / 2, y * T, '+' + fmt(refund), '#9dff8a');
    this.updateUI();
  }

  addBuilding(type, x, y, animate) {
    const t = TYPES[type];
    const b = { id: this.nextId++, type, x, y, w: t.w, h: t.h, phase: Math.random() * 6 };
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) this.grid[y + j][x + i] = b.id;
    b.view = this.drawBuilding(b);
    this.buildings.push(b);
    if (animate) {
      const puff = this.add.graphics({ x: x * T + t.w * T / 2, y: y * T + t.h * T / 2 }).setDepth(5500);
      puff.fillStyle(0xffffff, 0.8);
      for (let i = 0; i < 8; i++) puff.fillCircle(Math.cos(i * 0.785) * t.w * 12, Math.sin(i * 0.785) * t.h * 12, 6);
      this.tweens.add({ targets: puff, scale: 1.6, alpha: 0, duration: 500, onComplete: () => puff.destroy() });
      b.view.setScale(0.3);
      this.tweens.add({ targets: b.view, scale: 1, duration: 350, ease: 'Back.easeOut' });
    }
    return b;
  }

  floatText(x, y, str, color) {
    const txt = this.add.text(x, y, str, {
      fontFamily: 'Trebuchet MS', fontSize: '15px', fontStyle: 'bold', color, stroke: '#23324a', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(6000);
    this.tweens.add({ targets: txt, y: y - 30, alpha: 0, duration: 900, onComplete: () => txt.destroy() });
  }

  // ---------- simulation ----------
  isPath(x, y) { return x >= 0 && y >= 0 && x < N && y < N && this.grid[y][x] === 'path'; }

  gridChanged() {
    this.redrawPaths();
    const seen = new Set([ENTRANCE.x + ',' + ENTRANCE.y]);
    const queue = [ENTRANCE];
    while (queue.length) {
      const c = queue.shift();
      for (const [dx, dy] of DIRS) {
        const nx = c.x + dx, ny = c.y + dy, k = nx + ',' + ny;
        if (!seen.has(k) && this.isPath(nx, ny)) { seen.add(k); queue.push({ x: nx, y: ny }); }
      }
    }
    for (const b of this.buildings) {
      b.access = [];
      for (let j = -1; j <= b.h; j++) for (let i = -1; i <= b.w; i++) {
        const edge = (i === -1 || i === b.w) !== (j === -1 || j === b.h);
        const x = b.x + i, y = b.y + j;
        if (edge && seen.has(x + ',' + y)) b.access.push({ x, y });
      }
    }
    const open = this.buildings.filter(b => b.access.length);
    const attractions = open.filter(b => TYPES[b.type].attraction).length;
    const food = open.filter(b => b.type === 'food').length;
    const trees = this.buildings.filter(b => b.type === 'tree').length;
    const variety = new Set(open.filter(b => TYPES[b.type].attraction).map(b => b.type)).size;
    this.rating = Math.min(100, Math.min(45, attractions * 12) + variety * 5 + Math.min(20, food * 10) + Math.min(20, trees * 2));
    this.updateUI();
  }

  findPath(from, goals) {
    const key = p => p.x + ',' + p.y;
    const goalSet = new Set(goals.map(key));
    const prev = new Map([[key(from), null]]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift();
      if (goalSet.has(key(c))) {
        const path = [];
        for (let p = c; p; p = prev.get(key(p))) path.unshift(p);
        return path;
      }
      for (const [dx, dy] of DIRS) {
        const n = { x: c.x + dx, y: c.y + dy };
        if (!prev.has(key(n)) && this.isPath(n.x, n.y)) { prev.set(key(n), c); queue.push(n); }
      }
    }
    return null;
  }

  spawnVisitor() {
    const v = {
      tile: { ...ENTRANCE }, px: ENTRANCE.x * T + T / 2, py: ENTRANCE.y * T + T - 2,
      ox: Math.random() * 12 - 6, oy: Math.random() * 10 - 5,
      visitsLeft: 2 + Math.floor(Math.random() * 3), state: 'walk', path: [], phase: Math.random() * 6,
    };
    const g = this.add.graphics();
    const shirt = Phaser.Utils.Array.GetRandom([0xe2456f, 0x4aa3df, 0xf4b942, 0x8e5ad6, 0x4fc16b, 0xff8c42]);
    const skin = Phaser.Utils.Array.GetRandom([0xffd9b3, 0xe8b48a, 0xb5794d, 0x8a5a32]);
    g.fillStyle(0x000000, 0.2).fillEllipse(0, 1, 9, 4);
    g.fillStyle(0x3a4a66).fillRect(-3, -4, 2, 5).fillRect(1, -4, 2, 5);
    const body = this.add.graphics();
    body.fillStyle(shirt).fillRoundedRect(-4, -11, 8, 8, 2);
    body.fillStyle(skin).fillCircle(0, -14, 3.5);
    v.legs = g; v.body = body;
    v.view = this.add.container(v.px, v.py, [g, body]);
    this.visitors.push(v);
    this.totalVisitors++;
    this.chooseTarget(v);
  }

  chooseTarget(v) {
    const open = this.buildings.filter(b => b.access && b.access.length && TYPES[b.type].fee && b !== v.last);
    if (v.visitsLeft > 0 && open.length) {
      const b = Phaser.Utils.Array.GetRandom(open);
      const path = this.findPath(v.tile, b.access);
      if (path) { v.target = b; v.path = path.slice(1); v.state = 'walk'; return; }
    }
    v.target = null;
    v.state = 'leave';
    v.path = (this.findPath(v.tile, [ENTRANCE]) || []).slice(1);
  }

  updateVisitor(v, dt) {
    if (v.state === 'ride') {
      v.rideTimer -= dt;
      if (v.rideTimer <= 0) {
        v.view.setVisible(true);
        v.target.riders--;
        v.visitsLeft--;
        v.last = v.target;
        this.chooseTarget(v);
      }
      return;
    }
    if (v.target && !this.buildings.includes(v.target)) this.chooseTarget(v);
    const next = v.path[0];
    if (!next) {
      if (v.state === 'leave') { v.done = true; return; }
      if (v.target && v.target.access.some(a => a.x === v.tile.x && a.y === v.tile.y)) {
        const t = TYPES[v.target.type];
        this.money += t.fee;
        this.floatText(v.target.x * T + v.target.w * T / 2, v.target.y * T + 6, '+' + fmt(t.fee), '#9dff8a');
        v.state = 'ride';
        v.target.riders = (v.target.riders || 0) + 1;
        v.rideTimer = t.attraction ? 3 : 1.5;
        v.view.setVisible(false);
        this.updateUI();
      } else this.chooseTarget(v);
      return;
    }
    if (!this.isPath(next.x, next.y)) { this.chooseTarget(v); if (v.state === 'leave' && !v.path.length && !(v.tile.x === ENTRANCE.x && v.tile.y === ENTRANCE.y)) v.done = true; return; }
    const tx = next.x * T + T / 2 + v.ox, ty = next.y * T + T / 2 + 4 + v.oy;
    const dx = tx - v.px, dy = ty - v.py, d = Math.hypot(dx, dy), step = WALK_SPEED * dt;
    if (d <= step) { v.px = tx; v.py = ty; v.tile = next; v.path.shift(); }
    else { v.px += dx / d * step; v.py += dy / d * step; }
    v.phase += dt * 12;
    v.body.y = -Math.abs(Math.sin(v.phase)) * 1.5;
    v.legs.scaleX = 1 + Math.sin(v.phase) * 0.15;
    v.view.setPosition(v.px, v.py).setDepth(Math.floor(v.py / T) * 10 + 5);
  }

  simulate(dt) {
    this.dayTimer += dt;
    if (this.dayTimer >= DAY_SECONDS) {
      this.dayTimer -= DAY_SECONDS;
      this.day++;
      const upkeep = this.buildings.reduce((s, b) => s + (TYPES[b.type].upkeep || 0), 0);
      if (upkeep) { this.money -= upkeep; toast(`Day ${this.day}: operating costs ${fmt(upkeep)}`); }
      this.updateUI();
    }
    const canVisit = this.buildings.some(b => b.access && b.access.length && TYPES[b.type].fee);
    this.spawnTimer -= dt;
    if (canVisit && this.spawnTimer <= 0 && this.visitors.length < MAX_VISITORS) {
      this.spawnVisitor();
      this.spawnTimer = 9 - this.rating * 0.07;
      this.updateUI();
    }
    for (const v of this.visitors) this.updateVisitor(v, dt);
    if (this.visitors.some(v => v.done)) {
      this.visitors = this.visitors.filter(v => { if (v.done) v.view.destroy(); return !v.done; });
      this.updateUI();
    }
  }

  // ---------- drawing ----------
  redrawPaths() {
    const g = this.pathGfx.clear();
    const isP = (x, y) => this.isPath(x, y);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!isP(x, y)) continue;
      const px = x * T, py = y * T, m = 3;
      g.fillStyle(0xb89a6a).fillRect(px + m - 1, py + m - 1, T - 2 * m + 2, T - 2 * m + 2);
      g.fillStyle(0xe8d3a6).fillRect(px + m, py + m, T - 2 * m, T - 2 * m);
      if (isP(x - 1, y)) g.fillRect(px, py + m, m, T - 2 * m);
      if (isP(x + 1, y)) g.fillRect(px + T - m, py + m, m, T - 2 * m);
      if (isP(x, y - 1)) g.fillRect(px + m, py, T - 2 * m, m);
      if (isP(x, y + 1)) g.fillRect(px + m, py + T - m, T - 2 * m, m);
      g.fillStyle(0xd9c08e).fillCircle(px + 10, py + 11, 1.5).fillCircle(px + 21, py + 20, 1.5);
    }
  }

  drawGate() {
    const c = this.add.container(ENTRANCE.x * T, ENTRANCE.y * T).setDepth(ENTRANCE.y * 10 + 9);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillEllipse(-T / 2, T - 4, 26, 8).fillEllipse(T * 1.5, T - 4, 26, 8);
    [-T + 6, T + 6].forEach(px => {
      g.fillStyle(0xb5452f).fillRect(px, 0, 20, T - 4);
      g.fillStyle(0xd65a40).fillRect(px + 2, 2, 16, T - 8);
      g.fillStyle(0xf4b942).fillTriangle(px - 2, 2, px + 22, 2, px + 10, -10);
    });
    g.fillStyle(0xe2456f).fillRoundedRect(-T + 4, -18, T * 3 - 8, 16, 6);
    c.add(g);
    c.add(this.add.text(T / 2, -10, 'TINY PARK', {
      fontFamily: 'Trebuchet MS', fontSize: '11px', fontStyle: 'bold', color: '#fffdf6',
    }).setOrigin(0.5));
    return c;
  }

  drawBuilding(b) {
    const c = this.add.container(b.x * T, b.y * T).setDepth((b.y + b.h) * 10);
    const g = this.add.graphics();
    c.add(g);
    const W = b.w * T, H = b.h * T;
    g.fillStyle(0x000000, 0.18).fillEllipse(W / 2 + 4, H - 6, W - 4, H * 0.35);

    if (b.type === 'tree') {
      g.fillStyle(0x8a5a32).fillRect(13, 16, 6, 12);
      g.fillStyle(0x2e8b3e).fillCircle(16, 13, 11);
      g.fillStyle(0x3fa84f).fillCircle(12, 10, 7).fillCircle(20, 12, 6);
      g.fillStyle(0x6cd17a).fillCircle(11, 8, 3);
    } else if (b.type === 'food') {
      g.fillStyle(0xfff3d6).fillRect(4, 10, 24, 18);
      g.fillStyle(0x8a5a32).fillRect(4, 22, 24, 6);
      for (let i = 0; i < 4; i++) g.fillStyle(i % 2 ? 0xffffff : 0xe2456f).fillRect(2 + i * 7, 4, 7, 8);
      g.fillStyle(0xf4b942).fillCircle(16, 17, 4);
      g.fillStyle(0xe2456f).fillCircle(15, 16, 1.2).fillCircle(17.5, 18, 1.2);
    } else if (b.type === 'carousel') {
      g.fillStyle(0xc9a26b).fillCircle(32, 36, 27);
      g.fillStyle(0xf7e3b5).fillCircle(32, 36, 24);
      const spin = this.add.graphics({ x: 32, y: 36 });
      const cols = [0xe2456f, 0xfff3d6, 0x4aa3df, 0xfff3d6];
      for (let i = 0; i < 8; i++) {
        const a1 = (i / 8) * Math.PI * 2, a2 = ((i + 1) / 8) * Math.PI * 2;
        spin.fillStyle(cols[i % 4], 0.9).fillTriangle(0, 0, Math.cos(a1) * 20, Math.sin(a1) * 20, Math.cos(a2) * 20, Math.sin(a2) * 20);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        spin.fillStyle([0xffffff, 0x8e5ad6, 0xf4b942][i % 3]).fillCircle(Math.cos(a) * 21, Math.sin(a) * 21, 3.5);
      }
      spin.fillStyle(0xf4b942).fillCircle(0, 0, 6);
      spin.fillStyle(0xe2456f).fillCircle(0, 0, 3);
      c.add(spin);
      b.spin = spin;
    } else if (b.type === 'ferris') {
      g.fillStyle(0x6b7a8f).fillRect(10, 56, 44, 5);
      g.lineStyle(4, 0x8796ab).lineBetween(14, 58, 32, 26).lineBetween(50, 58, 32, 26);
      const wheel = this.add.graphics({ x: 32, y: 26 });
      wheel.lineStyle(3, 0xe2456f).strokeCircle(0, 0, 24);
      wheel.lineStyle(1.5, 0xfff3d6);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; wheel.lineBetween(0, 0, Math.cos(a) * 24, Math.sin(a) * 24); }
      c.add(wheel);
      const cols = [0xf4b942, 0x4aa3df, 0x8e5ad6, 0x4fc16b];
      b.gondolas = cols.concat(cols).map(col => {
        const gd = this.add.graphics().fillStyle(0x6b7a8f).fillRect(-0.5, -4, 1, 3).fillStyle(col).fillRoundedRect(-4, -1, 8, 7, 2);
        c.add(gd);
        return gd;
      });
      b.gondolas.forEach((gd, i) => { const ang = (i / 8) * Math.PI * 2; gd.setPosition(32 + Math.cos(ang) * 24, 26 + Math.sin(ang) * 24); });
      c.add(this.add.graphics().fillStyle(0xf4b942).fillCircle(32, 26, 4));
      b.spin = wheel;
    } else if (b.type === 'coaster') {
      const cx = W / 2, cy = H / 2 - 4, rx = W / 2 - 12, ry = H / 2 - 14;
      g.fillStyle(0x8796ab);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fillRect(cx + Math.cos(a) * rx - 1, cy + Math.sin(a) * ry, 3, 10);
      }
      g.lineStyle(7, 0x4aa3df).strokeEllipse(cx, cy, rx * 2, ry * 2);
      g.lineStyle(2, 0xfff3d6).strokeEllipse(cx, cy, rx * 2, ry * 2);
      g.fillStyle(0x4fc16b).fillEllipse(cx, cy, rx * 1.3, ry * 1.1);
      g.fillStyle(0xfff3d6).fillRect(cx - 18, H - 22, 36, 16);
      g.fillStyle(0xe2456f).fillTriangle(cx - 22, H - 22, cx + 22, H - 22, cx, H - 34);
      g.fillStyle(0x6b7a8f).fillRect(cx - 1, H - 46, 2, 14);
      g.fillStyle(0xf4b942).fillTriangle(cx + 1, H - 46, cx + 12, H - 42, cx + 1, H - 38);
      const train = this.add.graphics();
      c.add(train);
      b.train = train; b.track = { cx, cy, rx, ry };
    }
    return c;
  }

  // ---------- loop ----------
  update(time, delta) {
    const dt = Math.min(delta, 100) / 1000 * this.speed;
    this.simulate(dt);
    for (const b of this.buildings) {
      b.phase += dt;
      const busy = Math.min(4, b.riders || 0);
      if (b.type === 'carousel') b.spin.rotation += dt * (0.5 + busy * 0.5);
      if (b.type === 'ferris') {
        b.spin.rotation += dt * (0.2 + busy * 0.15);
        b.gondolas.forEach((gd, i) => {
          const a = b.spin.rotation + (i / 8) * Math.PI * 2;
          gd.setPosition(32 + Math.cos(a) * 24, 26 + Math.sin(a) * 24);
        });
      }
      if (b.type === 'coaster') {
        const { cx, cy, rx, ry } = b.track;
        const g = b.train.clear();
        b.trainPos = (b.trainPos || 0) + dt * (busy ? 1.8 + busy * 0.3 : 0.4);
        const t0 = b.trainPos;
        const cols = [0xe2456f, 0xf4b942, 0x8e5ad6, 0xe2456f];
        for (let i = 0; i < 4; i++) {
          const a = t0 - i * 0.28;
          g.fillStyle(cols[i]).fillCircle(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry - 2, 5);
          g.fillStyle(0xffffff, 0.8).fillCircle(cx + Math.cos(a) * rx - 1, cy + Math.sin(a) * ry - 4, 1.5);
        }
      }
    }
    for (const cl of this.clouds) { cl.x += dt * 8; if (cl.x > N * T + 120) cl.x = -120; }
    this.drawPreview();
  }

  drawPreview() {
    const g = this.preview.clear();
    const h = this.hover;
    this.previewText.setVisible(!!h);
    if (this.ghost) this.ghost.setVisible(!!h);
    if (!h) return;
    if (this.tool === 'bulldoze') {
      const c = this.grid[h.y][h.x];
      const b = typeof c === 'number' && this.buildings.find(o => o.id === c);
      const r = b ? [b.x, b.y, b.w, b.h] : [h.x, h.y, 1, 1];
      const ok = c !== null && c !== 'gate' && !(h.x === ENTRANCE.x && h.y === ENTRANCE.y);
      g.lineStyle(2, 0xff4d4d).fillStyle(0xff4d4d, ok ? 0.35 : 0.15).fillRect(r[0] * T, r[1] * T, r[2] * T, r[3] * T).strokeRect(r[0] * T, r[1] * T, r[2] * T, r[3] * T);
      this.previewText.setText(ok ? '+' + fmt(TYPES[b ? b.type : 'path'].cost / 2) : '').setPosition(r[0] * T + r[2] * T / 2, r[1] * T - 2);
      return;
    }
    const t = TYPES[this.tool];
    const ok = this.canPlace(this.tool, h.x, h.y) && this.money >= t.cost;
    const col = ok ? 0x3ddc63 : 0xff4d4d;
    g.fillStyle(col, 0.3).lineStyle(2, col).fillRect(h.x * T, h.y * T, t.w * T, t.h * T).strokeRect(h.x * T, h.y * T, t.w * T, t.h * T);
    if (this.ghost) this.ghost.setPosition(h.x * T, h.y * T).setAlpha(ok ? 0.65 : 0.35);
    this.previewText.setText(fmt(t.cost)).setColor(this.money >= t.cost ? '#ffffff' : '#ff8080')
      .setPosition(h.x * T + t.w * T / 2, h.y * T - 2);
  }

  updateUI() {
    const m = $('money');
    if (this.lastMoney !== undefined && this.lastMoney !== this.money) {
      m.classList.remove('up', 'down');
      void m.offsetWidth;
      m.classList.add(this.money > this.lastMoney ? 'up' : 'down');
    }
    this.lastMoney = this.money;
    $('money').textContent = fmt(this.money);
    $('money').style.color = this.money < 0 ? '#c0392b' : '';
    $('day').textContent = this.day;
    $('visitors').textContent = `${this.visitors.length} (${this.totalVisitors} total)`;
    $('rating').textContent = this.rating + '%';
  }

  setTool(tool) {
    this.tool = tool;
    if (this.ghost) this.ghost.destroy();
    this.ghost = null;
    if (TYPES[tool] && tool !== 'path') {
      const t = TYPES[tool];
      this.ghost = this.drawBuilding({ type: tool, x: 0, y: 0, w: t.w, h: t.h }).setDepth(4999).setVisible(false);
    }
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  }
}

function buildMenu(scene) {
  const menu = $('menu');
  const add = (tool, label, price, cls = '') => {
    const btn = document.createElement('button');
    btn.className = 'tool ' + cls;
    btn.dataset.tool = tool;
    btn.innerHTML = `<span>${label}</span><small>${price}</small>`;
    const t = TYPES[tool];
    if (t) btn.title = `${t.name}: ${t.w}×${t.h} tiles` + (t.fee ? `, earns ${fmt(t.fee)}/visit, upkeep ${fmt(t.upkeep)}/day` : '');
    else btn.title = 'Remove paths and buildings (50% refund)';
    btn.onclick = () => scene.setTool(tool);
    menu.appendChild(btn);
  };
  menu.innerHTML = '<h3>Attractions</h3>';
  add('carousel', '🎠 Carousel', fmt(TYPES.carousel.cost));
  add('ferris', '🎡 Ferris Wheel', fmt(TYPES.ferris.cost));
  add('coaster', '🎢 Coaster', fmt(TYPES.coaster.cost));
  menu.insertAdjacentHTML('beforeend', '<h3>Infrastructure</h3>');
  add('path', '🟫 Path', fmt(TYPES.path.cost));
  add('food', '🍔 Food Stand', fmt(TYPES.food.cost));
  add('tree', '🌳 Tree', fmt(TYPES.tree.cost));
  menu.insertAdjacentHTML('beforeend', '<h3>Tools</h3>');
  add('bulldoze', '🚜 Bulldoze', '+50%', 'bulldoze');
  scene.setTool('path');
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: N * T,
  height: N * T,
  backgroundColor: '#76cb52',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: ParkScene,
});
