import * as THREE from './vendor/three.module.min.js';
import { D2R, R2D, makeENU, haversine, wrapPi, pathLength, polyArea3, fitRigid2D, rotY, fmtLen, fmtArea, coverFov, demoRoad } from './geo.js';
import { CRS_PRESETS, parseFiles, fetchArcGIS, eachCoord } from './parsers.js';

const $ = id => document.getElementById(id);
const PALETTE = ['#3d6ff2', '#e5484d', '#2fb574', '#ffc53d', '#22c3dd', '#c4a7ff', '#ff8b3e', '#f4f4f0'];
const FONT = '"IBM Plex Sans Arabic","Noto Sans Arabic","Segoe UI",Tahoma,sans-serif';
const MEASURE_COLOR = '#e07bff';

// ---------- الأيقونات ----------
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14"/>',
  layers: '<path d="m12 3-9 5 9 5 9-5-9-5ZM3 12.5l9 5 9-5M3 17l9 5 9-5"/>',
  target: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  tools: '<rect x="4" y="4" width="6" height="6" rx="1"/><circle cx="17" cy="7" r="3"/><path d="m4 20 3-6 3 6ZM17 14v6M14 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M8 6 3 11l5 5M3 11h11a5 5 0 0 1 0 10h-3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  area: '<path d="M5 8 14 4l5 9-7 7-7-4Z"/><circle cx="5" cy="8" r="1.5" fill="currentColor"/><circle cx="14" cy="4" r="1.5" fill="currentColor"/><circle cx="19" cy="13" r="1.5" fill="currentColor"/><circle cx="12" cy="20" r="1.5" fill="currentColor"/><circle cx="5" cy="16" r="1.5" fill="currentColor"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21ZM7 13l2 2M10 10l2 2M13 7l2 2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM4 4l16 16"/>',
  arrow: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  rot: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  go: '<path d="M4 11 20 4l-7 16-2-7-7-2Z"/>',
  cube: '<path d="m12 3-8 4.5v9L12 21l8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m9 21 2.5-6-2-3 1-5 4 1.5 2 3.5M11.500 15l3 2 1 4M7 10l3.5-3"/>',
  road: '<path d="M8 3 4 21M16 3l4 18M12 4v3M12 11v3M12 18v3"/>',
};
const svg = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
document.querySelectorAll('[data-i]').forEach(el => el.insertAdjacentHTML('afterbegin', svg(el.dataset.i)));

// ---------- الحالة ----------
const SIM_ORIGIN = { lat: 24.7136, lon: 46.6753 };
const S = {
  mode: 'sim', // sim | sensor | xr
  enu: makeENU(SIM_ORIGIN.lat, SIM_ORIGIN.lon),
  user: { lat: SIM_ORIGIN.lat, lon: SIM_ORIGIN.lon, e: 0, n: 0 },
  headingDeg: 0,
  layers: [],
  zMode: 'flat', zRef: 0,
  adj: { e: 0, n: 0, up: 0, yaw: 0 },
  eyeH: 1.5, fovLong: 68, follow: true,
  step: 0.5, rotStep: 2,
  gps: null, gpsEN: null, gpsOrigin: false,
  geo: { phi: 0, tx: 0, ty: 0, tz: 0, ready: false },
  tool: null,
  cur: [], // نقاط القياس الجاري: [x,y,z] في إحداثيات التصميم المحلية
  measures: [],
  reticle: null, // {local:[x,y,z], lon, lat} أو null
};
const sim = { yaw: 0, pitch: -0.16 };
const ori = { has: false, abs: false, a: 0, b: 0, g: 0, compass: null, iosYaw: null };
const keys = {};
const joy = { x: 0, y: 0 };
let uid = 0;

// ---------- three.js ----------
const canvas = $('gl');
const video = $('cam');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 3000);
camera.rotation.order = 'YXZ';
const world = new THREE.Group();
const measG = new THREE.Group();
const liveG = new THREE.Group();
const simEnv = new THREE.Group();
scene.add(simEnv, world);
world.add(measG, liveG);
measG.renderOrder = 400;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), fwdV = new THREE.Vector3();
const qDev = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
const qScreen = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° حول X
const eul = new THREE.Euler();
const raycaster = new THREE.Raycaster();

function buildSimEnv() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#b3a487';
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) {
    const v = 140 + rnd() * 80 | 0;
    g.fillStyle = `rgba(${v},${v - 14},${v - 42},.28)`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  g.strokeStyle = 'rgba(70,58,40,.28)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(400, 400); // مربع كل 10 م
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, depthTest: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -10;
  const sg = new THREE.SphereGeometry(1800, 32, 16);
  const col = [], pos = sg.attributes.position;
  const top = new THREE.Color('#5d93c9'), hor = new THREE.Color('#dfe6e4'), low = new THREE.Color('#b3a487');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 1800;
    const k = t >= 0 ? hor.clone().lerp(top, Math.min(1, t * 2.2)) : hor.clone().lerp(low, Math.min(1, -t * 12));
    col.push(k.r, k.g, k.b);
  }
  sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, depthTest: false }));
  sky.renderOrder = -20;
  simEnv.add(sky, ground);
}
buildSimEnv();

// مؤشر القياس على الأرض
const reticle = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.095, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true }));
  ring.rotation.x = dot.rotation.x = -Math.PI / 2;
  ring.renderOrder = dot.renderOrder = 500;
  reticle.add(ring, dot);
  reticle.visible = false;
  scene.add(reticle);
}

// ---------- بناء هندسة الطبقات ----------
function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
}

function toLocal(c) {
  const [e, n] = S.enu.fwd(c[0], c[1]);
  const y = S.zMode === 'elev' && c.length > 2 && isFinite(c[2]) ? c[2] - S.zRef : 0;
  return [e, y, -n];
}

function ribbon(acc, P, w, fi, lift) {
  const n = P.length;
  if (n < 2) return;
  const off = [];
  for (let i = 0; i < n; i++) {
    let dx = 0, dz = 0;
    if (i > 0) { const x = P[i][0] - P[i - 1][0], z = P[i][2] - P[i - 1][2], l = Math.hypot(x, z) || 1; dx += x / l; dz += z / l; }
    if (i < n - 1) { const x = P[i + 1][0] - P[i][0], z = P[i + 1][2] - P[i][2], l = Math.hypot(x, z) || 1; dx += x / l; dz += z / l; }
    const l = Math.hypot(dx, dz) || 1;
    off.push([-dz / l * w / 2, dx / l * w / 2]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = P[i], b = P[i + 1], oa = off[i], ob = off[i + 1], ya = a[1] + lift, yb = b[1] + lift;
    acc.p.push(a[0] + oa[0], ya, a[2] + oa[1], a[0] - oa[0], ya, a[2] - oa[1], b[0] + ob[0], yb, b[2] + ob[1],
      a[0] - oa[0], ya, a[2] - oa[1], b[0] - ob[0], yb, b[2] - ob[1], b[0] + ob[0], yb, b[2] + ob[1]);
    acc.f.push(fi, fi);
  }
}

function polygonTris(acc, rings, fi, lift) {
  const strip = r => { const n = r.length; return n > 1 && r[0][0] === r[n - 1][0] && r[0][2] === r[n - 1][2] ? r.slice(0, -1) : r; };
  const R = rings.map(strip).filter(r => r.length >= 3);
  if (!R.length) return;
  const all = R.flat();
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(R[0].map(p => new THREE.Vector2(p[0], -p[2])), R.slice(1).map(h => h.map(p => new THREE.Vector2(p[0], -p[2])))); }
  catch { return; }
  for (const t of tris) {
    for (const k of t) { const p = all[k]; acc.p.push(p[0], p[1] + lift, p[2]); }
    acc.f.push(fi);
  }
}

function marker(acc, v, fi) {
  const [x, y, z] = v, r = 0.035, h = 1.3, d = 0.16;
  const a = [0, 1, 2].map(k => [x + r * Math.cos(k * 2.0944), z + r * Math.sin(k * 2.0944)]);
  for (let k = 0; k < 3; k++) {
    const p = a[k], q = a[(k + 1) % 3];
    acc.p.push(p[0], y, p[1], q[0], y, q[1], q[0], y + h, q[1], p[0], y, p[1], q[0], y + h, q[1], p[0], y + h, p[1]);
    acc.f.push(fi, fi);
  }
  const cy = y + h + d, ring = [[x + d, cy, z], [x, cy, z + d], [x - d, cy, z], [x, cy, z - d]];
  for (let k = 0; k < 4; k++) {
    const p = ring[k], q = ring[(k + 1) % 4];
    acc.p.push(x, cy + d, z, ...p, ...q, x, cy - d, z, ...q, ...p);
    acc.f.push(fi, fi);
  }
}

