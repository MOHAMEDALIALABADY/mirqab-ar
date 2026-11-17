// قراءة ملفات التصميم وتحويلها إلى معالم GeoJSON بإحداثيات WGS84.
// الأنواع: GeoJSON، KML/KMZ، Shapefile، DXF، LandXML، وطبقات ArcGIS (Feature Layer).
// نوع هندسي إضافي داخلي: {type:'TIN', vertices:[[x,y,z]], faces:[[a,b,c]]} لأسطح المثلثات.

const D2R = Math.PI / 180;
const utm = z => `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`;
const ain = z => `+proj=utm +zone=${z} +ellps=intl +towgs84=-143,-236,7,0,0,0,0 +units=m +no_defs`;

export const CRS_PRESETS = [
  { id: 'auto', name: 'تلقائي (حسب موقعي)' },
  { id: 'wgs84', name: 'WGS84 جغرافي (طول/عرض)', def: '+proj=longlat +datum=WGS84 +no_defs' },
  { id: 'utm37', name: 'UTM 37N (WGS84 / KSA-GRF17)', def: utm(37) },
  { id: 'utm38', name: 'UTM 38N (WGS84 / KSA-GRF17)', def: utm(38) },
  { id: 'utm39', name: 'UTM 39N (WGS84 / KSA-GRF17)', def: utm(39) },
  { id: 'utm40', name: 'UTM 40N (WGS84 / KSA-GRF17)', def: utm(40) },
  { id: 'ain37', name: 'عين العبد 1970 / UTM 37N (تقريبي)', def: ain(37) },
  { id: 'ain38', name: 'عين العبد 1970 / UTM 38N (تقريبي)', def: ain(38) },
  { id: 'ain39', name: 'عين العبد 1970 / UTM 39N (تقريبي)', def: ain(39) },
  { id: 'custom', name: 'تعريف PROJ مخصص' },
];

export function mapCoords(g, fn) {
  const m = c => fn(c);
  switch (g.type) {
    case 'Point': return { ...g, coordinates: m(g.coordinates) };
    case 'MultiPoint': case 'LineString': return { ...g, coordinates: g.coordinates.map(m) };
    case 'MultiLineString': case 'Polygon': return { ...g, coordinates: g.coordinates.map(r => r.map(m)) };
    case 'MultiPolygon': return { ...g, coordinates: g.coordinates.map(p => p.map(r => r.map(m))) };
    case 'TIN': return { ...g, vertices: g.vertices.map(m) };
    default: return g;
  }
}

export function eachCoord(g, fn) {
  mapCoords(g, c => { fn(c); return c; });
}

function firstCoord(features) {
  for (const f of features) {
    let c = null;
    eachCoord(f.geometry, x => { if (!c) c = x; });
    if (c) return c;
  }
  return null;
}

function looksProjected(features) {
  const c = firstCoord(features);
  return !!c && (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90);
}

function resolveCRS(opts, notes) {
  const id = opts.crs || 'auto';
  if (id === 'custom') {
    if (!opts.customDef) throw new Error('اكتب تعريف PROJ للنظام الإحداثي المخصص.');
    return opts.customDef;
  }
  if (id === 'auto') {
    const zone = Math.floor(((opts.userLon ?? 46.7) + 180) / 6) + 1;
    notes.push(`افتُرض النظام الإحداثي UTM ${zone}N (WGS84). غيّره من قائمة النظام الإحداثي إن لم يكن صحيحاً.`);
    return utm(zone);
  }
  return CRS_PRESETS.find(p => p.id === id).def;
}

function reproject(features, def) {
  const tr = self.proj4(def, 'WGS84');
  return features.map(f => ({
    ...f,
    geometry: mapCoords(f.geometry, c => {
      const p = tr.forward([c[0], c[1]]);
      return c.length > 2 && isFinite(c[2]) ? [p[0], p[1], c[2]] : [p[0], p[1]];
    }),
  }));
}

function toWGS(features, opts, notes, forceProjected = false) {
  if (!features.length) return features;
  if (forceProjected || looksProjected(features)) {
    if ((opts.crs || 'auto') === 'wgs84') return features;
    return reproject(features, resolveCRS(opts, notes));
  }
  return features;
}

