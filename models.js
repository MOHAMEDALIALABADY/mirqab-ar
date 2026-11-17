// مجسمات ثلاثية الأبعاد واقعية للعناصر النقطية (as-built): مصيدة سيول، منهل، عمود إنارة، وأنابيب تحت الأرض.
// تُبنى القوالب مرة واحدة وتُنسخ لكل عنصر (الهندسة والمواد مشتركة).
import * as THREE from './vendor/three.module.min.js';

const MODEL_ORDER = 250;

// ---------- التصنيف ----------
const RX = {
  cb: /(^|[^a-z])(cb|gully|inlet|catch ?basin)([^a-z]|$)|مصيد|مصائد|بالوعة|فتحة تصريف/i,
  mh: /(^|[^a-z])(mh|manhole|man hole|inspection chamber)([^a-z]|$)|منهل|مناهل|غرفة تفتيش|غرف تفتيش/i,
  lp: /(^|[^a-z])(lp|light ?pole|street ?light|lighting|lamp)([^a-z]|$)|إنارة|انارة|عمود إنارة|أعمدة الإنارة/i,
  mast: /(^|[^a-z])(hm|high ?mast|mast)([^a-z]|$)|صاري|صواري|سارية|ساريات|برج إنارة|أبراج إنارة/i,
  sta: /(^|[^a-z])(station|chainage|sta|km ?post)([^a-z]|$)|محطة|محطات|كيلو|علامة مسافة/i,
  pipe: /(^|[^a-z])(pipe|storm|sewer|drain|culvert)([^a-z]|$)|أنبوب|انبوب|خط تصريف|خطوط تصريف|صرف|مواسير|ماسورة/i,
};

function textOf(props, layerName) {
  const p = props || {};
  const parts = [layerName || ''];
  for (const k of ['label', 'name', 'Name', 'الاسم', 'النوع', 'type', 'TYPE', 'code', 'CODE', 'البلوك', 'طبقة CAD', 'العنصر', 'الوصف', 'description', 'رقم المصيدة', 'layer', 'Layer', 'FEATURECODE', 'AssetType', 'ASSET_TYPE']) {
    if (p[k] != null && p[k] !== '') parts.push(String(p[k]));
  }
  return parts.join(' | ');
}

// النوع النقطي: يُقدَّم المنهل على المصيدة إن وُجد الاثنان، ثم الإنارة
export function classifyPoint(props, layerName) {
  const t = textOf(props, layerName);
  const code = String((props && (props.label || props['البلوك'] || props.code || props['رقم المصيدة'])) || '').trim().toUpperCase();
  if (/^MH\b|^MH-|^MH\d/.test(code)) return 'mh';
  if (/^CB\b|^CB-|^CB\d|^GI\b/.test(code)) return 'cb';
  if (/^HM\b|^HM-|^HM\d/.test(code)) return 'mast';
  if (/^LP\b|^LP-|^LP\d|^SL\b/.test(code)) return 'lp';
  if (/^\d+\+\d{2,3}(\.\d+)?$/.test(code)) return 'sta';
  if (RX.mh.test(t)) return 'mh';
  if (RX.cb.test(t)) return 'cb';
  if (RX.mast.test(t)) return 'mast';
  if (RX.lp.test(t)) return 'lp';
  if (RX.sta.test(layerName || '')) return 'sta';
  return null;
}

export function classifyLine(props, layerName) {
  const t = textOf(props, layerName);
  if (RX.cb.test(t) && !RX.pipe.test(t)) return null;
  return RX.pipe.test(t) ? 'pipe' : null;
}

function num(props, keys, def) {
  for (const k of keys) {
    const v = props && props[k];
    if (v != null && v !== '' && isFinite(parseFloat(v))) return parseFloat(v);
  }
  return def;
}