function makeLabel(text, bg = 'rgba(14,20,23,.88)', fg = '#ffffff') {
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 40;
  g.font = `600 ${fs}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 32;
  c.width = w; c.height = fs + 24;
  g.font = `600 ${fs}px ${FONT}`;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, w, c.height, 16); g.fill();
  g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, w / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true }));
  const h = 0.034;
  s.scale.set(h * w / c.height, h, 1);
  s.renderOrder = 300;
  return s;
}

function labelOf(props) {
  if (!props) return null;
  for (const k of ['label', 'name', 'Name', 'NAME', 'الاسم']) if (props[k] != null && props[k] !== '') return String(props[k]).slice(0, 24);
  return null;
}

function buildLayer(L) {
  if (L.group) { world.remove(L.group); disposeGroup(L.group); }
  const G = new THREE.Group();
  G.visible = L.visible;
  L.group = G;
  const idx = S.layers.indexOf(L), lift = 0.01 + idx * 0.004;
  const fill = { p: [], f: [] }, rib = { p: [], f: [] }, pts = { p: [], f: [] }, thin = [], labels = [];
  const seg = (P, l) => { for (let i = 1; i < P.length; i++) thin.push(P[i - 1][0], P[i - 1][1] + l, P[i - 1][2], P[i][0], P[i][1] + l, P[i][2]); };
  L.features.forEach((f, fi) => {
    const g = f.geometry;
    if (!g) return;
    const doPoint = c => { const v = toLocal(c); marker(pts, v, fi); const t = labelOf(f.properties); if (t && labels.length < 200) labels.push([t, v]); };
    const doLine = cs => { const P = cs.map(toLocal); ribbon(rib, P, 0.14, fi, lift + 0.006); seg(P, lift + 0.006); };
    const doPoly = rings => { const R = rings.map(r => r.map(toLocal)); polygonTris(fill, R, fi, lift); for (const P of R) { ribbon(rib, P, 0.07, fi, lift + 0.004); seg(P, lift + 0.004); } };
    if (g.type === 'Point') doPoint(g.coordinates);
    else if (g.type === 'MultiPoint') g.coordinates.forEach(doPoint);
    else if (g.type === 'LineString') doLine(g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(doLine);
    else if (g.type === 'Polygon') doPoly(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(doPoly);
    else if (g.type === 'TIN') {
      const Vx = g.vertices.map(toLocal);
      for (const t of g.faces) {
        for (const k of t) fill.p.push(Vx[k][0], Vx[k][1] + lift, Vx[k][2]);
        fill.f.push(fi);
        if (g.faces.length <= 60000) seg([Vx[t[0]], Vx[t[1]], Vx[t[2]], Vx[t[0]]], lift + 0.004);
      }
    }
  });
  const mesh = (acc, opacity, order) => {
    if (!acc.p.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: L.color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    m.renderOrder = order;
    m.userData = { layer: L, tri: acc.f, base: opacity };
    G.add(m);
  };
  mesh(fill, L.opacity, idx);
  mesh(rib, Math.min(1, L.opacity + 0.4), 100 + idx);
  mesh(pts, 1, 200 + idx);
  if (thin.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(thin, 3));
    const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: L.color, transparent: true, opacity: Math.min(1, L.opacity + 0.4), depthTest: false }));
    ls.renderOrder = 100 + idx;
    G.add(ls);
  }
  G.userData.labels = [];
  for (const [t, v] of labels) {
    const s = makeLabel(t);
    s.position.set(v[0], v[1] + 1.95, v[2]);
    G.add(s);
    G.userData.labels.push(s);
  }
  world.add(G);
}

function applyLayerStyle(L) {
  if (!L.group) return;
  L.group.visible = L.visible;
  L.group.traverse(o => {
    if (!o.material || o.isSprite) return;
    o.material.color.set(L.color);
    if (o.isLineSegments) o.material.opacity = Math.min(1, L.opacity + 0.4);
    else if (o.userData.base !== undefined) o.material.opacity = o.renderOrder < 100 ? L.opacity : o.renderOrder < 200 ? Math.min(1, L.opacity + 0.4) : 1;
  });
}

function addLayer(d) {
  const L = { id: 'L' + (++uid), name: d.name, color: d.color || PALETTE[S.layers.length % PALETTE.length], opacity: d.opacity ?? 0.55, visible: d.visible ?? true, features: d.features, demo: !!d.demo, src: d.src || '', group: null };
  S.layers.push(L);
  buildLayer(L);
  return L;
}

function removeLayer(L) {
  if (L.group) { world.remove(L.group); disposeGroup(L.group); }
  S.layers.splice(S.layers.indexOf(L), 1);
  S.layers.forEach(buildLayer);
}

function layerCenter(L) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of L.features) eachCoord(f.geometry, c => { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; });
  return isFinite(x0) ? { lon: (x0 + x1) / 2, lat: (y0 + y1) / 2 } : null;
}

function layerNearest(L) {
  let best = Infinity;
  for (const f of L.features) eachCoord(f.geometry, c => { const d = haversine(S.user.lon, S.user.lat, c[0], c[1]); if (d < best) best = d; });
  return best;
}

function computeZRef() {
  let best = Infinity, z = 0;
  for (const L of S.layers) for (const f of L.features) eachCoord(f.geometry, c => {
    if (c.length > 2 && isFinite(c[2])) { const [e, n] = S.enu.fwd(c[0], c[1]); const d = (e - S.user.e) ** 2 + (n - S.user.n) ** 2; if (d < best) { best = d; z = c[2]; } }
  });
  S.zRef = z;
}

function setOrigin(lat, lon) {
  S.enu = makeENU(lat, lon);
  const [e, n] = S.enu.fwd(S.user.lon, S.user.lat);
  S.user.e = e; S.user.n = n;
  S.layers.forEach(buildLayer);
  for (const m of S.measures) m.local = m.pts.map(p => { const [x, y] = S.enu.fwd(p[0], p[1]); return [x, p[2] || 0, -y]; });
  S.cur = S.cur.map(p => { const [x, y] = S.enu.fwd(p.lon, p.lat); const q = [x, p[1], -y]; q.lon = p.lon; q.lat = p.lat; return q; });
  rebuildMeasures();
}

function placeDemo() {
  for (const L of S.layers.filter(l => l.demo)) { if (L.group) { world.remove(L.group); disposeGroup(L.group); } S.layers.splice(S.layers.indexOf(L), 1); }
  const h = S.headingDeg * D2R;
  const e0 = S.user.e - Math.sin(h) * 10 - Math.cos(h) * 2.83, n0 = S.user.n - Math.cos(h) * 10 + Math.sin(h) * 2.83;
  for (const l of demoRoad(S.enu, e0, n0, S.headingDeg)) addLayer({ ...l, demo: true });
  S.layers.forEach(buildLayer);
  renderLayers();
}

// ---------- حفظ البيانات ----------
const DB = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('mirqab', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async set(k, v) { try { const db = await this.open(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch { /* التخزين غير متاح */ } },
  async get(k) { try { const db = await this.open(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch { return undefined; } },
};
let saveT = 0;
function saveLayers() {
  clearTimeout(saveT);
  saveT = setTimeout(() => DB.set('layers', S.layers.filter(l => !l.demo).map(l => ({ name: l.name, color: l.color, opacity: l.opacity, visible: l.visible, features: l.features, src: l.src }))), 150);
}
function saveMeasures() { try { localStorage.setItem('mirqab.measures', JSON.stringify(S.measures.map(m => ({ type: m.type, pts: m.pts, length: m.length, area: m.area, t: m.t })))); } catch { /* لا تخزين */ } }
function savePrefs() { try { localStorage.setItem('mirqab.prefs', JSON.stringify({ eyeH: S.eyeH, fovLong: S.fovLong, crs: $('crs').value, custom: $('crs-custom').value, url: $('ags-url').value })); } catch { /* لا تخزين */ } }

// ---------- واجهة: أدوات عامة ----------
let toastT = 0;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

const SHEETS = { 'tb-layers': 'sh-layers', 'tb-adjust': 'sh-adjust', 'tb-tools': 'sh-tools', 'btn-menu': 'sh-menu' };
function openSheet(id) {
  for (const [b, s] of Object.entries(SHEETS)) {
    const on = s === id && $(s).hidden;
    $(s).hidden = !on;
    $(b).classList.toggle('on', on);
  }
  $('ident').hidden = true;
  if (id === 'sh-layers') renderLayers();
  if (id === 'sh-tools') renderMeasureList();
  if (id === 'sh-adjust') renderAdjust();
}
for (const b of Object.keys(SHEETS)) $(b).onclick = () => openSheet(SHEETS[b]);
document.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => openSheet(null)));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderLayers() {
  const box = $('layer-list');
  if (!S.layers.length) { box.innerHTML = '<p class="hint">لا توجد طبقات. استورد ملفات التصميم من قائمة البيانات.</p>'; return; }
  box.innerHTML = '';
  [...S.layers].reverse().forEach(L => {
    const d = layerNearest(L);
    const row = document.createElement('div');
    row.className = 'layer' + (L.visible ? '' : ' off');
    row.innerHTML = `<button class="ib" data-a="vis" aria-label="إظهار أو إخفاء">${svg(L.visible ? 'eye' : 'eyeoff')}</button>
      <input type="color" value="${L.color}" aria-label="لون الطبقة" id="c-${L.id}">
      <div class="nm">${esc(L.name)}<div class="meta"><span class="num">${L.features.length}</span> عنصر · على بُعد <span class="num">${esc(fmtLen(d))}</span></div></div>
      <div style="display:flex;gap:6px">${S.mode === 'sim' ? `<button class="ib" data-a="go" aria-label="الانتقال إلى الطبقة">${svg('go')}</button>` : ''}<button class="ib" data-a="del" aria-label="حذف الطبقة">${svg('trash')}</button></div>
      <input class="op" type="range" min="0.1" max="1" step="0.05" value="${L.opacity}" aria-label="شفافية الطبقة" id="o-${L.id}">`;
    row.querySelector('[data-a="vis"]').onclick = () => { L.visible = !L.visible; applyLayerStyle(L); renderLayers(); saveLayers(); };
    row.querySelector('[data-a="del"]').onclick = () => { removeLayer(L); renderLayers(); saveLayers(); };
    const go = row.querySelector('[data-a="go"]');
    if (go) go.onclick = () => { const c = layerCenter(L); if (c) { teleport(c.lat, c.lon); renderLayers(); } };
    row.querySelector('input[type="color"]').oninput = e => { L.color = e.target.value; applyLayerStyle(L); saveLayers(); };
    row.querySelector('.op').oninput = e => { L.opacity = +e.target.value; applyLayerStyle(L); saveLayers(); };
    box.appendChild(row);
  });
}

$('z-elev').onchange = e => {
  S.zMode = e.target.checked ? 'elev' : 'flat';
  if (S.zMode === 'elev') computeZRef();
  S.layers.forEach(buildLayer);
};

// ---------- الضبط ----------
function camYawENU() { // اتجاه الكاميرا عكس عقارب الساعة من الشمال، في إطار التصميم
  return -S.headingDeg * D2R;
}

function shift(fwdM, rightM) {
  if (S.mode === 'xr') {
    xrFwd(fwdV);
    S.geo.tx += fwdV.x * fwdM - fwdV.z * rightM;
    S.geo.tz += fwdV.z * fwdM + fwdV.x * rightM;
    setFollow(false);
  } else {
    const h = S.headingDeg * D2R;
    S.adj.e += Math.sin(h) * fwdM + Math.cos(h) * rightM;
    S.adj.n += Math.cos(h) * fwdM - Math.sin(h) * rightM;
  }
  renderAdjust();
}

function rotate(deg) { // موجب = مع عقارب الساعة عند النظر من أعلى
  const d = deg * D2R;
  if (S.mode === 'xr') {
    const [x, z] = rotY(-d, S.geo.tx - xr.pos.x, S.geo.tz - xr.pos.z);
    S.geo.phi -= d; S.geo.tx = xr.pos.x + x; S.geo.tz = xr.pos.z + z;
    setFollow(false);
  } else S.adj.yaw += d;
  renderAdjust();
}

function setFollow(v) {
  S.follow = v;
  $('follow').checked = v;
}

function renderAdjust() {
  const xrm = S.mode === 'xr';
  $('adj-sensor').hidden = xrm;
  $('adj-ground').hidden = !xrm;
  $('follow-t').textContent = xrm ? 'محاذاة تلقائية بـ GPS والبوصلة' : 'تتبّع الموقع بـ GPS';
  const a = S.adj;
  const parts = [];
  if (!xrm) {
    if (Math.abs(a.e) > 1e-3 || Math.abs(a.n) > 1e-3) parts.push(`شرق ${a.e.toFixed(2)} م، شمال ${a.n.toFixed(2)} م`);
    if (Math.abs(a.yaw) > 1e-4) parts.push(`دوران ${(a.yaw * R2D).toFixed(1)}°`);
  }
  if (Math.abs(xrm ? 0 : a.up) > 1e-3) parts.push(`ارتفاع ${a.up.toFixed(2)} م`);
  $('adj-read').textContent = parts.length ? 'الإزاحة الحالية: ' + parts.join(' · ') : xrm ? 'يُحاذى التصميم تلقائياً ما دام خيار المحاذاة مفعّلاً.' : 'بدون إزاحة';
  $('eye-v').textContent = S.eyeH.toFixed(2) + ' م';
  $('fov-v').textContent = S.fovLong + '°';
}

document.querySelectorAll('[data-mv]').forEach(b => (b.onclick = () => { const k = b.dataset.mv, s = S.step; shift(k === 'f' ? s : k === 'b' ? -s : 0, k === 'r' ? s : k === 'l' ? -s : 0); }));
document.querySelectorAll('[data-rot]').forEach(b => (b.onclick = () => rotate(+b.dataset.rot * S.rotStep)));
document.querySelectorAll('[data-up]').forEach(b => (b.onclick = () => { const d = +b.dataset.up * Math.min(S.step, 0.5); if (S.mode === 'xr') S.geo.ty += d; else S.adj.up += d; renderAdjust(); }));
const segPick = (id, fn) => $(id).querySelectorAll('button').forEach(b => (b.onclick = () => { $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); fn(+b.dataset.v); }));
segPick('seg-step', v => (S.step = v));
segPick('seg-rot', v => (S.rotStep = v));
$('follow').onchange = e => { S.follow = e.target.checked; if (S.follow && S.mode === 'xr') { xr.samples.length = 0; xr.phiN = 0; } };
$('eye').oninput = e => { S.eyeH = +e.target.value; renderAdjust(); savePrefs(); };
$('fov').oninput = e => { S.fovLong = +e.target.value; renderAdjust(); resize(); savePrefs(); };
$('adj-reset').onclick = () => { S.adj = { e: 0, n: 0, up: 0, yaw: 0 }; if (S.mode === 'xr') { xr.samples.length = 0; xr.phiN = 0; setFollow(true); } renderAdjust(); toast('أُعيد ضبط موضع التصميم'); };
$('adj-ground').onclick = () => { if (xr.hitY != null) { S.geo.ty = xr.hitY; toast('ثُبّت مستوى الأرض عند المؤشر'); } else toast('وجّه الهاتف نحو الأرض حتى يظهر المؤشر'); };

// ---------- القياس ----------
function makeMeasureGroup(P, closed, alpha = 1) {
  const G = new THREE.Group();
  const acc = { p: [], f: [] }, fill = { p: [], f: [] };
  const line = closed && P.length > 2 ? [...P, P[0]] : P;
  ribbon(acc, line, 0.045, 0, 0.03);
  if (closed && P.length > 2) polygonTris(fill, [P], 0, 0.025);
  const add = (a, color, opacity, order) => {
    if (!a.p.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
    m.renderOrder = order;
    G.add(m);
  };
  add(fill, MEASURE_COLOR, 0.38 * alpha, 400);
  add(acc, '#ffffff', 0.95 * alpha, 401);
  const coneG = new THREE.ConeGeometry(0.06, 0.2, 12);
  coneG.rotateX(Math.PI);
  const coneM = new THREE.MeshBasicMaterial({ color: '#ff4d4f', depthTest: false, transparent: true, opacity: alpha });
  for (const p of P) { const c = new THREE.Mesh(coneG, coneM); c.position.set(p[0], p[1] + 0.13, p[2]); c.renderOrder = 402; G.add(c); }
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const s = makeLabel(fmtLen(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])), '#ffffff', '#10161a');
    s.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.12, (a[2] + b[2]) / 2);
    s.scale.multiplyScalar(0.8);
    s.renderOrder = 403;
    G.add(s);
  }
  return G;
}

function rebuildMeasures() {
  disposeGroup(measG);
  measG.clear();
  for (const m of S.measures) measG.add(makeMeasureGroup(m.local, m.type === 'area', 0.75));
  if (S.cur.length) measG.add(makeMeasureGroup(S.cur, false));
}

// هندسة حيّة تُحدَّث كل إطار: الخط المطاطي والتعبئة المؤقتة
const live = (() => {
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }));
  line.renderOrder = 404; line.frustumCulled = false;
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 9), 3));
  const fill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
  fill.renderOrder = 399; fill.frustumCulled = false;
  liveG.add(line, fill);
  liveG.visible = false;
  return { line, fill };
})();

function measureStats() {
  const P = S.reticle ? [...S.cur, S.reticle.local] : [...S.cur];
  const area = S.tool === 'area';
  return { len: pathLength(P, area && P.length > 2), area: area ? polyArea3(P) : 0, n: P.length };
}

function updateMeasureLive() {
  if (!S.tool) { liveG.visible = false; return; }
  const r = S.reticle, n = S.cur.length;
  $('crosshair').classList.toggle('bad', !r);
  $('m-hint').hidden = !!r && n > 0;
  $('m-hint').textContent = r ? 'اضغط + لتثبيت أول نقطة' : 'وجّه المؤشر نحو الأرض';
  $('m-coord').textContent = r ? `${r.lat.toFixed(6)}  ${r.lon.toFixed(6)}` : '—';
  const st = measureStats();
  $('ro-len').textContent = fmtLen(st.len);
  $('ro-area').textContent = fmtArea(st.area);
  const chip = $('seg-chip');
  if (r && n) {
    const a = S.cur[n - 1], b = r.local;
    chip.hidden = false;
    chip.textContent = fmtLen(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    const p = live.line.geometry.attributes.position;
    p.setXYZ(0, a[0], a[1] + 0.03, a[2]);
    p.setXYZ(1, b[0], b[1] + 0.03, b[2]);
    const closing = S.tool === 'area' && n > 1;
    if (closing) p.setXYZ(2, S.cur[0][0], S.cur[0][1] + 0.03, S.cur[0][2]);
    p.needsUpdate = true;
    live.line.geometry.setDrawRange(0, closing ? 3 : 2);
    live.fill.visible = closing && n < 60;
    if (live.fill.visible) {
      const acc = { p: [], f: [] };
      polygonTris(acc, [[...S.cur, b]], 0, 0.02);
      const fp = live.fill.geometry.attributes.position;
      fp.array.set(acc.p.slice(0, fp.array.length));
      fp.needsUpdate = true;
      live.fill.geometry.setDrawRange(0, Math.min(acc.p.length, fp.array.length) / 3);
    }
    liveG.visible = true;
  } else { chip.hidden = true; liveG.visible = false; }
}

function startTool(tool) {
  S.tool = tool;
  S.cur = [];
  openSheet(null);
  $('measure').hidden = false;
  $('ui').classList.add('measuring');
  $('toolbar').hidden = $('btn-menu').hidden = $('btn-map').hidden = true;
  $('ro-area-box').hidden = tool !== 'area';
  $('ro-len-t').textContent = tool === 'area' ? 'المحيط' : 'المسافة';
  $('m-title').textContent = tool === 'area' ? 'مساحة' : 'مسافة';
  $('m-ic').innerHTML = svg(tool === 'area' ? 'area' : 'ruler');
  rebuildMeasures();
}

function stopTool() {
  S.tool = null;
  S.cur = [];
  $('measure').hidden = true;
  $('ui').classList.remove('measuring');
  $('toolbar').hidden = $('btn-menu').hidden = $('btn-map').hidden = false;
  reticle.visible = false;
  rebuildMeasures();
}

function addPoint() {
  const r = S.reticle;
  if (!r) return toast('وجّه المؤشر نحو الأرض أولاً');
  const p = [...r.local];
  p.lon = r.lon; p.lat = r.lat;
  S.cur.push(p);
  rebuildMeasures();
  if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* غير مدعوم */ }
}

function finishMeasure() {
  const need = S.tool === 'area' ? 3 : 2;
  if (S.cur.length < need) return toast(S.tool === 'area' ? 'ثبّت ثلاث نقاط على الأقل لحساب المساحة' : 'ثبّت نقطتين على الأقل لحساب المسافة');
  const P = S.cur.map(p => [p[0], p[1], p[2]]);
  const m = {
    type: S.tool, local: P, pts: S.cur.map(p => [+p.lon.toFixed(8), +p.lat.toFixed(8), +p[1].toFixed(3)]),
    length: pathLength(P, S.tool === 'area'), area: S.tool === 'area' ? polyArea3(P) : 0, t: Date.now(),
  };
  S.measures.push(m);
  saveMeasures();
  toast(m.type === 'area' ? `حُفظت المساحة: ${fmtArea(m.area)} · المحيط ${fmtLen(m.length)}` : `حُفظت المسافة: ${fmtLen(m.length)}`, 4200);
  S.cur = [];
  rebuildMeasures();
}

function measuresGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: S.measures.map((m, i) => ({
      type: 'Feature',
      properties: { id: i + 1, type: m.type, length_m: +m.length.toFixed(3), area_m2: +m.area.toFixed(3), time: new Date(m.t).toISOString() },
      geometry: m.type === 'area' ? { type: 'Polygon', coordinates: [[...m.pts, m.pts[0]]] } : { type: 'LineString', coordinates: m.pts },
    })),
  };
}

function download(name, blob) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  } catch { return false; }
}

function renderMeasureList() {
  const box = $('m-list');
  $('m-export').hidden = !S.measures.length;
  if (!S.measures.length) { box.innerHTML = '<p class="hint">لا توجد قياسات محفوظة بعد.</p>'; return; }
  box.innerHTML = '';
  S.measures.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mrow';
    const main = m.type === 'area' ? fmtArea(m.area) : fmtLen(m.length);
    const sub = m.type === 'area' ? `المحيط ${fmtLen(m.length)} · ${m.pts.length} نقاط` : `${m.pts.length} نقاط`;
    row.innerHTML = `${svg(m.type === 'area' ? 'area' : 'ruler')}<div class="v"><span class="num">${esc(main)}</span><small><span class="num">${esc(sub)}</span></small></div><button class="ib" aria-label="حذف القياس">${svg('trash')}</button>`;
    row.querySelector('button').onclick = () => { S.measures.splice(i, 1); saveMeasures(); rebuildMeasures(); renderMeasureList(); };
    box.appendChild(row);
  });
}

$('t-area').onclick = () => startTool('area');
$('t-dist').onclick = () => startTool('distance');
$('m-add').onclick = addPoint;
$('m-undo').onclick = () => { if (S.cur.length) { S.cur.pop(); rebuildMeasures(); } };
$('m-done').onclick = finishMeasure;
$('m-close').onclick = stopTool;
$('m-copy').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(measuresGeoJSON(), null, 1)); toast('نُسخت القياسات بصيغة GeoJSON'); } catch { toast('تعذّر النسخ في هذه الصفحة'); } };
$('m-dl').onclick = () => { if (!download('mirqab-measurements.geojson', new Blob([JSON.stringify(measuresGeoJSON(), null, 1)], { type: 'application/geo+json' }))) toast('تعذّر التنزيل. استخدم زر النسخ.'); };
$('m-clear').onclick = () => { S.measures = []; saveMeasures(); rebuildMeasures(); renderMeasureList(); };

$('t-shot').onclick = () => {
  if (S.mode === 'xr') return toast('استخدم لقطة الشاشة من الهاتف في وضع ARCore');
  const W = canvas.width, H = canvas.height, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (S.mode === 'sensor' && video.videoWidth) {
    const s = Math.max(W / video.videoWidth, H / video.videoHeight), w = video.videoWidth * s, h = video.videoHeight * s;
    g.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
  } else { g.fillStyle = '#0e1417'; g.fillRect(0, 0, W, H); }
  renderer.render(scene, camera);
  g.drawImage(canvas, 0, 0);
  g.font = `600 ${Math.round(H / 46)}px ${FONT}`;
  g.fillStyle = 'rgba(0,0,0,.55)';
  const txt = `${S.user.lat.toFixed(6)}, ${S.user.lon.toFixed(6)}  ·  ${Math.round(S.headingDeg)}°  ·  ${new Date().toLocaleString('en-GB')}`;
  g.fillRect(0, H - H / 26, W, H / 26);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.direction = 'ltr';
  g.fillText(txt, H / 70, H - H / 52);
  c.toBlob(b => { if (!b || !download(`mirqab-${Date.now()}.png`, b)) toast('تعذّر حفظ الصورة في هذه الصفحة'); else toast('حُفظت الصورة'); }, 'image/png');
  openSheet(null);
};

// ---------- الاستعلام ----------
function featureMeasure(f) {
  const g = f.geometry, en = c => S.enu.fwd(c[0], c[1]);
  const len = cs => { let s = 0; for (let i = 1; i < cs.length; i++) { const a = en(cs[i - 1]), b = en(cs[i]); s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
  const ar = r => { let s = 0; const P = r.map(en); for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
  const poly = rings => rings.reduce((s, r, i) => s + (i ? -ar(r) : ar(r)), 0);
  if (g.type === 'LineString') return ['الطول المحسوب', fmtLen(len(g.coordinates))];
  if (g.type === 'MultiLineString') return ['الطول المحسوب', fmtLen(g.coordinates.reduce((s, c) => s + len(c), 0))];
  if (g.type === 'Polygon') return ['المساحة المحسوبة', fmtArea(poly(g.coordinates))];
  if (g.type === 'MultiPolygon') return ['المساحة المحسوبة', fmtArea(g.coordinates.reduce((s, p) => s + poly(p), 0))];
  return null;
}

function identify(clientX, clientY) {
  const meshes = [];
  for (const L of S.layers) if (L.visible && L.group) L.group.children.forEach(o => { if (o.isMesh && o.userData.tri) meshes.push(o); });
  const hits = [], ndc = new THREE.Vector2();
  // عدة أشعة حول موضع اللمس حتى يسهل التقاط الخطوط والنقاط الرفيعة
  for (const [ox, oy] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14]]) {
    ndc.set(((clientX + ox) / innerWidth) * 2 - 1, -((clientY + oy) / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const h = raycaster.intersectObjects(meshes, false);
    if (ox || oy) hits.push(...h.filter(x => x.object.renderOrder >= 100)); else hits.push(...h);
  }
  if (!hits.length) { $('ident').hidden = true; return; }
  // الأولوية للنقاط ثم الخطوط ثم المضلعات، ثم للطبقة الأعلى
  hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance);
  const h = hits[0], L = h.object.userData.layer, f = L.features[h.object.userData.tri[h.faceIndex]];
  if (!f) return;
  openSheet(null);
  $('id-chip').style.background = L.color;
  $('id-layer').textContent = L.name;
  const rows = Object.entries(f.properties || {}).filter(([k, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object').slice(0, 14);
  const fm = featureMeasure(f);
  if (fm) rows.push(fm);
  rows.push(['البعد عنك', fmtLen(h.distance)]);
  $('id-rows').innerHTML = rows.map(([k, v]) => `<tr><td>${esc(k === 'label' ? 'الرمز' : k)}</td><td><span class="num">${esc(v)}</span></td></tr>`).join('');
  $('ident').hidden = false;
}
$('id-close').onclick = () => ($('ident').hidden = true);

// ---------- الإدخال: اللمس والمفاتيح وعصا التحكم ----------
{
  const tap = $('tap');
  let down = null;
  tap.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, id: e.pointerId }; tap.setPointerCapture(e.pointerId); });
  tap.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.lx || 0, dy = e.clientY - down.ly || 0;
    if (down.lx !== undefined) {
      down.moved += Math.abs(dx) + Math.abs(dy);
      if (S.mode === 'sim' || (S.mode === 'sensor' && !ori.has)) {
        const k = (camera.fov * D2R) / innerHeight;
        sim.yaw += dx * k;
        sim.pitch = Math.max(-1.45, Math.min(1.2, sim.pitch + dy * k));
      }
    }
    down.lx = e.clientX; down.ly = e.clientY;
  });
  const up = e => {
    if (!down || e.pointerId !== down.id) return;
    const isTap = down.moved < 10 && performance.now() - down.t < 450;
    const { x, y } = down;
    down = null;
    if (isTap && !S.tool) identify(x, y);
  };
  tap.addEventListener('pointerup', up);
  tap.addEventListener('pointercancel', () => (down = null));
  addEventListener('keydown', e => { if (!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) keys[e.key.toLowerCase()] = true; });
  addEventListener('keyup', e => (keys[e.key.toLowerCase()] = false));

  const j = $('joy'), knob = j.firstElementChild;
  let jid = null;
  const set = e => {
    const r = j.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    joy.x = x; joy.y = y;
    knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`;
  };
  j.addEventListener('pointerdown', e => { jid = e.pointerId; j.setPointerCapture(jid); set(e); });
  j.addEventListener('pointermove', e => { if (e.pointerId === jid) set(e); });
  const end = () => { jid = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  j.addEventListener('pointerup', end);
  j.addEventListener('pointercancel', end);
}

