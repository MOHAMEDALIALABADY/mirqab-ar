// حسابات جيوديسية وهندسية خالصة (بدون أي اعتماد على المتصفح) حتى يمكن اختبارها منفردة.

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

function ecef(lon, lat) {
  const p = lat * D2R, l = lon * D2R;
  const s = Math.sin(p), c = Math.cos(p);
  const N = A / Math.sqrt(1 - E2 * s * s);
  return [N * c * Math.cos(l), N * c * Math.sin(l), N * (1 - E2) * s];
}

// مستوٍ مماس محلي (شرق/شمال بالمتر) حول نقطة أصل. دقيق لعدة كيلومترات.
export function makeENU(lat0, lon0) {
  const p = lat0 * D2R, l = lon0 * D2R;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const P0 = ecef(lon0, lat0);
  const N = A / Math.sqrt(1 - E2 * sp * sp);
  const M = A * (1 - E2) / Math.pow(1 - E2 * sp * sp, 1.5);
  const kx = N * cp * D2R, ky = M * D2R;
  const fwd = (lon, lat) => {
    const P = ecef(lon, lat);
    const dx = P[0] - P0[0], dy = P[1] - P0[1], dz = P[2] - P0[2];
    return [-sl * dx + cl * dy, -sp * cl * dx - sp * sl * dy + cp * dz];
  };
  const inv = (e, n) => {
    let lon = lon0 + e / kx, lat = lat0 + n / ky;
    for (let i = 0; i < 4; i++) {
      const [e1, n1] = fwd(lon, lat);
      lon += (e - e1) / kx;
      lat += (n - n1) / ky;
    }
    return [lon, lat];
  };
  return { lat0, lon0, fwd, inv };
}

