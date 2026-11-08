'use strict';

const T = 32;
const N = 20;
const START_MONEY = 5000;
const ENTRANCE = { x: 10, y: 19 };

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

    this.grid[ENTRANCE.y][ENTRANCE.x - 1] = 'gate';
    this.grid[ENTRANCE.y][ENTRANCE.x + 1] = 'gate';
    this.grid[ENTRANCE.y][ENTRANCE.x] = 'path';
    this.gate = this.drawGate();

    if (data) {
      this.money = data.money; this.day = data.day;
      data.paths.forEach(([x, y]) => { this.grid[y][x] = 'path'; });
      data.buildings.forEach(([type, x, y]) => this.addBuilding(type, x, y));
    } else {
      for (let y = 15; y < 19; y++) this.grid[y][ENTRANCE.x] = 'path';
    }
    this.redrawPaths();
    this.updateUI();
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
    if (this.tool === 'path') { this.grid[h.y][h.x] = 'path'; this.redrawPaths(); }
    else this.addBuilding(this.tool, h.x, h.y, true);
    this.floatText(h.x * T + t.w * T / 2, h.y * T, '-' + fmt(t.cost), '#ffdd57');
    this.updateUI();
  }

  bulldoze(x, y) {
    const c = this.grid[y][x];
    if (c === null || c === 'gate' || (x === ENTRANCE.x && y === ENTRANCE.y)) return;
    let refund;
    if (c === 'path') { this.grid[y][x] = null; refund = TYPES.path.cost / 2; this.redrawPaths(); }
    else {
      const b = this.buildings.find(b => b.id === c);
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) this.grid[b.y + j][b.x + i] = null;
      b.view.destroy();
      this.buildings = this.buildings.filter(o => o !== b);
      refund = TYPES[b.type].cost / 2;
    }
    this.money += refund;
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

  // ---------- drawing ----------
  redrawPaths() {
    const g = this.pathGfx.clear();
    const isP = (x, y) => x >= 0 && y >= 0 && x < N && y < N && this.grid[y][x] === 'path';
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
      const cols = [0xf4b942, 0x4aa3df, 0x8e5ad6, 0x4fc16b];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        wheel.fillStyle(cols[i % 4]).fillRoundedRect(Math.cos(a) * 24 - 4, Math.sin(a) * 24 - 4, 8, 8, 2);
      }
      c.add(wheel);
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
      const train = this.add.graphics();
      c.add(train);
      b.train = train; b.track = { cx, cy, rx, ry };
    }
    return c;
  }

  // ---------- loop ----------
  update(time, delta) {
    const dt = delta / 1000;
    for (const b of this.buildings) {
      b.phase += dt;
      if (b.type === 'carousel') b.spin.rotation += dt * 1.4;
      if (b.type === 'ferris') b.spin.rotation += dt * 0.5;
      if (b.type === 'coaster') {
        const { cx, cy, rx, ry } = b.track;
        const g = b.train.clear();
        const t0 = b.phase * 1.6;
        const cols = [0xe2456f, 0xf4b942, 0x8e5ad6, 0xe2456f];
        for (let i = 0; i < 4; i++) {
          const a = t0 - i * 0.28;
          g.fillStyle(cols[i]).fillCircle(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry - 2, 5);
          g.fillStyle(0xffffff, 0.8).fillCircle(cx + Math.cos(a) * rx - 1, cy + Math.sin(a) * ry - 4, 1.5);
        }
      }
    }
    this.drawPreview();
  }

  drawPreview() {
    const g = this.preview.clear();
    const h = this.hover;
    if (!h) return;
    if (this.tool === 'bulldoze') {
      g.lineStyle(2, 0xff4d4d).fillStyle(0xff4d4d, 0.3).fillRect(h.x * T, h.y * T, T, T).strokeRect(h.x * T, h.y * T, T, T);
      return;
    }
    const t = TYPES[this.tool];
    const ok = this.canPlace(this.tool, h.x, h.y) && this.money >= t.cost;
    const col = ok ? 0x3ddc63 : 0xff4d4d;
    g.fillStyle(col, 0.35).lineStyle(2, col).fillRect(h.x * T, h.y * T, t.w * T, t.h * T).strokeRect(h.x * T, h.y * T, t.w * T, t.h * T);
  }

  updateUI() {
    $('money').textContent = fmt(this.money);
    $('money').style.color = this.money < 0 ? '#c0392b' : '';
    $('day').textContent = this.day;
  }

  setTool(tool) {
    this.tool = tool;
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