// ---------- GeoJSON ----------
export function fromGeoJSON(obj) {
  let feats = [];
  if (obj.type === 'FeatureCollection') feats = obj.features || [];
  else if (obj.type === 'Feature') feats = [obj];
  else if (obj.type === 'GeometryCollection') feats = obj.geometries.map(g => ({ type: 'Feature', properties: {}, geometry: g }));
  else if (obj.coordinates) feats = [{ type: 'Feature', properties: {}, geometry: obj }];
  else throw new Error('الملف ليس GeoJSON صالحاً.');
  const out = [];
  for (const f of feats) {
    if (!f || !f.geometry) continue;
    const props = f.properties || {};
    if (f.geometry.type === 'GeometryCollection') for (const g of f.geometry.geometries) out.push({ type: 'Feature', properties: props, geometry: g });
    else out.push({ type: 'Feature', properties: props, geometry: f.geometry });
  }
  return out;
}

// ---------- KML ----------
const kids = (el, name) => [...el.children].filter(c => c.localName === name);
const kid = (el, name) => kids(el, name)[0];
const kmlCoords = el => (el ? el.textContent : '').trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(c => c.length >= 2 && isFinite(c[0]) && isFinite(c[1]));

function kmlGeoms(el, out) {
  for (const c of el.children) {
    const n = c.localName;
    if (n === 'Point') { const p = kmlCoords(kid(c, 'coordinates'))[0]; if (p) out.push({ type: 'Point', coordinates: p }); }
    else if (n === 'LineString' || n === 'LinearRing') { const p = kmlCoords(kid(c, 'coordinates')); if (p.length > 1) out.push({ type: 'LineString', coordinates: p }); }
    else if (n === 'Polygon') {
      const rings = [];
      const ob = kid(c, 'outerBoundaryIs');
      if (ob) rings.push(kmlCoords(ob.getElementsByTagNameNS('*', 'coordinates')[0]));
      for (const ib of kids(c, 'innerBoundaryIs')) rings.push(kmlCoords(ib.getElementsByTagNameNS('*', 'coordinates')[0]));
      if (rings.length && rings[0].length > 2) out.push({ type: 'Polygon', coordinates: rings });
    } else if (n === 'MultiGeometry') kmlGeoms(c, out);
  }
}

export function parseKML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('تعذّرت قراءة ملف KML.');
  const feats = [];
  for (const pm of doc.getElementsByTagNameNS('*', 'Placemark')) {
    const props = {};
    const nm = kid(pm, 'name'); if (nm) props.name = nm.textContent.trim();
    const ds = kid(pm, 'description'); if (ds && ds.textContent.trim()) props.description = ds.textContent.trim().replace(/<[^>]+>/g, ' ').slice(0, 300);
    for (const d of pm.getElementsByTagNameNS('*', 'Data')) { const v = d.getElementsByTagNameNS('*', 'value')[0]; if (v) props[d.getAttribute('name')] = v.textContent.trim(); }
    for (const d of pm.getElementsByTagNameNS('*', 'SimpleData')) props[d.getAttribute('name')] = d.textContent.trim();
    const gs = []; kmlGeoms(pm, gs);
    for (const g of gs) feats.push({ type: 'Feature', properties: props, geometry: g });
  }
  return feats;
}

// ---------- DXF ----------
function bulgeArc(p1, p2, b, out) {
  const th = 4 * Math.atan(b);
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = Math.hypot(dx, dy);
  if (!c || Math.abs(th) < 1e-6) { out.push(p2); return; }
  const d = c / (2 * Math.tan(th / 2));
  const cx = (p1[0] + p2[0]) / 2 - dy / c * d, cy = (p1[1] + p2[1]) / 2 + dx / c * d;
  const r = Math.hypot(p1[0] - cx, p1[1] - cy), a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const n = Math.max(2, Math.ceil(Math.abs(th) / (5 * D2R)));
  for (let i = 1; i <= n; i++) {
    const a = a1 + th * i / n;
    out.push(i === n ? p2 : [cx + r * Math.cos(a), cy + r * Math.sin(a), p1[2] + (p2[2] - p1[2]) * i / n]);
  }
}

function polyFromVerts(V, closed) {
  if (!V.length) return [];
  const out = [V[0].p];
  const n = V.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = V[i], b = V[(i + 1) % n];
    if (a.b) bulgeArc(a.p, b.p, a.b, out); else out.push(b.p);
  }
  return out;
}

function arcPts(cx, cy, cz, r, a1, a2) {
  let sw = a2 - a1;
  while (sw <= 0) sw += 360;
  const n = Math.max(4, Math.ceil(sw / 5)), pts = [];
  for (let i = 0; i <= n; i++) { const a = (a1 + sw * i / n) * D2R; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cz]); }
  return pts;
}