// ---------- أوضاع التشغيل ----------
const MODE_NAME = { sim: 'محاكاة', sensor: 'كاميرا وحساسات', xr: 'ARCore' };
function setMode(m) {
  S.mode = m;
  simEnv.visible = m === 'sim';
  video.hidden = m !== 'sensor';
  $('joy').hidden = m !== 'sim';
  $('st-mode').textContent = MODE_NAME[m];
  $('mv-tp-box').hidden = m !== 'sim';
  if (m !== 'sim') $('mv-tp').checked = false;
  resize();
  renderAdjust();
}

function teleport(lat, lon) {
  S.user.lat = lat; S.user.lon = lon;
  setOrigin(lat, lon);
}

function screenAngle() {
  return ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * D2R;
}

function onOri(ev) {
  if (ev.alpha == null) return;
  const absEvt = ev.type === 'deviceorientationabsolute';
  if (absEvt) ori.absSeen = true; else if (ori.absSeen) return; // نفضّل القراءة المرتبطة بالشمال متى توفرت
  ori.has = true;
  ori.abs = absEvt || ev.absolute === true;
  ori.a = ev.alpha; ori.b = ev.beta; ori.g = ev.gamma;
  if (typeof ev.webkitCompassHeading === 'number' && !(ev.webkitCompassAccuracy < 0)) ori.compass = ev.webkitCompassHeading;
}

