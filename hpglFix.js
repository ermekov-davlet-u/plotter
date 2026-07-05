import simplify from "simplify-js";

// ---------------- distance ----------------
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------- HPGL PARSER ----------------
export function parseHPGL(text) {
  const tokens = text.split(";").map(t => t.trim()).filter(Boolean);

  const items = [];
  let current = null;

  for (const t of tokens) {
    if (t.startsWith("PU")) {
      const [x, y] = t.slice(2).split(",").map(Number);

      current = {
        type: "path",
        start: { x, y },
        points: []
      };

      items.push(current);
    }

    else if (t.startsWith("PD")) {
      const coords = t.slice(2).split(",");

      for (let i = 0; i < coords.length; i += 2) {
        const x = +coords[i];
        const y = +coords[i + 1];

        if (!isNaN(x) && !isNaN(y)) {
          current?.points.push({ x, y });
        }
      }
    }
  }

  return items;
}

// ---------------- CLEAN + SMOOTH ----------------
function cleanPoints(points) {
  if (points.length < 3) return points;

  // 🔥 simplify-js убирает шум и вибрацию
  const simplified = simplify(points, 1.8, true);

  return simplified;
}

// ---------------- circle detect (простая и надёжная) ----------------
function isCircle(points) {
  if (points.length < 25) return false;

  const start = points[0];
  const end = points.at(-1);

  const dx = start.x - end.x;
  const dy = start.y - end.y;

  const closed = Math.sqrt(dx * dx + dy * dy);

  return closed < 5;
}

// ---------------- circle fix (без треугольников!) ----------------
function circleToSmooth(points) {
  const cx =
    points.reduce((s, p) => s + p.x, 0) / points.length;

  const cy =
    points.reduce((s, p) => s + p.y, 0) / points.length;

  const r =
    points.reduce((s, p) => s + dist(p, { x: cx, y: cy }), 0) /
    points.length;

  const out = [];

  const steps = 12; // 🔥 баланс плавности и стабильности

  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;

    out.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r
    });
  }

  return out;
}

// ---------------- ROTATE 90° ----------------

function getBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

// Поворот на 90° ПО ЧАСОВОЙ СТРЕЛКЕ
function rotate90(points) {
  const { minX, minY, maxX, maxY } = getBounds(points);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return points.map(p => {
    const x = p.x - cx;
    const y = p.y - cy;

    return {
      x: y + cx,
      y: -x + cy
    };
  });
}

// ---------------- MAIN ----------------
export function simplifyHPGL(text) {
  const items = parseHPGL(text);

  let hpgl = "VS7;FS12;\n";

  const before = { total: 0 };
  const after = { total: 0 };

  for (const item of items) {
    let pts = [item.start, ...item.points];

    before.total += pts.length;

    // 🔥 1. чистим шум
    pts = cleanPoints(pts);

    // 🔥 2. если круг — отдельная логика
    if (isCircle(pts)) {
      pts = circleToSmooth(pts);
    }

    pts = rotate90(pts);

    after.total += pts.length;

    // 🔥 3. HPGL output (ВАЖНО: пачками)
    hpgl += `PU${Math.round(pts[0].x)},${Math.round(pts[0].y)};\n`;

    for (let i = 1; i < pts.length; i += 8) {
      const chunk = pts.slice(i, i + 8);

      hpgl += "PD";
      hpgl += chunk.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(",");
      hpgl += ";\n";
    }
  }

  return {
    hpgl,
    before,
    after,
    fixed: true
  };
}

export function autoFixHPGL(text) {
  return simplifyHPGL(text);
}