export function parseDXF(text) {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('ملف DXF ثنائي غير مدعوم. احفظه بصيغة ASCII DXF.');
  const L = text.split(/\r\n|\r|\n/);
  const P = [];
  for (let i = 0; i + 1 < L.length; i += 2) P.push([parseInt(L[i], 10), L[i + 1].trim()]);
  let i = P.findIndex((p, k) => p[0] === 0 && p[1] === 'SECTION' && P[k + 1] && P[k + 1][0] === 2 && P[k + 1][1] === 'ENTITIES');
  if (i < 0) throw new Error('لم يُعثر على قسم ENTITIES في ملف DXF.');
  i += 2;
  const ents = [];
  let cur = null;
  for (; i < P.length; i++) {
    const [c, v] = P[i];
    if (c === 0) { if (v === 'ENDSEC') break; cur = { t: v, g: [] }; ents.push(cur); }
    else if (cur) cur.g.push([c, v]);
  }
  const num = (e, code, d = 0) => { const g = e.g.find(x => x[0] === code); return g ? parseFloat(g[1]) : d; };
  const str = (e, code, d = '') => { const g = e.g.find(x => x[0] === code); return g ? g[1] : d; };
  const byLayer = new Map();
  const tins = new Map();
  const add = (e, geometry, extra = {}) => {
    const layer = str(e, 8, '0');
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push({ type: 'Feature', properties: { 'طبقة CAD': layer, 'النوع': e.t, ...extra }, geometry });
  };
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k];
    if (e.t === 'LINE') add(e, { type: 'LineString', coordinates: [[num(e, 10), num(e, 20), num(e, 30)], [num(e, 11), num(e, 21), num(e, 31)]] });
    else if (e.t === 'POINT') add(e, { type: 'Point', coordinates: [num(e, 10), num(e, 20), num(e, 30)] });
    else if (e.t === 'INSERT') add(e, { type: 'Point', coordinates: [num(e, 10), num(e, 20), num(e, 30)] }, { 'البلوك': str(e, 2), label: str(e, 2) });
    else if (e.t === 'CIRCLE') add(e, { type: 'LineString', coordinates: arcPts(num(e, 10), num(e, 20), num(e, 30), num(e, 40), 0, 360) });
    else if (e.t === 'ARC') add(e, { type: 'LineString', coordinates: arcPts(num(e, 10), num(e, 20), num(e, 30), num(e, 40), num(e, 50), num(e, 51)) });
    else if (e.t === 'LWPOLYLINE') {
      const z = num(e, 38), V = [];
      for (const [c, v] of e.g) {
        if (c === 10) V.push({ p: [parseFloat(v), 0, z], b: 0 });
        else if (c === 20 && V.length) V[V.length - 1].p[1] = parseFloat(v);
        else if (c === 42 && V.length) V[V.length - 1].b = parseFloat(v);
      }
      const pts = polyFromVerts(V, (num(e, 70) & 1) === 1);
      if (pts.length > 1) add(e, { type: 'LineString', coordinates: pts });
    } else if (e.t === 'POLYLINE') {
      const flags = num(e, 70), V = [];
      let j = k + 1;
      for (; j < ents.length && ents[j].t === 'VERTEX'; j++) V.push({ p: [num(ents[j], 10), num(ents[j], 20), num(ents[j], 30)], b: num(ents[j], 42) });
      k = j - 1;
      if (flags & 64 || flags & 16) continue;
      const pts = polyFromVerts(V, (flags & 1) === 1);
      if (pts.length > 1) add(e, { type: 'LineString', coordinates: pts });
    } else if (e.t === 'SPLINE') {
      const fit = [], ctl = [];
      for (const [c, v] of e.g) {
        if (c === 11) fit.push([parseFloat(v), 0, 0]); else if (c === 21 && fit.length) fit[fit.length - 1][1] = parseFloat(v); else if (c === 31 && fit.length) fit[fit.length - 1][2] = parseFloat(v);
        else if (c === 10) ctl.push([parseFloat(v), 0, 0]); else if (c === 20 && ctl.length) ctl[ctl.length - 1][1] = parseFloat(v); else if (c === 30 && ctl.length) ctl[ctl.length - 1][2] = parseFloat(v);
      }
      const pts = fit.length > 1 ? fit : ctl;
      if (pts.length > 1) add(e, { type: 'LineString', coordinates: pts }, { 'ملاحظة': 'منحنى Spline مقرَّب' });
    } else if (e.t === '3DFACE') {
      const layer = str(e, 8, '0');
      if (!tins.has(layer)) tins.set(layer, { vertices: [], faces: [] });
      const T = tins.get(layer), b = T.vertices.length;
      const c = [0, 1, 2, 3].map(q => [num(e, 10 + q), num(e, 20 + q), num(e, 30 + q)]);
      T.vertices.push(...c);
      T.faces.push([b, b + 1, b + 2]);
      if (c[3].some((x, q) => x !== c[2][q])) T.faces.push([b, b + 2, b + 3]);
    }
  }
  for (const [layer, T] of tins) {
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push({ type: 'Feature', properties: { 'طبقة CAD': layer, 'النوع': 'سطح 3DFACE', 'عدد المثلثات': T.faces.length }, geometry: { type: 'TIN', ...T } });
  }
  return [...byLayer].map(([name, features]) => ({ name, features }));
}