// اتجاه الجهاز كرباعي في إطار: X شرق، Y أعلى، Z جنوب
function deviceQuat(out) {
  eul.set(ori.b * D2R, ori.a * D2R, -ori.g * D2R, 'YXZ');
  out.setFromEuler(eul).multiply(qScreen).multiply(qTmp.setFromAxisAngle(tmpV2.set(0, 0, 1), -screenAngle()));
  if (!ori.abs && ori.compass != null) { // iOS: ألفا نسبية، نصححها ببطء نحو قراءة البوصلة
    fwdV.set(0, 0, -1).applyQuaternion(out);
    if (Math.abs(fwdV.y) < 0.85) {
      const want = wrapPi(-ori.compass * D2R - Math.atan2(-fwdV.x, -fwdV.z));
      ori.iosYaw = ori.iosYaw == null ? want : ori.iosYaw + wrapPi(want - ori.iosYaw) * 0.015;
    }
  }
  if (ori.iosYaw != null && !ori.abs) out.premultiply(qYaw.setFromAxisAngle(Y_AXIS, ori.iosYaw));
  return out;
}

let sensorsOn = false, watchId = null;
function startSensors() {
  if (sensorsOn) return;
  sensorsOn = true;
  addEventListener('deviceorientationabsolute', onOri);
  addEventListener('deviceorientation', onOri);
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(p => {
      S.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy || 99, t: Date.now(), fresh: true };
      if (S.mode === 'sim') return;
      if (!S.gpsOrigin && S.gps.acc <= 60) {
        S.gpsOrigin = true;
        const onlyDemo = S.layers.every(l => l.demo);
        teleport(S.gps.lat, S.gps.lon);
        xr.anchor = null; xr.samples.length = 0; S.geo.ready = false;
        if (onlyDemo) { placeDemo(); toast('وُضع الطريق التجريبي أمامك. استورد تصميمك من قائمة البيانات.', 5000); }
        renderLayers();
      }
      if (S.gpsOrigin) { const [e, n] = S.enu.fwd(S.gps.lon, S.gps.lat); S.gpsEN = { e, n, acc: S.gps.acc }; }
    }, err => { if (err.code === 1) toast('لم يُسمح بتحديد الموقع. سيبقى التصميم ثابتاً أمامك دون ربط بالإحداثيات.', 5000); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
}

let stream = null;
function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

async function startSensor() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') toast('لم يُسمح بحساسات الحركة. اسحب بإصبعك لتدوير المشهد.', 5000);
    }
  } catch { /* متصفح لا يطلب الإذن */ }
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomedia');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    toast(isSecureContext ? 'تعذّر الوصول إلى الكاميرا. اسمح بإذن الكاميرا ثم أعد المحاولة.' : 'الكاميرا تعمل فقط عند فتح التطبيق من رابط HTTPS.', 6000);
    return false;
  }
  video.srcObject = stream;
  video.hidden = false;
  try { await video.play(); } catch { /* يبدأ عند أول لمسة */ }
  startSensors();
  S.gpsOrigin = false; S.gpsEN = null;
  S.adj = { e: 0, n: 0, up: 0, yaw: 0 };
  setMode('sensor');
  video.addEventListener('loadedmetadata', resize, { once: true });
  setTimeout(() => { if (S.mode === 'sensor' && !ori.has) toast('لا توجد حساسات اتجاه في هذا الجهاز. اسحب لتدوير المشهد.', 5000); }, 3000);
  return true;
}

