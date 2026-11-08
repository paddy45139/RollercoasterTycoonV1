'use strict';
// Engine-independent park simulation. Coordinates are in tiles; renderers listen through `hooks`.

const N = 20;
const START_MONEY = 5000;
const ENTRANCE = { x: 10, y: 19 };
const DAY_SECONDS = 20;
const MAX_VISITORS = 20;
const WALK_SPEED = 1.3;
const SAVE_KEY = 'tinyParkTycoon';
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
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

class Park {
  constructor(hooks) {
    this.hooks = Object.assign({
      buildingAdded() {}, buildingRemoved() {}, pathsChanged() {}, visitorAdded() {}, visitorRemoved() {},
      reset() {}, float() {}, toast() {}, ui() {},
    }, hooks);
    this.speed = 1;
    this.paused = false;
    this.buildings = [];
    this.visitors = [];
  }

  newGame(data) {
    this.visitors.forEach(v => this.hooks.visitorRemoved(v));
    this.buildings.forEach(b => this.hooks.buildingRemoved(b));
    this.hooks.reset();
    this.grid = Array.from({ length: N }, () => Array(N).fill(null));
    this.buildings = [];
    this.visitors = [];
    this.nextId = 1;
    this.money = START_MONEY;
    this.day = 1;
    this.dayTimer = 0;
    this.spawnTimer = 0;
    this.totalVisitors = 0;

    this.grid[ENTRANCE.y][ENTRANCE.x - 1] = 'gate';
    this.grid[ENTRANCE.y][ENTRANCE.x + 1] = 'gate';
    this.grid[ENTRANCE.y][ENTRANCE.x] = 'path';
    if (data) {
      this.money = data.money; this.day = data.day; this.totalVisitors = data.totalVisitors || 0;
      data.paths.forEach(([x, y]) => { this.grid[y][x] = 'path'; });
      data.buildings.forEach(([type, x, y]) => this.addBuilding(type, x, y));
    } else {
      for (let y = 15; y < 19; y++) this.grid[y][ENTRANCE.x] = 'path';
    }
    this.gridChanged();
  }

  serialize() {
    const paths = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (this.grid[y][x] === 'path') paths.push([x, y]);
    return { money: this.money, day: this.day, totalVisitors: this.totalVisitors, paths, buildings: this.buildings.map(b => [b.type, b.x, b.y]) };
  }

  save() { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); this.hooks.toast('Park saved'); }

  load() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { this.hooks.toast('No saved park found'); return; }
    this.newGame(JSON.parse(raw));
    this.hooks.toast('Park loaded');
  }

  isPath(x, y) { return x >= 0 && y >= 0 && x < N && y < N && this.grid[y][x] === 'path'; }

  canPlace(type, x, y) {
    const t = TYPES[type];
    if (x < 0 || y < 0 || x + t.w > N || y + t.h > N) return false;
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) if (this.grid[y + j][x + i] !== null) return false;
    return true;
  }

  place(type, x, y) {
    const t = TYPES[type];
    if (!this.canPlace(type, x, y)) return false;
    if (this.money < t.cost) { this.hooks.toast('Not enough money!'); return false; }
    this.money -= t.cost;
    if (type === 'path') this.grid[y][x] = 'path';
    else this.addBuilding(type, x, y, true);
    this.gridChanged();
    this.hooks.float(x + t.w / 2, y + t.h / 2, '-' + fmt(t.cost), '#ffdd57');
    return true;
  }

  buildingAt(x, y) {
    const c = this.grid[y] && this.grid[y][x];
    return typeof c === 'number' ? this.buildings.find(b => b.id === c) : null;
  }

  canBulldoze(x, y) {
    const c = this.grid[y][x];
    return c !== null && c !== 'gate' && !(x === ENTRANCE.x && y === ENTRANCE.y);
  }

  bulldoze(x, y) {
    if (!this.canBulldoze(x, y)) return false;
    let refund;
    const b = this.buildingAt(x, y);
    if (!b) { this.grid[y][x] = null; refund = TYPES.path.cost / 2; }
    else {
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.grid[b.y + j][b.x + i] = null;
      this.buildings = this.buildings.filter(o => o !== b);
      this.hooks.buildingRemoved(b);
      refund = TYPES[b.type].cost / 2;
    }
    this.money += refund;
    this.gridChanged();
    this.hooks.float(x + 0.5, y + 0.5, '+' + fmt(refund), '#9dff8a');
    return true;
  }

  addBuilding(type, x, y, animate) {
    const t = TYPES[type];
    const b = { id: this.nextId++, type, x, y, w: t.w, h: t.h, riders: 0, access: [], variant: Math.floor(Math.random() * 3) };
    for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) this.grid[y + j][x + i] = b.id;
    this.buildings.push(b);
    this.hooks.buildingAdded(b, animate);
    return b;
  }

  gridChanged() {
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
    const attractions = open.filter(b => TYPES[b.type].attraction);
    const food = open.filter(b => b.type === 'food').length;
    const trees = this.buildings.filter(b => b.type === 'tree').length;
    const variety = new Set(attractions.map(b => b.type)).size;
    this.rating = Math.min(100, Math.min(45, attractions.length * 12) + variety * 5 + Math.min(20, food * 10) + Math.min(20, trees * 2));
    this.hooks.pathsChanged();
    this.hooks.ui();
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
      tile: { ...ENTRANCE }, px: ENTRANCE.x + 0.5, py: ENTRANCE.y + 0.9, heading: Math.PI,
      ox: Math.random() * 0.4 - 0.2, oy: Math.random() * 0.4 - 0.2,
      visitsLeft: 2 + Math.floor(Math.random() * 3), state: 'walk', path: [], phase: Math.random() * 6, moving: false,
      color: Math.floor(Math.random() * 6),
    };
    this.visitors.push(v);
    this.totalVisitors++;
    this.hooks.visitorAdded(v);
    this.chooseTarget(v);
  }

  chooseTarget(v) {
    const open = this.buildings.filter(b => b.access.length && TYPES[b.type].fee && b !== v.last);
    if (v.visitsLeft > 0 && open.length) {
      const b = pick(open);
      const path = this.findPath(v.tile, b.access);
      if (path) { v.target = b; v.path = path.slice(1); v.state = 'walk'; return; }
    }
    v.target = null;
    v.state = 'leave';
    const out = this.findPath(v.tile, [ENTRANCE]);
    v.path = out ? out.slice(1) : [];
    if (!out) v.done = true;
  }

  updateVisitor(v, dt) {
    v.moving = false;
    if (v.state === 'ride') {
      v.rideTimer -= dt;
      if (v.rideTimer <= 0) {
        v.hidden = false;
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
        this.hooks.float(v.target.x + v.target.w / 2, v.target.y + v.target.h / 2, '+' + fmt(t.fee), '#9dff8a');
        v.state = 'ride';
        v.target.riders++;
        v.rideTimer = t.attraction ? 3 : 1.5;
        v.hidden = true;
        this.hooks.ui();
      } else this.chooseTarget(v);
      return;
    }
    if (!this.isPath(next.x, next.y)) { this.chooseTarget(v); return; }
    const tx = next.x + 0.5 + v.ox, ty = next.y + 0.5 + v.oy;
    const dx = tx - v.px, dy = ty - v.py, d = Math.hypot(dx, dy), step = WALK_SPEED * dt;
    if (d > 0.001) v.heading = Math.atan2(dx, dy);
    if (d <= step) { v.px = tx; v.py = ty; v.tile = next; v.path.shift(); }
    else { v.px += dx / d * step; v.py += dy / d * step; }
    v.moving = true;
    v.phase += dt * 12;
  }

  update(realDt) {
    if (this.paused) return 0;
    const dt = Math.min(realDt, 0.1) * this.speed;
    this.dayTimer += dt;
    if (this.dayTimer >= DAY_SECONDS) {
      this.dayTimer -= DAY_SECONDS;
      this.day++;
      const upkeep = this.buildings.reduce((s, b) => s + (TYPES[b.type].upkeep || 0), 0);
      if (upkeep) { this.money -= upkeep; this.hooks.toast(`Day ${this.day}: operating costs ${fmt(upkeep)}`); }
      this.hooks.ui();
    }
    const canVisit = this.buildings.some(b => b.access.length && TYPES[b.type].fee);
    this.spawnTimer -= dt;
    if (canVisit && this.spawnTimer <= 0 && this.visitors.length < MAX_VISITORS) {
      this.spawnVisitor();
      this.spawnTimer = 9 - this.rating * 0.07;
      this.hooks.ui();
    }
    for (const v of this.visitors) this.updateVisitor(v, dt);
    if (this.visitors.some(v => v.done)) {
      this.visitors = this.visitors.filter(v => { if (v.done) this.hooks.visitorRemoved(v); return !v.done; });
      this.hooks.ui();
    }
    return dt;
  }
}