// ---------- LandXML ----------
const xyz = t => { const a = t.trim().split(/\s+/).map(Number); return [a[1], a[0], a.length > 2 ? a[2] : undefined]; }; // LandXML: شمال ثم شرق
const pt = (el, name) => { const c = kid(el, name); return c ? xyz(c.textContent) : null; };
const clean = c => (c[2] === undefined || !isFinite(c[2]) ? [c[0], c[1]] : c);

function coordGeom(cg) {
  const out = [];
  const push = p => { if (!p) return; const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) out.push(clean(p)); };
  for (const el of cg.children) {
    const S = pt(el, 'Start'), E = pt(el, 'End');
    if (el.localName === 'Line') { push(S); push(E); }
    else if (el.localName === 'Curve') {
      const C = pt(el, 'Center');
      if (!S || !E || !C) { push(S); push(E); continue; }
      const a1 = Math.atan2(S[1] - C[1], S[0] - C[0]), a2 = Math.atan2(E[1] - C[1], E[0] - C[0]), r = Math.hypot(S[0] - C[0], S[1] - C[1]);
      let d = a2 - a1;
      if (el.getAttribute('rot') === 'cw') { while (d >= 0) d -= 2 * Math.PI; } else { while (d <= 0) d += 2 * Math.PI; }
      const n = Math.max(2, Math.ceil(Math.abs(d) / (3 * D2R)));
      push(S);
      for (let i = 1; i < n; i++) { const a = a1 + d * i / n; push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), S[2]]); }
      push(E);
    } else if (el.localName === 'Spiral') {
      const PI = pt(el, 'PI');
      push(S);
      if (S && E && PI) for (let i = 1; i < 12; i++) { const t = i / 12, u = 1 - t; push([u * u * S[0] + 2 * u * t * PI[0] + t * t * E[0], u * u * S[1] + 2 * u * t * PI[1] + t * t * E[1], S[2]]); }
      push(E);
    } else if (el.localName === 'IrregularLine') {
      push(S);
      const pl = kid(el, 'PntList2D') || kid(el, 'PntList3D');
      if (pl) { const a = pl.textContent.trim().split(/\s+/).map(Number), st = pl.localName === 'PntList3D' ? 3 : 2; for (let i = 0; i + 1 < a.length; i += st) push([a[i + 1], a[i], st === 3 ? a[i + 2] : undefined]); }
      push(E);
    }
  }
  return out;
}

function stationPoints(line, sta0) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let step = 20;
  while (total / step > 300) step *= 5;
  const out = [];
  let acc = 0, next = Math.ceil(sta0 / step) * step - sta0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (d > 0 && next <= acc + d + 1e-9) {
      const t = (next - acc) / d, s = sta0 + next;
      const k = Math.floor(s / 1000), lab = k + '+' + (s - k * 1000).toFixed(0).padStart(3, '0');
      out.push({ type: 'Feature', properties: { label: lab, 'المحطة': lab }, geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] } });
      next += step;
    }
    acc += d;
  }
  return out;
}