// وضع ARCore عبر WebXR
const xr = { session: null, hit: null, pos: new THREE.Vector3(), q: new THREE.Quaternion(), yaw: 0, hitY: null, hitP: null, samples: [], phiC: 0, phiN: 0, anchor: null };
function xrFwd(out) { out.set(0, 0, -1).applyQuaternion(xr.q); out.y = 0; return out.normalize(); }

async function startXR() {
  if (!navigator.xr) return toast('هذا المتصفح لا يدعم وضع ARCore. استخدم Chrome على أندرويد.');
  try {
    stopCamera();
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'local-floor'], optionalFeatures: ['dom-overlay'], domOverlay: { root: $('ui') } });
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    xr.session = session;
    xr.hit = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') });
    xr.samples.length = 0; xr.phiN = 0; xr.hitY = null; xr.anchor = null;
    S.geo = { phi: 0, tx: 0, ty: 0, tz: 0, ready: false };
    session.addEventListener('end', () => {
      xr.session = null; xr.hit = null;
      renderer.xr.enabled = false;
      world.position.set(0, 0, 0); world.rotation.y = 0;
      setMode('sim');
      toast('انتهت جلسة ARCore');
    });
    startSensors();
    S.gpsOrigin = false; S.gpsEN = null;
    setFollow(true);
    setMode('xr');
    return true;
  } catch (e) {
    toast('تعذّر تشغيل وضع ARCore: ' + (e && e.message ? e.message : 'غير مدعوم'), 6000);
    return false;
  }
}