// ---------- القوام (canvas) ----------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function noise(g, w, h, n, base, spread, alpha) {
  let s = 11;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const v = base + (r() - 0.5) * spread | 0;
    g.fillStyle = `rgba(${v},${v},${v - 4},${alpha})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5);
  }
}

let T = null;
function textures() {
  if (T) return T;
  T = {};
  T.concrete = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#a9a69e'; g.fillRect(0, 0, w, h); noise(g, w, h, 5000, 168, 70, 0.35); }, [2, 2]);
  T.grate = canvasTex(512, 288, (g, w, h) => {
    g.fillStyle = '#26282a'; g.fillRect(0, 0, w, h);
    // فتحات الشبكة: قضبان متوازية مع عارضتين
    g.fillStyle = '#060707';
    const bars = 13, bw = (w - 60) / bars;
    for (let i = 0; i < bars; i++) {
      for (const [y0, y1] of [[22, h / 2 - 12], [h / 2 + 12, h - 22]]) g.fillRect(30 + i * bw + 7, y0, bw - 14, y1 - y0);
    }
    noise(g, w, h, 2500, 70, 50, 0.25);
    g.strokeStyle = '#3c3f42'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  });
  T.cover = canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    const rg = g.createRadialGradient(c, c, 20, c, c, c);
    rg.addColorStop(0, '#3a3c3e'); rg.addColorStop(1, '#232527');
    g.fillStyle = rg; g.fillRect(0, 0, w, w);
    // نمط بارز معيّن
    g.strokeStyle = 'rgba(95,98,102,.85)'; g.lineWidth = 6;
    for (let k = -w; k < 2 * w; k += 34) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + w, w); g.stroke(); g.beginPath(); g.moveTo(k, w); g.lineTo(k + w, 0); g.stroke(); }
    g.globalCompositeOperation = 'destination-in';
    g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    for (const [r, lw] of [[c - 10, 14], [c - 70, 8]]) { g.strokeStyle = '#4d5054'; g.lineWidth = lw; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#26282a'; g.beginPath(); g.arc(c, c, 105, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7d8186'; g.font = 'bold 44px Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STORM', c, c - 26); g.font = 'bold 40px Tahoma, sans-serif'; g.fillText('تصريف', c, c + 30);
    for (const a of [0.3, 3.44]) { g.fillStyle = '#121314'; g.fillRect(c + Math.cos(a) * (c - 52) - 16, c + Math.sin(a) * (c - 52) - 6, 32, 12); }
  });
  T.galv = canvasTex(64, 256, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, '#8d9396'); lg.addColorStop(0.45, '#c8cdd0'); lg.addColorStop(1, '#7c8285');
    g.fillStyle = lg; g.fillRect(0, 0, w, h); noise(g, w, h, 600, 170, 40, 0.2);
  });
  return T;
}

// ---------- المواد ----------
let M = null;
function materials() {
  if (M) return M;
  const t = textures();
  // كل المواد في ممر الشفافية (بعتامة كاملة) حتى تُرسم بعد طبقات التصميم الملوّنة حسب renderOrder
  const shared = m => { m.userData.shared = true; if (!m.transparent) { m.transparent = true; m.opacity = 1; m.depthWrite = true; } return m; };
  M = {
    concrete: shared(new THREE.MeshStandardMaterial({ map: t.concrete, roughness: 0.95, metalness: 0 })),
    iron: shared(new THREE.MeshStandardMaterial({ color: 0x2c2f31, roughness: 0.55, metalness: 0.6 })),
    grate: shared(new THREE.MeshStandardMaterial({ map: t.grate, roughness: 0.5, metalness: 0.65 })),
    cover: shared(new THREE.MeshStandardMaterial({ map: t.cover, roughness: 0.5, metalness: 0.6 })),
    galv: shared(new THREE.MeshStandardMaterial({ map: t.galv, roughness: 0.38, metalness: 0.75 })),
    lumBody: shared(new THREE.MeshStandardMaterial({ color: 0x4a4f54, roughness: 0.45, metalness: 0.55 })),
    lumGlass: shared(new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff1c4, emissiveIntensity: 0.9, roughness: 0.2 })),
    // ما تحت الأرض يُعرض شفافاً (رؤية بالأشعة)
    xConcrete: shared(new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide })),
    xPipe: shared(new THREE.MeshStandardMaterial({ color: 0x8fa3b0, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false })),
    xRung: shared(new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.5, transparent: true, opacity: 0.6, depthWrite: false })),
  };
  return M;
}

// ---------- القوالب ----------
const shareGeo = g => { g.userData.shared = true; return g; };
const part = (geo, mat, x = 0, y = 0, z = 0, under = false) => {
  const m = new THREE.Mesh(shareGeo(geo), mat);
  m.position.set(x, y, z);
  m.userData.model = true;
  m.userData.under = under;
  m.renderOrder = MODEL_ORDER + (under ? -5 : 0);
  return m;
};

let TPL = null;
function templates() {
  if (TPL) return TPL;
  const m = materials();
  TPL = {};

  // مصيدة سيول جانبية: شبكة حديد مصبوب 0.9×0.5 م على إطار خرساني، وغرفة 1.0×0.6×1.2 م ومخرج 300 مم
  {
    const g = new THREE.Group();
    const frame = new THREE.Shape([new THREE.Vector2(-0.6, -0.4), new THREE.Vector2(0.6, -0.4), new THREE.Vector2(0.6, 0.4), new THREE.Vector2(-0.6, 0.4)]);
    frame.holes.push(new THREE.Path([new THREE.Vector2(-0.46, -0.26), new THREE.Vector2(-0.46, 0.26), new THREE.Vector2(0.46, 0.26), new THREE.Vector2(0.46, -0.26)]));
    const fg = new THREE.ExtrudeGeometry(frame, { depth: 0.08, bevelEnabled: false });
    fg.rotateX(-Math.PI / 2);
    g.add(part(fg, m.concrete, 0, -0.06, 0));
    const grate = new THREE.BoxGeometry(0.9, 0.035, 0.5);
    g.add(part(grate, [m.iron, m.iron, m.grate, m.iron, m.iron, m.iron], 0, -0.005, 0));
    // الغرفة تحت الأرض
    g.add(part(new THREE.BoxGeometry(1.0, 1.2, 0.6), m.xConcrete, 0, -0.64, 0, true));
    const out = new THREE.CylinderGeometry(0.15, 0.15, 1.6, 20, 1, true);
    out.rotateX(Math.PI / 2);
    g.add(part(out, m.xPipe, 0, -1.0, 1.1, true));
    TPL.cb = g;
  }

  // منهل: غطاء دائري 0.65 م، إطار حديد، طوق خرساني، وبئر قطرها 1.2 م بسلّم
  {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.72, 0.75, 0.1, 40), m.concrete, 0, -0.045, 0));
    const ring = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 40, 1, true);
    g.add(part(ring, m.iron, 0, 0.0, 0));
    const rim = new THREE.RingGeometry(0.33, 0.42, 40);
    rim.rotateX(-Math.PI / 2);
    g.add(part(rim, m.iron, 0, 0.018, 0));
    const cover = new THREE.CylinderGeometry(0.33, 0.33, 0.03, 48);
    g.add(part(cover, [m.iron, m.cover, m.iron], 0, 0.012, 0));
    // البئر (بعمق افتراضي 2 م، يُضبط بالمقياس)
    const shaft = new THREE.CylinderGeometry(0.6, 0.6, 1, 32, 1, true);
    const sh = part(shaft, m.xConcrete, 0, -0.5, 0, true);
    sh.name = 'shaft';
    g.add(sh);
    const base = new THREE.CircleGeometry(0.6, 32);
    base.rotateX(-Math.PI / 2);
    const bs = part(base, m.xConcrete, 0, -1, 0, true);
    bs.name = 'base';
    g.add(bs);
    const rung = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8);
    rung.rotateZ(Math.PI / 2);
    const rungs = new THREE.Group();
    rungs.name = 'rungs';
    for (let i = 0; i < 12; i++) rungs.add(part(rung, m.xRung, 0, -0.35 - i * 0.3, -0.52, true));
    g.add(rungs);
    TPL.mh = g;
  }

  // عمود إنارة مزدوج مجلفن: قاعدة خرسانية، عمود مخروطي، ذراعان، كشافان
  {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.32, 0.36, 0.25, 24), m.concrete, 0, 0.125, 0));
    g.add(part(new THREE.BoxGeometry(0.34, 0.025, 0.34), m.galv, 0, 0.26, 0));
    const pole = new THREE.CylinderGeometry(0.055, 0.1, 1, 16);
    pole.translate(0, 0.5, 0);
    const p = part(pole, m.galv, 0, 0.27, 0);
    p.name = 'pole';
    g.add(p);
    const arms = new THREE.Group();
    arms.name = 'arms';
    for (const s of [1, -1]) {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(s * 0.15, 0.25, 0), new THREE.Vector3(s * 1.9, 0.35, 0));
      arms.add(part(new THREE.TubeGeometry(curve, 16, 0.035, 8, false), m.galv));
      const head = new THREE.BoxGeometry(0.62, 0.11, 0.3);
      arms.add(part(head, m.lumBody, s * 2.15, 0.33, 0));
      const glass = new THREE.BoxGeometry(0.5, 0.02, 0.22);
      arms.add(part(glass, m.lumGlass, s * 2.15, 0.27, 0));
    }
    g.add(arms);
    TPL.lp = g;
  }

  // صاري إنارة عالٍ: قاعدة خرسانية، عمود مضلع مخروطي، وحلقة علوية عليها 8 كشافات
  {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.9, 1.0, 0.4, 8), m.concrete, 0, 0.2, 0));
    g.add(part(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 8), m.galv, 0, 0.42, 0));
    const pole = new THREE.CylinderGeometry(0.17, 0.42, 1, 12);
    pole.translate(0, 0.5, 0);
    const p = part(pole, m.galv, 0, 0.44, 0);
    p.name = 'pole';
    g.add(p);
    const top = new THREE.Group();
    top.name = 'top';
    const ring = new THREE.TorusGeometry(1.1, 0.06, 8, 32);
    ring.rotateX(Math.PI / 2);
    top.add(part(ring, m.galv));
    top.add(part(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12), m.lumBody, 0, 0.1, 0));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, x = Math.cos(a) * 1.1, z = Math.sin(a) * 1.1;
      const head = part(new THREE.BoxGeometry(0.42, 0.42, 0.14), m.lumBody, x, -0.05, z);
      head.lookAt(x * 3, -6, z * 3);
      top.add(head);
      const gl = part(new THREE.CircleGeometry(0.16, 16), m.lumGlass, x * 1.07, -0.12, z * 1.07);
      gl.lookAt(x * 3, -6, z * 3);
      top.add(gl);
      const spoke = new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6);
      spoke.rotateZ(Math.PI / 2);
      const sp = part(spoke, m.galv, x / 2, 0, z / 2);
      sp.rotation.y = -a;
      top.add(sp);
    }
    g.add(top);
    TPL.mast = g;
  }

  // علامة محطة (كيلومترية): عمود خرساني أبيض 1 م برأس أحمر
  {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8, transparent: true, opacity: 1 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8322f, roughness: 0.7, transparent: true, opacity: 1 });
    white.userData.shared = red.userData.shared = true;
    g.add(part(new THREE.BoxGeometry(0.16, 0.85, 0.16), white, 0, 0.425, 0));
    g.add(part(new THREE.BoxGeometry(0.17, 0.15, 0.17), red, 0, 0.92, 0));
    g.add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16), m.concrete, 0, 0.0, 0));
    TPL.sta = g;
  }
  return TPL;
}

// إنشاء نسخة من المجسم في موضع v=[x,y,z] واتجاه yaw (راديان حول المحور الرأسي)
export function makeModel(kind, v, yaw, props) {
  const tpl = templates()[kind];
  if (!tpl) return null;
  const g = tpl.clone(true);
  g.position.set(v[0], v[1], v[2]);
  g.rotation.y = yaw || 0;
  g.userData.kind = kind;
  if (kind === 'mh') {
    const depth = Math.max(0.8, Math.min(8, num(props, ['العمق (م)', 'العمق', 'depth', 'DEPTH', 'Depth', 'INVERT_DEPTH'], 2.0)));
    const sh = g.getObjectByName('shaft'); sh.scale.y = depth; sh.position.y = -depth / 2;
    g.getObjectByName('base').position.y = -depth;
    g.getObjectByName('rungs').children.forEach((r, i) => { r.visible = 0.35 + i * 0.3 < depth - 0.2; });
  }
  if (kind === 'mast') {
    const h = Math.max(12, Math.min(50, num(props, ['الارتفاع (م)', 'الارتفاع', 'height', 'HEIGHT', 'Height'], 30)));
    g.getObjectByName('pole').scale.y = h - 0.44;
    g.getObjectByName('top').position.y = h;
  }
  if (kind === 'lp') {
    const h = Math.max(4, Math.min(20, num(props, ['الارتفاع (م)', 'الارتفاع', 'height', 'HEIGHT', 'Height'], 12)));
    g.getObjectByName('pole').scale.y = h - 0.27;
    g.getObjectByName('arms').position.y = h;
  }
  return g;
}

// ارتفاع التسمية فوق المجسم
export function labelHeight(kind, props) {
  if (kind === 'lp') return Math.max(4, Math.min(20, num(props, ['الارتفاع (م)', 'الارتفاع', 'height', 'HEIGHT', 'Height'], 12))) + 1.0;
  if (kind === 'mast') return Math.max(12, Math.min(50, num(props, ['الارتفاع (م)', 'الارتفاع', 'height', 'HEIGHT', 'Height'], 30))) + 1.5;
  if (kind === 'mh' || kind === 'cb') return 1.1;
  if (kind === 'sta') return 1.4;
  return 1.95;
}

// صندوق التقاط غير مرئي للاستعلام باللمس
export function hitBox(acc, kind, v, yaw, props, fi) {
  const dims = { cb: [1.3, 0.9, 0.9], mh: [1.6, 0.9, 1.6], lp: [1.2, 0, 1.2], mast: [2.4, 0, 2.4], sta: [0.6, 1.2, 0.6] }[kind];
  const h = kind === 'lp' || kind === 'mast' ? labelHeight(kind, props) : dims[1];
  const [sx, , sz] = dims, c = Math.cos(yaw), s = Math.sin(yaw);
  const corner = (dx, dz) => [v[0] + dx * c + dz * s, v[2] - dx * s + dz * c];
  const y0 = v[1] - 0.2, y1 = v[1] + h;
  const P = [corner(-sx / 2, -sz / 2), corner(sx / 2, -sz / 2), corner(sx / 2, sz / 2), corner(-sx / 2, sz / 2)];
  const quad = (a, b, cc, d) => { acc.p.push(...a, ...b, ...cc, ...a, ...cc, ...d); acc.f.push(fi, fi); };
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4];
    quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
  }
  quad([P[0][0], y1, P[0][1]], [P[1][0], y1, P[1][1]], [P[2][0], y1, P[2][1]], [P[3][0], y1, P[3][1]]);
}

// أنبوب تحت الأرض على مسار نقاط محلية
export function makePipe(P, props) {
  const dmm = num(props, ['القطر (مم)', 'القطر', 'diameter', 'DIAMETER', 'DIA', 'Diameter'], 600);
  const r = Math.max(0.05, Math.min(1.5, dmm / 2000));
  const depth = num(props, ['العمق (م)', 'العمق', 'depth', 'DEPTH'], 1.5);
  const pts = [];
  for (const p of P) { const q = new THREE.Vector3(p[0], p[1] - depth, p[2]); if (!pts.length || pts[pts.length - 1].distanceTo(q) > 0.05) pts.push(q); }
  if (pts.length < 2) return null;
  const path = new THREE.CurvePath();
  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
  const segs = Math.min(2000, Math.max(8, pts.length * 2));
  const geo = new THREE.TubeGeometry(path, segs, r, 14, false);
  const m = new THREE.Mesh(geo, materials().xPipe);
  m.userData.model = true;
  m.userData.under = true;
  m.renderOrder = MODEL_ORDER - 6;
  return m;
}

// إضاءة المشهد للمجسمات (مرة واحدة)
export function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x8a7d66, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-40, 80, 30);
  scene.add(hemi, sun);
}
