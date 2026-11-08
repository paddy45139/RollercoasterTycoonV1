'use strict';
// Babylon.js renderer and input for the Park simulation in park.js.

const canvas = $('renderCanvas');
const engine = new BABYLON.Engine(canvas, true, { stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.62, 0.83, 0.96, 1);


const V3 = (x, y, z) => new BABYLON.Vector3(x, y, z);
// tile (x, y) maps to world (x, N - y); the entrance row faces the default camera.
const world = (tx, ty, h = 0) => V3(tx, h, N - ty);

const matCache = {};
function mat(hex, alpha = 1) {
  const key = hex + '_' + alpha;
  if (!matCache[key]) {
    const m = new BABYLON.StandardMaterial(key, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
    if (alpha < 1) { m.alpha = alpha; m.backFaceCulling = false; }
    matCache[key] = m;
  }
  return matCache[key];
}

// ---------- camera ----------
const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2 - 0.55, 0.92, 30, V3(N / 2, 0, N / 2 - 1), scene);
camera.fov = 0.6;
camera.lowerRadiusLimit = 9;
camera.upperRadiusLimit = 42;
camera.lowerBetaLimit = 0.35;
camera.upperBetaLimit = 1.25;
camera.wheelDeltaPercentage = 0.015;
camera.inertia = 0.85;
camera.panningInertia = 0.85;
camera.panningSensibility = 40;
camera.mapPanning = true;
camera.attachControl(canvas, true);
camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
const pointerInput = camera.inputs.attached.pointers;
pointerInput.buttons = [1, 2];
pointerInput.useCtrlForPanning = false;
pointerInput.panningMouseButton = 1;
canvas.addEventListener('contextmenu', e => e.preventDefault());

const keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
const panVel = V3(0, 0, 0);
function updateCamera(dt) {
  const fwd = camera.target.subtract(camera.position); fwd.y = 0; fwd.normalize();
  const right = V3(fwd.z, 0, -fwd.x);
  const want = V3(0, 0, 0);
  if (keys.w) want.addInPlace(fwd);
  if (keys.s) want.subtractInPlace(fwd);
  if (keys.d) want.addInPlace(right);
  if (keys.a) want.subtractInPlace(right);
  want.scaleInPlace(camera.radius * 0.9);
  BABYLON.Vector3.LerpToRef(panVel, want, Math.min(1, dt * 8), panVel);
  camera.target.addInPlace(panVel.scale(dt));
  camera.target.x = Math.max(0, Math.min(N, camera.target.x));
  camera.target.z = Math.max(0, Math.min(N, camera.target.z));
  camera.target.y = 0;
}

// ---------- lighting ----------
const hemi = new BABYLON.HemisphericLight('hemi', V3(0.2, 1, 0.1), scene);
hemi.intensity = 0.5;
hemi.groundColor = new BABYLON.Color3(0.45, 0.5, 0.45);
const sun = new BABYLON.DirectionalLight('sun', V3(-0.55, -1, 0.45), scene);
sun.position = V3(N / 2 + 14, 26, N / 2 - 12);
sun.intensity = 0.7;
const shadows = new BABYLON.ShadowGenerator(1024, sun);
shadows.usePercentageCloserFiltering = true;
shadows.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
shadows.bias = 0.002;
shadows.darkness = 0.45;
const castShadow = node => node.getChildMeshes(false).concat(node instanceof BABYLON.Mesh ? [node] : []).forEach(m => shadows.addShadowCaster(m, false));

// ---------- terrain ----------
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: N, height: N }, scene);
ground.position = V3(N / 2, 0, N / 2);
ground.receiveShadows = true;
{
  const tex = new BABYLON.DynamicTexture('grassTex', { width: 640, height: 640 }, scene, true);
  const ctx = tex.getContext();
  const s = 32;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#7fd35b' : '#76cb52';
    ctx.fillRect(x * s, y * s, s, s);
    const r = (x * 7 + y * 13) % 5;
    if (r === 0) { ctx.fillStyle = '#69b947'; ctx.fillRect(x * s + 8, y * s + 12, 2, 5); ctx.fillRect(x * s + 12, y * s + 10, 2, 7); }
    if (r === 3) { ctx.fillStyle = '#fff27a'; ctx.beginPath(); ctx.arc(x * s + 22, y * s + 22, 2, 0, 7); ctx.fill(); }
  }
  tex.update();
  const gm = new BABYLON.StandardMaterial('groundMat', scene);
  gm.diffuseTexture = tex;
  gm.specularColor = new BABYLON.Color3(0, 0, 0);
  ground.material = gm;
}
const slab = BABYLON.MeshBuilder.CreateBox('slab', { width: N + 0.5, depth: N + 0.5, height: 0.8 }, scene);
slab.position = V3(N / 2, -0.41, N / 2);
slab.material = mat('#8a6a45');
const rim = BABYLON.MeshBuilder.CreateBox('rim', { width: N + 0.5, depth: N + 0.5, height: 0.12 }, scene);
rim.position = V3(N / 2, -0.055, N / 2);
rim.material = mat('#5aa83d');