async function goMode(m) {
  if (m === S.mode) return;
  if (xr.session && m !== 'xr') { try { await xr.session.end(); } catch { /* انتهت */ } }
  if (m === 'sim') { stopCamera(); setMode('sim'); }
  else if (m === 'sensor') await startSensor();
  else if (m === 'xr') await startXR();
  $('start').hidden = true;
  openSheet(null);
}
$('st-cam').onclick = $('md-cam').onclick = () => goMode('sensor');
$('st-xr').onclick = $('md-xr').onclick = () => goMode('xr');
$('st-sim').onclick = () => { $('start').hidden = true; };
$('md-sim').onclick = () => goMode('sim');

// ---------- استيراد البيانات ----------
function addImported(list, notes = []) {
  for (const L of S.layers.filter(l => l.demo)) removeLayer(L);
  let first = null;
  for (const l of list) { const L = addLayer(l); first = first || L; }
  saveLayers();
  renderLayers();
  const c = first && layerCenter(first), d = first ? layerNearest(first) : 0;
  const count = list.reduce((s, l) => s + l.features.length, 0);
  let msg = `أُضيفت ${list.length} طبقة (${count} عنصر).`;
  if (c && d > 400) {
    if (S.mode === 'sim') { teleport(c.lat, c.lon); msg += ' نُقلت المحاكاة إلى موقع البيانات.'; }
    else msg += ` البيانات تبعد ${fmtLen(d)} عن موقعك.`;
  }
  toast([msg, ...notes].join(' '), 6000);
  if (S.zMode === 'elev') { computeZRef(); S.layers.forEach(buildLayer); }
}

$('imp-btn').onclick = () => $('imp-file').click();
$('imp-file').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  toast('جارٍ قراءة الملفات…', 20000);
  try {
    const r = await parseFiles(files, { crs: $('crs').value, customDef: $('crs-custom').value.trim(), userLon: S.user.lon });
    addImported(r.layers, r.notes);
    openSheet('sh-layers');
  } catch (err) { toast('تعذّر الاستيراد: ' + (err && err.message ? err.message : err), 7000); }
};
$('crs').innerHTML = CRS_PRESETS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
$('crs').onchange = () => { $('crs-custom-box').hidden = $('crs').value !== 'custom'; savePrefs(); };
$('crs-custom').onchange = savePrefs;

$('ags-go').onclick = async () => {
  const url = $('ags-url').value.trim();
  if (!url) return toast('الصق رابط الطبقة أولاً');
  toast('جارٍ تحميل المعالم…', 20000);
  try {
    const list = await fetchArcGIS(url, { token: $('ags-token').value.trim(), lon: S.user.lon, lat: S.user.lat, radius: +$('ags-r').value });
    const got = list.filter(l => l.features.length);
    if (!got.length) return toast('لا توجد معالم ضمن نصف القطر المحدد حول موقعك. كبّر نصف القطر أو تحقق من الرابط.', 6000);
    addImported(got);
    savePrefs();
    openSheet('sh-layers');
  } catch (err) { toast('تعذّر التحميل: ' + (err && err.message ? err.message : err), 7000); }
};
$('demo-go').onclick = () => { placeDemo(); openSheet(null); toast('وُضع الطريق التجريبي أمامك'); };