// ---------- shared HTML UI ----------
const $ = id => document.getElementById(id);

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1600);
}

function updateUI(park) {
  const m = $('money');
  if (updateUI.last !== undefined && updateUI.last !== park.money) {
    m.classList.remove('up', 'down');
    void m.offsetWidth;
    m.classList.add(park.money > updateUI.last ? 'up' : 'down');
  }
  updateUI.last = park.money;
  m.textContent = fmt(park.money);
  m.style.color = park.money < 0 ? '#c0392b' : '';
  $('day').textContent = park.day;
  $('visitors').textContent = `${park.visitors.length} (${park.totalVisitors} total)`;
  $('rating').textContent = park.rating + '%';
  $('pause').textContent = park.paused ? '▶ Resume' : '⏸ Pause';
  $('speed1').classList.toggle('active', park.speed === 1);
  $('speed2').classList.toggle('active', park.speed === 2);
}

function buildMenu(park, setTool) {
  const menu = $('menu');
  const add = (tool, label, price, cls = '') => {
    const btn = document.createElement('button');
    btn.className = 'tool ' + cls;
    btn.dataset.tool = tool;
    btn.innerHTML = `<span>${label}</span><small>${price}</small>`;
    const t = TYPES[tool];
    btn.title = t ? `${t.name}: ${t.w}×${t.h} tiles` + (t.fee ? `, earns ${fmt(t.fee)}/visit, upkeep ${fmt(t.upkeep)}/day` : '')
      : 'Remove paths and buildings (50% refund)';
    btn.onclick = () => select(tool);
    menu.appendChild(btn);
  };
  const select = tool => {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    setTool(tool);
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
  select('path');

  const c = $('controls');
  c.innerHTML = '<button id="pause"></button><button id="speed1">1×</button><button id="speed2">2×</button>' +
    '<button id="save">💾 Save</button><button id="load">📂 Load</button><button id="new">✨ New</button>';
  $('pause').onclick = () => { park.paused = !park.paused; updateUI(park); };
  $('speed1').onclick = () => { park.speed = 1; updateUI(park); };
  $('speed2').onclick = () => { park.speed = 2; updateUI(park); };
  $('save').onclick = () => park.save();
  $('load').onclick = () => park.load();
  $('new').onclick = () => { if (confirm('Start a new park? Unsaved progress will be lost.')) park.newGame(); };
}