export function haversine(lon1, lat1, lon2, lat2) {
  const dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dl / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

export function wrapPi(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

// طول مسار ثلاثي الأبعاد: نقاط [x, y, z]
export function pathLength(P, closed = false) {
  let s = 0;
  for (let i = 1; i < P.length; i++) s += dist3(P[i - 1], P[i]);
  if (closed && P.length > 2) s += dist3(P[P.length - 1], P[0]);
  return s;
}

export function dist3(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

// مساحة مضلع في الفراغ بطريقة نيويل (تساوي المساحة الأفقية إذا كان المضلع أفقياً)
export function polyArea3(P) {
  if (P.length < 3) return 0;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    x += a[1] * b[2] - a[2] * b[1];
    y += a[2] * b[0] - a[0] * b[2];
    z += a[0] * b[1] - a[1] * b[0];
  }
  return 0.5 * Math.hypot(x, y, z);
}

// مطابقة صلبة ثنائية الأبعاد (دوران حول المحور الرأسي + إزاحة) بين مسار GPS ومسار تتبع AR.
// pairs: [{a:[x,z] في إحداثيات ENU, b:[x,z] في فضاء AR, w}]  حيث b ≈ R(phi)·a + t
export function fitRigid2D(pairs) {
  let W = 0, ax = 0, az = 0, bx = 0, bz = 0;
  for (const p of pairs) { W += p.w; ax += p.w * p.a[0]; az += p.w * p.a[1]; bx += p.w * p.b[0]; bz += p.w * p.b[1]; }
  if (!W) return null;
  ax /= W; az /= W; bx /= W; bz /= W;
  let S = 0, C = 0;
  for (const p of pairs) {
    const x = p.a[0] - ax, z = p.a[1] - az, u = p.b[0] - bx, v = p.b[1] - bz;
    C += p.w * (u * x + v * z);
    S += p.w * (u * z - v * x);
  }
  const phi = Math.atan2(S, C);
  const [rx, rz] = rotY(phi, ax, az);
  return { phi, tx: bx - rx, tz: bz - rz };
}

// دوران حول المحور الرأسي بنفس اصطلاح three.js (rotation.y)
export function rotY(phi, x, z) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return [x * c + z * s, -x * s + z * c];
}

export function fmtLen(m) {
  if (!isFinite(m)) return '—';
  if (m >= 1000) return (m / 1000).toFixed(3) + ' كم';
  return m.toFixed(2) + ' م';
}

export function fmtArea(a) {
  if (!isFinite(a)) return '—';
  if (a >= 10000) return (a / 10000).toFixed(3) + ' هكتار';
  return a.toFixed(2) + ' م²';
}

export function fmtSta(s) {
  const k = Math.floor(s / 1000), r = s - k * 1000;
  return k + '+' + r.toFixed(0).padStart(3, '0');
}

// زاوية الرؤية الرأسية للكاميرا الافتراضية بحيث تطابق صورة الفيديو المعروضة بنمط cover
// vw,vh: أبعاد الفيديو كما تُعرض؛ W,H: أبعاد الشاشة؛ fovLong: زاوية العدسة على الضلع الأطول للفيديو (درجات)
export function coverFov(vw, vh, W, H, fovLong) {
  const f = (Math.max(vw, vh) / 2) / Math.tan(fovLong * D2R / 2);
  const s = Math.max(W / vw, H / vh);
  return 2 * Math.atan((H / 2) / (f * s)) * R2D;
}

// طريق تجريبي: يولّد طبقات GeoJSON لممر طريق يبدأ أمام المستخدم
export function demoRoad(enu, e0, n0, headingDeg) {
  const L = 240, ds = 2, h = headingDeg * D2R;
  const cl = []; // [e, n, tangent heading]
  let e = e0, n = n0, th = h;
  for (let s = 0; s <= L + 1e-6; s += ds) {
    cl.push([e, n, th, s]);
    const k = Math.sin(2 * Math.PI * s / L) / 190;
    th += k * ds;
    e += Math.sin(th) * ds;
    n += Math.cos(th) * ds;
  }
  const at = (i, off, z = 0) => {
    const [ce, cn, t] = cl[i];
    const [lon, lat] = enu.inv(ce + Math.cos(t) * off, cn - Math.sin(t) * off);
    return [lon, lat, z];
  };
  const crown = off => -0.02 * Math.abs(off);
  const strip = (o1, o2, z1, z2, props) => {
    const ring = [];
    for (let i = 0; i < cl.length; i++) ring.push(at(i, o1, z1));
    for (let i = cl.length - 1; i >= 0; i--) ring.push(at(i, o2, z2));
    ring.push(ring[0]);
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } };
  };
  const line = (off, props, from = 0, to = cl.length - 1) => {
    const c = [];
    for (let i = from; i <= to; i++) c.push(at(i, off, crown(off) + 0.0));
    return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: c } };
  };
  const point = (i, off, props, z = 0) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: at(i, off, z) } });
  const sides = [[1, 'يمين'], [-1, 'يسار']];
  const range = { 'من محطة': fmtSta(0), 'إلى محطة': fmtSta(L) };

  const lanes = sides.map(([k, side]) => strip(k * 1.0, k * 8.3, crown(1), crown(8.3),
    { 'العنصر': 'حارات المرور', 'الجانب': side, 'عدد الحارات': 2, 'العرض (م)': 7.3, 'طبقة السطح': 'خرسانة إسفلتية 5 سم', ...range }));
  const shoulders = sides.map(([k, side]) => strip(k * 8.3, k * 10.8, crown(8.3), crown(10.8),
    { 'العنصر': 'كتف الطريق', 'الجانب': side, 'العرض (م)': 2.5, 'الميل العرضي': '2%', ...range }));
  const slopes = sides.map(([k, side]) => strip(k * 10.8, k * 14.8, crown(10.8), crown(10.8) - 2,
    { 'العنصر': 'ميل جانبي', 'الجانب': side, 'الميل': '1:2', 'العرض (م)': 4, ...range }));
  const median = [strip(-1, 1, 0.15, 0.15, { 'العنصر': 'الجزيرة الوسطية', 'العرض (م)': 2, 'النوع': 'بردورات مع تبليط', ...range })];

  const marks = [];
  for (const [k, side] of sides) {
    marks.push(line(k * 1.25, { 'العلامة': 'خط حافة داخلي', 'اللون': 'أصفر', 'الجانب': side }));
    marks.push(line(k * 8.15, { 'العلامة': 'خط حافة خارجي', 'اللون': 'أبيض', 'الجانب': side }));
    for (let i = 0; i + 2 < cl.length; i += 6) marks.push(line(k * 4.65, { 'العلامة': 'خط فاصل حارات متقطع', 'اللون': 'أبيض', 'الجانب': side }, i, i + 2));
  }

  const axis = [line(0, { 'الاسم': 'محور الطريق', 'الطول (م)': L })];
  for (let i = 0; i < cl.length; i += 10) axis.push(point(i, 0, { label: fmtSta(cl[i][3]), 'المحطة': fmtSta(cl[i][3]) }, 0.15));

  const drain = [line(12.2, { 'العنصر': 'خط تصريف السيول', 'القطر (مم)': 800, 'المادة': 'خرسانة مسلحة' })];
  let cb = 0;
  for (let i = 5; i < cl.length; i += 15) {
    cb++;
    drain.push(point(i, 8.0, { label: 'CB-' + String(cb).padStart(2, '0'), 'النوع': 'مصيدة سيول', 'المحطة': fmtSta(cl[i][3]), 'قطر التوصيلة (مم)': 300 }, crown(8)));
  }
  let mh = 0;
  for (let i = 15; i < cl.length; i += 30) {
    mh++;
    drain.push(point(i, 12.2, { label: 'MH-' + String(mh).padStart(2, '0'), 'النوع': 'منهل تفتيش', 'المحطة': fmtSta(cl[i][3]), 'العمق (م)': 2.5, 'قطر الغطاء (مم)': 650 }, crown(12.2)));
  }
  const masts = [0, 60].map((i, k) => point(i + 25, -20, { label: 'HM-' + String(k + 1).padStart(2, '0'), 'النوع': 'صاري إنارة عالٍ', 'الارتفاع (م)': 30, 'عدد الكشافات': 8, 'المحطة': fmtSta(cl[i + 25][3]) }, 0));
  const lights = [];
  let lp = 0;
  for (let i = 8; i < cl.length; i += 17) {
    lp++;
    lights.push(point(i, 0, { label: 'LP-' + String(lp).padStart(2, '0'), 'النوع': 'عمود إنارة مزدوج', 'الارتفاع (م)': 12, 'المحطة': fmtSta(cl[i][3]) }, 0.15));
  }

  return [
    { name: 'الميول الجانبية', color: '#2fb574', opacity: 0.5, features: slopes },
    { name: 'أكتاف الطريق', color: '#e5484d', opacity: 0.5, features: shoulders },
    { name: 'حارات المرور', color: '#3d6ff2', opacity: 0.5, features: lanes },
    { name: 'الجزيرة الوسطية', color: '#8d9a2b', opacity: 0.6, features: median },
    { name: 'علامات الطريق', color: '#f4f4f0', opacity: 0.9, features: marks },
    { name: 'المحور والمحطات', color: '#ffc53d', opacity: 0.9, features: axis },
    { name: 'تصريف السيول', color: '#22c3dd', opacity: 0.9, features: drain },
    { name: 'أعمدة الإنارة', color: '#c4a7ff', opacity: 0.9, features: lights },
    { name: 'صواري الإنارة', color: '#ff8b3e', opacity: 0.9, features: masts },
  ];
}