// ---------- الخريطة ----------
const MV = { z: 18.2, lat: 0, lon: 0, follow: true, cache: new Map(), dirty: true };
const mvProj = (lon, lat, z) => { const s = 256 * 2 ** z, sy = Math.sin(lat * D2R); return [(lon + 180) / 360 * s, (0.5 - Math.log((1 + sy) / (1 - sy)) / (4 * Math.PI)) * s]; };
const mvInv = (x, y, z) => { const s = 256 * 2 ** z; return [x / s * 360 - 180, R2D * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y / s))]; };
function tile(z, x, y) {
  const k = `${z}/${y}/${x}`;
  let im = MV.cache.get(k);
  if (!im) {
    if (MV.cache.size > 260) MV.cache.delete(MV.cache.keys().next().value);
    im = new Image();
    im.onload = () => (MV.dirty = true);
    im.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${k}`;
    MV.cache.set(k, im);
  }
  return im;
}

function drawMap() {
  const c = $('mapc'), W = c.clientWidth, H = c.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1b2226';
  g.fillRect(0, 0, W, H);
  if (MV.follow) { MV.lat = S.user.lat; MV.lon = S.user.lon; }
  const [cx, cy] = mvProj(MV.lon, MV.lat, MV.z);
  const P = c2 => { const [x, y] = mvProj(c2[0], c2[1], MV.z); return [x - cx + W / 2, y - cy + H / 2]; };
  if ($('mv-tiles').checked) {
    const tz = Math.max(1, Math.min(19, Math.round(MV.z))), sc = 2 ** (MV.z - tz), [tx, ty] = mvProj(MV.lon, MV.lat, tz), max = 2 ** tz;
    for (let x = Math.floor((tx - W / 2 / sc) / 256); x <= Math.floor((tx + W / 2 / sc) / 256); x++)
      for (let y = Math.floor((ty - H / 2 / sc) / 256); y <= Math.floor((ty + H / 2 / sc) / 256); y++) {
        if (y < 0 || y >= max) continue;
        const im = tile(tz, ((x % max) + max) % max, y);
        if (im.complete && im.naturalWidth) g.drawImage(im, (x * 256 - tx) * sc + W / 2, (y * 256 - ty) * sc + H / 2, 256 * sc + 0.5, 256 * sc + 0.5);
      }
  } else {
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
    for (let x = (W / 2) % 48; x < W; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = (H / 2) % 48; y < H; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  const path = (cs, close) => { cs.forEach((q, i) => { const [x, y] = P(q); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); if (close) g.closePath(); };
  g.lineJoin = 'round';
  for (const L of S.layers) {
    if (!L.visible) continue;
    g.strokeStyle = g.fillStyle = L.color;
    for (const f of L.features) {
      const t = f.geometry.type, co = f.geometry.coordinates;
      const line = cs => { g.globalAlpha = 1; g.lineWidth = 2; g.beginPath(); path(cs); g.stroke(); };
      const poly = rings => { g.beginPath(); rings.forEach(r => path(r, true)); g.globalAlpha = L.opacity * 0.75; g.fill('evenodd'); g.globalAlpha = 1; g.lineWidth = 1; g.stroke(); };
      const pt = q => { const [x, y] = P(q); g.globalAlpha = 1; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#10161a'; g.stroke(); g.strokeStyle = L.color; };
      if (t === 'Point') pt(co); else if (t === 'MultiPoint') co.forEach(pt);
      else if (t === 'LineString') line(co); else if (t === 'MultiLineString') co.forEach(line);
      else if (t === 'Polygon') poly(co); else if (t === 'MultiPolygon') co.forEach(poly);
      else if (t === 'TIN') {
        g.globalAlpha = 0.6; g.lineWidth = 0.6; g.beginPath();
        const V = f.geometry.vertices, F = f.geometry.faces, stp = Math.max(1, Math.ceil(F.length / 6000));
        for (let i = 0; i < F.length; i += stp) path([V[F[i][0]], V[F[i][1]], V[F[i][2]]], true);
        g.stroke(); g.globalAlpha = 1;
      }
    }
  }
  g.strokeStyle = '#ffffff'; g.fillStyle = MEASURE_COLOR; g.lineWidth = 2;
  for (const m of S.measures) { g.beginPath(); path(m.pts, m.type === 'area'); if (m.type === 'area') { g.globalAlpha = 0.45; g.fill(); g.globalAlpha = 1; } g.stroke(); }
  // موقع المستخدم
  const [ux, uy] = P([S.user.lon, S.user.lat]);
  const mpp = 156543.03392 * Math.cos(S.user.lat * D2R) / 2 ** MV.z;
  if (S.mode !== 'sim' && S.gps) { g.beginPath(); g.arc(ux, uy, Math.max(6, S.gps.acc / mpp), 0, 7); g.fillStyle = 'rgba(61,214,140,.16)'; g.fill(); g.strokeStyle = 'rgba(61,214,140,.7)'; g.lineWidth = 1; g.stroke(); }
  const h = S.headingDeg * D2R;
  g.beginPath(); g.moveTo(ux, uy); g.arc(ux, uy, 54, h - Math.PI / 2 - 0.5, h - Math.PI / 2 + 0.5); g.closePath();
  g.fillStyle = 'rgba(255,178,36,.35)'; g.fill();
  g.beginPath(); g.arc(ux, uy, 8, 0, 7); g.fillStyle = '#ffb224'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  // مقياس الرسم وسهم الشمال
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000].find(v => v / mpp >= 70) || 100000, bw = nice / mpp;
  g.fillStyle = 'rgba(14,20,23,.8)'; g.fillRect(12, H - 46, bw + 16, 26);
  g.fillStyle = '#fff'; g.fillRect(20, H - 28, bw, 3);
  g.font = `600 12px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.direction = 'ltr';
  g.fillText(nice >= 1000 ? nice / 1000 + ' km' : nice + ' m', 20, H - 32);
  MV.dirty = false;
}

{
  const c = $('mapc'), ptrs = new Map();
  let moved = 0, pinch = 0;
  c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0; });
  c.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    moved += Math.abs(dx) + Math.abs(dy);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) {
      if (moved > 6) {
        const [cx, cy] = mvProj(MV.lon, MV.lat, MV.z);
        [MV.lon, MV.lat] = mvInv(cx - dx, cy - dy, MV.z);
        MV.follow = false;
      }
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) MV.z = Math.max(3, Math.min(21, MV.z + Math.log2(d / pinch)));
      pinch = d;
    }
    MV.dirty = true;
  });
  const up = e => {
    const had = ptrs.delete(e.pointerId);
    pinch = 0;
    if (had && moved < 8 && ptrs.size === 0 && $('mv-tp').checked && S.mode === 'sim') {
      const r = c.getBoundingClientRect(), [cx, cy] = mvProj(MV.lon, MV.lat, MV.z);
      const [lon, lat] = mvInv(cx + e.clientX - r.left - r.width / 2, cy + e.clientY - r.top - r.height / 2, MV.z);
      teleport(lat, lon);
      MV.dirty = true;
    }
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  c.addEventListener('wheel', e => { e.preventDefault(); MV.z = Math.max(3, Math.min(21, MV.z - e.deltaY * 0.002)); MV.dirty = true; }, { passive: false });
  $('btn-map').onclick = () => { openSheet(null); $('mapview').hidden = false; MV.follow = true; MV.dirty = true; };
  $('mv-close').onclick = () => ($('mapview').hidden = true);
  $('mv-in').onclick = () => { MV.z = Math.min(21, MV.z + 0.7); MV.dirty = true; };
  $('mv-out').onclick = () => { MV.z = Math.max(3, MV.z - 0.7); MV.dirty = true; };
  $('mv-me').onclick = () => { MV.follow = true; MV.dirty = true; };
  $('mv-tiles').onchange = () => { $('mv-attr').hidden = !$('mv-tiles').checked; MV.dirty = true; };
}

// ---------- حلقة التحديث ----------
function resize() {
  const W = innerWidth, H = innerHeight;
  if (!renderer.xr.isPresenting) renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = S.mode === 'sensor' && video.videoWidth ? coverFov(video.videoWidth, video.videoHeight, W, H, S.fovLong) : 60;
  camera.updateProjectionMatrix();
  MV.dirty = true;
}
addEventListener('resize', resize);
if (screen.orientation) screen.orientation.addEventListener('change', resize);

function updateSim(dt) {
  const sp = keys.shift ? 9 : 3;
  const f = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0) - joy.y;
  const r = (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + joy.x;
  sim.yaw += ((keys.arrowleft || keys.q ? 1 : 0) - (keys.arrowright || keys.e ? 1 : 0)) * 1.4 * dt;
  if (f || r) {
    const s = Math.sin(sim.yaw), c = Math.cos(sim.yaw);
    S.user.e += (-s * f + c * r) * sp * dt;
    S.user.n -= (-c * f - s * r) * sp * dt;
    [S.user.lon, S.user.lat] = S.enu.inv(S.user.e, S.user.n);
  }
  camera.position.set(S.user.e, S.eyeH, -S.user.n);
  camera.rotation.set(sim.pitch, sim.yaw + S.adj.yaw, 0);
  world.position.set(S.adj.e, S.adj.up, -S.adj.n);
  world.rotation.y = 0;
  simEnv.position.set(Math.round(S.user.e / 10) * 10, 0, Math.round(-S.user.n / 10) * 10);
}

function updateSensor(dt) {
  const g = S.gpsEN;
  if (g && S.follow && g.acc <= 30) {
    const d = Math.hypot(g.e - S.user.e, g.n - S.user.n);
    const k = d > 40 ? 1 : 1 - Math.exp(-dt / (g.acc < 6 ? 0.6 : g.acc < 15 ? 1.5 : 4));
    S.user.e += (g.e - S.user.e) * k;
    S.user.n += (g.n - S.user.n) * k;
    [S.user.lon, S.user.lat] = S.enu.inv(S.user.e, S.user.n);
    if (Math.hypot(S.user.e, S.user.n) > 3000) setOrigin(S.user.lat, S.user.lon);
  }
  camera.position.set(S.user.e, S.eyeH, -S.user.n);
  if (ori.has) {
    deviceQuat(qDev);
    qTmp.copy(qYaw.setFromAxisAngle(Y_AXIS, S.adj.yaw)).multiply(qDev);
    // تنعيم خفيف يزيل اهتزاز البوصلة دون تأخير ملحوظ
    if (ori.smooth) camera.quaternion.slerp(qTmp, 1 - Math.exp(-dt / 0.05)); else { camera.quaternion.copy(qTmp); ori.smooth = true; }
  } else camera.rotation.set(sim.pitch, sim.yaw + S.adj.yaw, 0);
  world.position.set(S.adj.e, S.adj.up, -S.adj.n);
  world.rotation.y = 0;
}