export function parseLandXML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'LandXML') throw new Error('الملف ليس LandXML صالحاً.');
  const all = n => [...doc.getElementsByTagNameNS('*', n)];
  let scale = 1;
  const imp = all('Imperial')[0];
  if (imp) scale = /USSurvey/i.test(imp.getAttribute('linearUnit') || '') ? 1200 / 3937 : 0.3048;
  const layers = [];
  const aligns = [], stas = [];
  for (const al of all('Alignment')) {
    const cg = kid(al, 'CoordGeom'); if (!cg) continue;
    const line = coordGeom(cg); if (line.length < 2) continue;
    const sta0 = parseFloat(al.getAttribute('staStart') || '0') || 0;
    aligns.push({ type: 'Feature', properties: { 'الاسم': al.getAttribute('name') || 'محور', 'محطة البداية': sta0, 'الطول (م)': +(parseFloat(al.getAttribute('length') || '0')).toFixed(3) }, geometry: { type: 'LineString', coordinates: line } });
    stas.push(...stationPoints(line, sta0));
  }
  if (aligns.length) layers.push({ name: 'المحاور', features: aligns });
  if (stas.length) layers.push({ name: 'المحطات', features: stas });
  for (const sf of all('Surface')) {
    const pn = sf.getElementsByTagNameNS('*', 'Pnts')[0], fc = sf.getElementsByTagNameNS('*', 'Faces')[0];
    if (!pn || !fc) continue;
    const idx = new Map(), vertices = [], faces = [];
    for (const p of kids(pn, 'P')) { idx.set(p.getAttribute('id'), vertices.length); vertices.push(xyz(p.textContent)); }
    for (const f of kids(fc, 'F')) {
      if (f.getAttribute('i') === '1') continue;
      const t = f.textContent.trim().split(/\s+/).map(s => idx.get(s));
      if (t.length >= 3 && t.every(v => v !== undefined)) faces.push([t[0], t[1], t[2]]);
    }
    if (faces.length) layers.push({ name: 'سطح: ' + (sf.getAttribute('name') || 'TIN'), features: [{ type: 'Feature', properties: { 'الاسم': sf.getAttribute('name') || '', 'عدد النقاط': vertices.length, 'عدد المثلثات': faces.length }, geometry: { type: 'TIN', vertices, faces } }] });
  }
  const cgp = [];
  for (const p of all('CgPoint')) {
    const c = xyz(p.textContent); if (!isFinite(c[0]) || !isFinite(c[1])) continue;
    const name = p.getAttribute('name') || '';
    cgp.push({ type: 'Feature', properties: { label: name, 'الاسم': name, 'الوصف': p.getAttribute('desc') || p.getAttribute('code') || '', 'المنسوب': c[2] }, geometry: { type: 'Point', coordinates: clean(c) } });
  }
  if (cgp.length) layers.push({ name: 'نقاط المساحة', features: cgp });
  const parcels = [];
  for (const pc of all('Parcel')) {
    const cg = kid(pc, 'CoordGeom'); if (!cg) continue;
    const ring = coordGeom(cg); if (ring.length < 3) continue;
    ring.push(ring[0]);
    parcels.push({ type: 'Feature', properties: { 'الاسم': pc.getAttribute('name') || '', 'المساحة': pc.getAttribute('area') || '' }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  if (parcels.length) layers.push({ name: 'القطع', features: parcels });
  const plans = [];
  for (const pf of all('PlanFeature')) {
    const cg = kid(pf, 'CoordGeom'); if (!cg) continue;
    const line = coordGeom(cg); if (line.length < 2) continue;
    plans.push({ type: 'Feature', properties: { 'الاسم': pf.getAttribute('name') || '' }, geometry: { type: 'LineString', coordinates: line } });
  }
  if (plans.length) layers.push({ name: 'عناصر المخطط', features: plans });
  if (scale !== 1) for (const l of layers) l.features = l.features.map(f => ({ ...f, geometry: mapCoords(f.geometry, c => c.map(v => (v === undefined ? v : v * scale))) }));
  if (!layers.length) throw new Error('لا يحتوي ملف LandXML على محاور أو أسطح أو نقاط قابلة للعرض.');
  return layers;
}

// ---------- الملفات ----------
const ext = n => (n.split('.').pop() || '').toLowerCase();
const base = n => n.replace(/\.[^.]+$/, '');

export async function parseFiles(files, opts = {}) {
  const notes = [], layers = [];
  const list = [...files];
  const loose = list.filter(f => ext(f.name) === 'shp');
  for (const f of loose) {
    const sib = e => list.find(x => base(x.name) === base(f.name) && ext(x.name) === e);
    const o = { shp: await f.arrayBuffer() };
    if (sib('dbf')) o.dbf = await sib('dbf').arrayBuffer();
    if (sib('prj')) o.prj = await sib('prj').text();
    if (sib('cpg')) o.cpg = await sib('cpg').text();
    const fc = await self.shp(o);
    layers.push({ name: base(f.name), features: toWGS(fromGeoJSON(fc), opts, notes) });
  }
  for (const f of list) {
    const e = ext(f.name), name = base(f.name);
    if (['shp', 'dbf', 'prj', 'cpg', 'shx', 'sbn', 'sbx'].includes(e)) continue;
    if (e === 'geojson' || e === 'json') {
      layers.push({ name, features: toWGS(fromGeoJSON(JSON.parse(await f.text())), opts, notes) });
    } else if (e === 'kml') {
      layers.push({ name, features: parseKML(await f.text()) });
    } else if (e === 'kmz') {
      const z = self.fflate.unzipSync(new Uint8Array(await f.arrayBuffer()));
      const k = Object.keys(z).find(n => /\.kml$/i.test(n));
      if (!k) throw new Error('لا يوجد ملف KML داخل KMZ.');
      layers.push({ name, features: parseKML(self.fflate.strFromU8(z[k])) });
    } else if (e === 'zip') {
      const r = await self.shp(await f.arrayBuffer());
      for (const fc of Array.isArray(r) ? r : [r]) layers.push({ name: fc.fileName ? fc.fileName.split('/').pop() : name, features: toWGS(fromGeoJSON(fc), opts, notes) });
    } else if (e === 'dxf') {
      for (const l of parseDXF(await f.text())) layers.push({ name: name + ' / ' + l.name, features: toWGS(l.features, opts, notes, true) });
    } else if (e === 'xml') {
      for (const l of parseLandXML(await f.text())) layers.push({ name: name + ' / ' + l.name, features: toWGS(l.features, opts, notes, true) });
    } else if (e === 'dwg') {
      throw new Error('ملفات DWG غير مدعومة مباشرة. صدّر الرسم من AutoCAD أو Civil 3D بصيغة DXF أو LandXML.');
    } else {
      throw new Error(`صيغة الملف «${f.name}» غير مدعومة.`);
    }
  }
  const out = layers.filter(l => l.features.length);
  if (!out.length) throw new Error('لم يُعثر على معالم قابلة للعرض في الملفات.');
  return { layers: out, notes: [...new Set(notes)] };
}

// ---------- ArcGIS Feature Layer ----------
async function esri(url, params, token) {
  const body = new URLSearchParams(params);
  let r;
  if (token) { body.set('token', token); r = await fetch(url, { method: 'POST', body }); } // الرمز في جسم الطلب لا في الرابط
  else r = await fetch(url + '?' + body);
  if (!r.ok) throw new Error('فشل الاتصال بالخادم (' + r.status + ').');
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'رفض الخادم الطلب.');
  return j;
}

const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

export async function fetchArcGIS(url, { token = '', lon, lat, radius = 500 } = {}) {
  url = url.trim().split('?')[0].replace(/\/query$/i, '').replace(/\/+$/, '');
  let urls;
  if (/\/(FeatureServer|MapServer)\/\d+$/i.test(url)) urls = [url];
  else if (/\/(FeatureServer|MapServer)$/i.test(url)) {
    const meta = await esri(url, { f: 'json' }, token);
    urls = (meta.layers || []).slice(0, 12).map(l => url + '/' + l.id);
  } else throw new Error('الصق رابط الطبقة المنتهي بـ FeatureServer أو FeatureServer/0.');
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos(lat * D2R));
  const env = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(',');
  const out = [];
  for (const u of urls) {
    const meta = await esri(u, { f: 'json' }, token);
    const feats = [];
    for (let page = 0, offset = 0; page < 5; page++) {
      const r = await esri(u + '/query', {
        where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', returnZ: 'true', geometry: env, geometryType: 'esriGeometryEnvelope',
        inSR: '4326', spatialRel: 'esriSpatialRelIntersects', resultOffset: String(offset), resultRecordCount: '2000',
      }, token);
      const got = fromGeoJSON({ type: 'FeatureCollection', features: r.features || [] });
      feats.push(...got);
      if (!got.length || !(r.exceededTransferLimit || (r.properties && r.properties.exceededTransferLimit))) break;
      offset += got.length;
    }
    const sym = meta.drawingInfo && meta.drawingInfo.renderer && meta.drawingInfo.renderer.symbol;
    const col = sym && (sym.color || (sym.outline && sym.outline.color));
    out.push({ name: meta.name || 'طبقة ArcGIS', features: feats, color: col ? hex(col) : undefined, src: u });
  }
  return out;
}