// ---------- paths ----------
const pathMesh = BABYLON.MeshBuilder.CreateBox('path', { width: 1, depth: 1, height: 0.06 }, scene);
pathMesh.material = mat('#d9bf8c');
pathMesh.receiveShadows = true;
function redrawPaths() {
  const tiles = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (park.isPath(x, y)) tiles.push(world(x + 0.5, y + 0.5, 0.03));
  const buf = new Float32Array(Math.max(1, tiles.length) * 16);
  tiles.forEach((p, i) => BABYLON.Matrix.Translation(p.x, p.y, p.z).copyToArray(buf, i * 16));
  pathMesh.thinInstanceSetBuffer('matrix', buf, 16, false);
  pathMesh.isVisible = tiles.length > 0;
}

// ---------- entrance gate ----------
function buildGate() {
  const root = new BABYLON.TransformNode('gate', scene);
  root.position = world(ENTRANCE.x + 0.5, ENTRANCE.y + 0.5);
  [-1, 1].forEach(side => {
    const p = BABYLON.MeshBuilder.CreateBox('pillar', { width: 0.6, depth: 0.6, height: 1.8 }, scene);
    p.position = V3(side, 0.9, 0); p.material = mat('#d65a40'); p.parent = root;
    const cap = BABYLON.MeshBuilder.CreateCylinder('cap', { diameterTop: 0, diameterBottom: 0.85, height: 0.6, tessellation: 4 }, scene);
    cap.position = V3(side, 2.1, 0); cap.rotation.y = Math.PI / 4; cap.material = mat('#f4b942'); cap.parent = root;
  });
  const sign = BABYLON.MeshBuilder.CreatePlane('sign', { width: 2.6, height: 0.55, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
  sign.position = V3(0, 1.55, -0.32);
  sign.parent = root;
  const tex = new BABYLON.DynamicTexture('signTex', { width: 512, height: 108 }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#e2456f'; ctx.fillRect(0, 0, 512, 108);
  tex.drawText('TINY PARK', null, 78, 'bold 64px Trebuchet MS', '#fffdf6', null, true);
  const sm = new BABYLON.StandardMaterial('signMat', scene);
  sm.diffuseTexture = tex; sm.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35); sm.specularColor = new BABYLON.Color3(0, 0, 0);
  sign.material = sm;
  const beam = BABYLON.MeshBuilder.CreateBox('beam', { width: 2.6, depth: 0.5, height: 0.6 }, scene);
  beam.position = V3(0, 1.55, 0); beam.material = mat('#e2456f'); beam.parent = root;
  castShadow(root);
}
buildGate();

// ---------- buildings ----------
const views = new Map();
const PLACEHOLDER = { carousel: ['#e2456f', 1.2], ferris: ['#4aa3df', 3], coaster: ['#8e5ad6', 1.5], food: ['#f4b942', 0.9], tree: ['#3fa84f', 1.2] };

function makeModel(b) {
  const root = new BABYLON.TransformNode('b' + b.id, scene);
  const [color, height] = PLACEHOLDER[b.type];
  const box = BABYLON.MeshBuilder.CreateBox('ph', { width: b.w - 0.2, depth: b.h - 0.2, height }, scene);
  box.position.y = height / 2; box.material = mat(color); box.parent = root;
  return root;
}

function addView(b, animate) {
  const root = makeModel(b);
  root.position = world(b.x + b.w / 2, b.y + b.h / 2);
  castShadow(root);
  views.set(b.id, root);
  if (animate) {
    root.scaling.setAll(0.2);
    const ease = new BABYLON.BackEase(0.6);
    ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
    BABYLON.Animation.CreateAndStartAnimation('pop', root, 'scaling', 60, 18, root.scaling.clone(), V3(1, 1, 1),
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, ease);
  }
}
function removeView(b) {
  const root = views.get(b.id);
  if (root) { root.getChildMeshes().forEach(m => shadows.removeShadowCaster(m)); root.dispose(); views.delete(b.id); }
}

// ---------- floating text ----------
function floatText(tx, ty, str, color) {
  const p = BABYLON.Vector3.Project(world(tx, ty, 1.5), BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
  const scale = canvas.clientWidth / engine.getRenderWidth();
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = str;
  el.style.color = color;
  el.style.left = p.x * scale + 'px';
  el.style.top = p.y * scale + 'px';
  $('floats').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ---------- park wiring ----------
const park = new Park({
  buildingAdded: addView,
  buildingRemoved: removeView,
  pathsChanged: redrawPaths,
  reset() {},
  float: floatText,
  toast,
  ui: () => updateUI(park),
});
let tool = 'path';
buildMenu(park, t => { tool = t; });
park.newGame();
window.__park = park;
window.__scene = scene;

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  park.update(dt);
  updateCamera(Math.min(dt, 0.1));
  scene.render();
});
window.addEventListener('resize', () => engine.resize());