function updateXR(frame) {
  if (!frame) return;
  const ref = renderer.xr.getReferenceSpace(), pose = frame.getViewerPose(ref);
  if (!pose) return;
  const p = pose.transform.position, o = pose.transform.orientation;
  xr.pos.set(p.x, p.y, p.z);
  xr.q.set(o.x, o.y, o.z, o.w);
  fwdV.set(0, 0, -1).applyQuaternion(xr.q);
  const level = Math.abs(fwdV.y) < 0.8;
  xr.yaw = Math.atan2(-fwdV.x, -fwdV.z);
  xr.hitP = null;
  if (xr.hit) {
    const hits = frame.getHitTestResults(xr.hit);
    if (hits.length) {
      const hp = hits[0].getPose(ref);
      if (hp) {
        xr.hitP = hp.transform.position;
        const below = xr.pos.y - xr.hitP.y;
        if (below > 0.4 && below < 3) xr.hitY = xr.hitY == null ? xr.hitP.y : xr.hitY + (xr.hitP.y - xr.hitY) * 0.05;
      }
    }
  }
  if (!xr.anchor) { xr.anchor = { a: [S.user.e, -S.user.n], b: [xr.pos.x, xr.pos.z] }; S.geo.ty = 0; }
  if (S.follow) {
    if (ori.has && level) { // اتجاه الشمال من البوصلة
      deviceQuat(qDev);
      tmpV.set(0, 0, -1).applyQuaternion(qDev);
      const want = wrapPi(xr.yaw - Math.atan2(-tmpV.x, -tmpV.z));
      xr.phiC = xr.phiN ? xr.phiC + wrapPi(want - xr.phiC) * 0.03 : want;
      xr.phiN++;
    }
    if (S.gps && S.gps.fresh && S.gpsOrigin && S.gps.acc <= 20) {
      S.gps.fresh = false;
      const [e, n] = S.enu.fwd(S.gps.lon, S.gps.lat);
      xr.samples.push({ a: [e, -n], b: [xr.pos.x, xr.pos.z], w: 1 / (S.gps.acc * S.gps.acc) });
      if (xr.samples.length > 400) xr.samples.shift();
    }
    let phi = xr.phiC, tx, tz;
    const sm = xr.samples;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of sm) { x0 = Math.min(x0, s.b[0]); x1 = Math.max(x1, s.b[0]); z0 = Math.min(z0, s.b[1]); z1 = Math.max(z1, s.b[1]); }
    const fit = sm.length >= 6 && Math.hypot(x1 - x0, z1 - z0) >= 12 ? fitRigid2D(sm) : null; // مسار مشي كافٍ: نحسب الاتجاه من GPS نفسه
    if (fit) { phi = fit.phi; tx = fit.tx; tz = fit.tz; }
    else {
      const use = sm.length ? sm : [{ ...xr.anchor, w: 1 }];
      let W = 0; tx = 0; tz = 0;
      for (const s of use) { const [rx, rz] = rotY(phi, s.a[0], s.a[1]); tx += s.w * (s.b[0] - rx); tz += s.w * (s.b[1] - rz); W += s.w; }
      tx /= W; tz /= W;
    }
    const k = S.geo.ready ? 0.08 : 1;
    S.geo.phi += wrapPi(phi - S.geo.phi) * k;
    S.geo.tx += (tx - S.geo.tx) * k;
    S.geo.tz += (tz - S.geo.tz) * k;
    if (xr.hitY != null) S.geo.ty += (xr.hitY - S.geo.ty) * 0.05;
    S.geo.ready = true;
  }
  world.position.set(S.geo.tx, S.geo.ty, S.geo.tz);
  world.rotation.y = S.geo.phi;
  const [ue, uz] = rotY(-S.geo.phi, xr.pos.x - S.geo.tx, xr.pos.z - S.geo.tz);
  S.user.e = ue; S.user.n = -uz;
  [S.user.lon, S.user.lat] = S.enu.inv(ue, -uz);
}

function updateReticle() {
  let hit = null;
  if (S.tool) {
    if (S.mode === 'xr') { if (xr.hitP) hit = tmpV.set(xr.hitP.x, xr.hitP.y, xr.hitP.z); }
    else {
      camera.getWorldDirection(fwdV);
      if (fwdV.y < -0.03) {
        const t = camera.position.y / -fwdV.y;
        if (t < 90) hit = tmpV.copy(camera.position).addScaledVector(fwdV, t);
      }
    }
  }
  if (!hit) { reticle.visible = false; S.reticle = null; return; }
  reticle.visible = true;
  reticle.position.copy(hit);
  reticle.position.y += 0.02;
  const d = hit.distanceTo(S.mode === 'xr' ? xr.pos : camera.position);
  reticle.scale.setScalar(Math.max(1, d / 2.5));
  const l = world.worldToLocal(tmpV2.copy(hit));
  const [lon, lat] = S.enu.inv(l.x, -l.z);
  S.reticle = { local: [l.x, l.y, l.z], lon, lat };
}

let hudT = 0;
function updateHUD(now) {
  // الاتجاه في إطار التصميم
  if (S.mode === 'xr') S.headingDeg = (((-(xr.yaw - S.geo.phi)) * R2D) % 360 + 360) % 360;
  else { camera.getWorldDirection(fwdV); S.headingDeg = (Math.atan2(fwdV.x, -fwdV.z) * R2D + 360) % 360; }
  if (now - hudT < 200) return;
  hudT = now;
  const dirs = ['ش', 'ش ق', 'ق', 'ج ق', 'ج', 'ج غ', 'غ', 'ش غ'];
  $('st-head').textContent = `${dirs[Math.round(S.headingDeg / 45) % 8]} ${Math.round(S.headingDeg) % 360}°`;
  const dot = $('st-dot');
  if (S.mode === 'sim') { dot.className = 'dot'; $('st-acc').textContent = `${S.user.lat.toFixed(5)}, ${S.user.lon.toFixed(5)}`; }
  else if (!S.gps) { dot.className = 'dot bad'; $('st-acc').textContent = 'بانتظار GPS'; }
  else {
    const a = S.gps.acc, stale = Date.now() - S.gps.t > 45000;
    dot.className = 'dot ' + (stale || a > 20 ? 'bad' : a > 8 ? 'warn' : 'ok');
    $('st-acc').textContent = stale ? 'انقطع GPS' : `± ${a < 10 ? a.toFixed(1) : Math.round(a)} م`;
  }
  // إخفاء التسميات البعيدة
  const cp = S.mode === 'xr' ? xr.pos : camera.position;
  for (const L of S.layers) if (L.group && L.visible) for (const s of L.group.userData.labels || []) s.visible = s.getWorldPosition(tmpV2).distanceTo(cp) < 45;
  if (!$('mapview').hidden) MV.dirty = true;
}

let last = performance.now();
renderer.setAnimationLoop((t, frame) => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.mode === 'sim') updateSim(dt);
  else if (S.mode === 'sensor') updateSensor(dt);
  else updateXR(frame);
  world.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  updateReticle();
  updateMeasureLive();
  updateHUD(now);
  renderer.render(scene, camera);
  if (!$('mapview').hidden && MV.dirty) drawMap();
});

// ---------- التشغيل ----------
async function init() {
  try {
    const p = JSON.parse(localStorage.getItem('mirqab.prefs') || '{}');
    if (p.eyeH) { S.eyeH = p.eyeH; $('eye').value = p.eyeH; }
    if (p.fovLong) { S.fovLong = p.fovLong; $('fov').value = p.fovLong; }
    if (p.crs) $('crs').value = p.crs;
    if (p.custom) $('crs-custom').value = p.custom;
    if (p.url) $('ags-url').value = p.url;
    $('crs-custom-box').hidden = $('crs').value !== 'custom';
    for (const m of JSON.parse(localStorage.getItem('mirqab.measures') || '[]')) S.measures.push({ ...m, local: [] });
  } catch { /* لا تخزين */ }
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]); } catch { /* لا خطوط */ }
  const saved = await DB.get('layers');
  if (saved && saved.length) {
    for (const l of saved) addLayer(l);
    const c = layerCenter(S.layers[0]);
    if (c) teleport(c.lat, c.lon);
  } else placeDemo();
  setOrigin(S.user.lat, S.user.lon);
  setMode('sim');
  renderLayers();

  const fp = document.featurePolicy || document.permissionsPolicy;
  const camOK = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && isSecureContext && (!fp || !fp.allowsFeature || fp.allowsFeature('camera'));
  if (!camOK) {
    $('st-note').hidden = false;
    $('st-note').textContent = 'هذه الصفحة لا تتيح الكاميرا وتحديد الموقع، لذا تعمل هنا بوضع المحاكاة. للواقع المعزز افتح التطبيق على الجوال من رابط HTTPS.';
    $('st-cam').hidden = true;
    $('st-sim').classList.add('pri');
    $('md-cam').disabled = true;
  }
  if (navigator.xr && navigator.xr.isSessionSupported && (!fp || !fp.allowsFeature || fp.allowsFeature('xr-spatial-tracking'))) {
    try { if (await navigator.xr.isSessionSupported('immersive-ar')) { $('st-xr').hidden = false; $('md-xr').hidden = false; $('st-xr').classList.add('pri'); $('st-cam').classList.remove('pri'); } } catch { /* غير مدعوم */ }
  }
  try { if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* غير متاح داخل إطار معزول */ }
}
init();

// منفذ للاختبارات الآلية
window.__mirqab = { S, sim, ori, xr, camera, world, addPoint, finishMeasure, startTool, stopTool, identify, teleport, placeDemo, setMode, goMode, MV, updateXR, rotate, shift, setFollow };
