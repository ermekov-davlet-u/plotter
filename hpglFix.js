// hpglFix.js
// Диагностика и упрощение HPGL (.plt) файлов перед резкой.
//
// Проблема: некоторые файлы (например, после автотрейсинга растра)
// содержат тысячи точек на контур с микро-сегментами в 1-5 единиц —
// плоттер на каждой такой точке дёргается/тормозит/трясётся.
//
// Решение: разбираем файл на контуры, прогоняем каждый через
// алгоритм Дугласа-Пекера (Ramer-Douglas-Peucker), который убирает
// лишние точки, но сохраняет форму в пределах допуска (tolerance).
//
// 1 единица HPGL = 0.025 мм (стандартный plotter unit),
// поэтому tolerance=8 ~ допуск 0.2мм — незаметно глазу, но убирает шум.

/**
 * Разбирает HPGL-текст на список элементов:
 *  - { type: 'cmd', value } — служебная команда (IN, SP1, PW0.025, LT, ...)
 *  - { type: 'path', start: {x,y}, points: [{x,y}, ...] } — непрерывный контур
 */
export function parseHPGL(text) {
  const items = [];
  const tokens = text.split(";").map((t) => t.trim()).filter((t) => t.length > 0);

  let currentPath = null;

  const closePath = () => {
    if (currentPath) {
      items.push(currentPath);
      currentPath = null;
    }
  };

  for (const token of tokens) {
    const m = token.match(/^(PU|PD)([\-0-9.,\s]*)$/);

    if (!m) {
      closePath();
      items.push({ type: "cmd", value: token });
      continue;
    }

    const [, pen, coordsStr] = m;
    const nums = coordsStr
      .split(",")
      .map((s) => parseFloat(s))
      .filter((n) => !isNaN(n));

    const points = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      points.push({ x: nums[i], y: nums[i + 1] });
    }

    if (pen === "PU") {
      closePath();
      if (points.length === 0) {
        // голый "PU;" без координат — просто поднять перо, без движения
        items.push({ type: "cmd", value: "PU" });
        continue;
      }
      // если в PU несколько точек — последняя считается стартом нового контура
      const start = points[points.length - 1];
      currentPath = { type: "path", start, points: [] };
    } else {
      // PD
      if (points.length === 0) {
        // голый "PD;" — игнорируем, ничего не режет
        continue;
      }
      if (!currentPath) {
        // PD без предшествующего PU (бывает в кривых файлах) — берём первую точку как старт
        currentPath = { type: "path", start: points[0], points: points.slice(1) };
      } else {
        currentPath.points.push(...points);
      }
    }
  }

  closePath();
  return items;
}

/** Убирает подряд идущие дубликаты точек (нулевые сегменты) */
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Квадрат расстояния от точки p до отрезка p1-p2 */
function sqSegDist(p, p1, p2) {
  let x = p1.x;
  let y = p1.y;
  let dx = p2.x - x;
  let dy = p2.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}

/**
 * Алгоритм Дугласа-Пекера: упрощает полилинию, сохраняя форму
 * в пределах tolerance (единицы HPGL, 1 ед. = 0.025мм)
 */
export function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points.slice();

  const sqTolerance = tolerance * tolerance;

  function simplifySection(first, last, simplified) {
    let maxDist = sqTolerance;
    let index = -1;

    for (let i = first + 1; i < last; i++) {
      const dist = sqSegDist(points[i], points[first], points[last]);
      if (dist > maxDist) {
        index = i;
        maxDist = dist;
      }
    }

    if (index > -1) {
      if (index - first > 1) simplifySection(first, index, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifySection(index, last, simplified);
    }
  }

  const last = points.length - 1;
  const simplified = [points[0]];
  simplifySection(0, last, simplified);
  simplified.push(points[last]);

  return simplified;
}

/** Считает диагностику по уже распарсенным элементам */
export function analyzeItems(items, minSeg = 3) {
  let totalSegments = 0;
  let tinySegments = 0;
  let totalPoints = 0;

  for (const item of items) {
    if (item.type !== "path") continue;
    const all = [item.start, ...item.points];
    totalPoints += all.length;
    for (let i = 1; i < all.length; i++) {
      const dx = all[i].x - all[i - 1].x;
      const dy = all[i].y - all[i - 1].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      totalSegments++;
      if (d < minSeg) tinySegments++;
    }
  }

  return {
    totalPoints,
    totalSegments,
    tinySegments,
    tinyRatio: totalSegments ? tinySegments / totalSegments : 0,
  };
}

/** Диагностика по сырому тексту файла */
export function analyzeHPGL(text, minSeg = 3) {
  return analyzeItems(parseHPGL(text), minSeg);
}

/**
 * Ищет внутри полилинии "микро-детали" — участки, где много точек подряд
 * укладываются в очень маленький bounding box (например, крошечные круги/
 * петли, которые автотрейс или экспорт встроил прямо в общий контур без
 * отрыва пера). Это типичная причина дёргания именно на "маленьких кругах".
 *
 * maxFeatureSize — сторона bbox в единицах HPGL (1 ед. = 0.025мм)
 * minClusterLen  — минимум точек подряд, чтобы считать это деталью, а не просто углом
 */
export function findMicroFeatures(points, { maxFeatureSize = 30, minClusterLen = 6 } = {}) {
  const features = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    let minX = points[i].x, maxX = points[i].x, minY = points[i].y, maxY = points[i].y;
    while (j < points.length) {
      const nx = Math.min(minX, points[j].x);
      const Nx = Math.max(maxX, points[j].x);
      const ny = Math.min(minY, points[j].y);
      const Ny = Math.max(maxY, points[j].y);
      if (Nx - nx > maxFeatureSize || Ny - ny > maxFeatureSize) break;
      minX = nx; maxX = Nx; minY = ny; maxY = Ny;
      j++;
    }
    const clusterLen = j - i;
    if (clusterLen >= minClusterLen) {
      features.push({
        startIndex: i,
        endIndex: j - 1,
        pointCount: clusterLen,
        bboxUnits: { w: maxX - minX, h: maxY - minY },
        bboxMm: { w: +(((maxX - minX) * 0.025).toFixed(2)), h: +(((maxY - minY) * 0.025).toFixed(2)) },
      });
      i = j;
    } else {
      i++;
    }
  }
  return features;
}

/**
 * Вырезает найденные микро-детали из полилинии: вместо крошечной петли
 * остаётся одна точка входа, путь продолжается дальше без отрыва пера.
 * Деталь физически слишком мала, чтобы её резать — пропускаем её целиком.
 */
export function stripMicroFeatures(points, opts = {}) {
  const features = findMicroFeatures(points, opts);
  if (features.length === 0) return { points, removed: [] };

  const result = [];
  let cursor = 0;
  for (const f of features) {
    while (cursor < f.startIndex) {
      result.push(points[cursor]);
      cursor++;
    }
    result.push(points[f.startIndex]); // оставляем только точку входа в деталь
    cursor = f.endIndex + 1;
  }
  while (cursor < points.length) {
    result.push(points[cursor]);
    cursor++;
  }

  return { points: result, removed: features };
}

/**
 * Нужен ли файлу ремонт?
 * По умолчанию: если больше 15% сегментов короче 3 единиц (0.075мм) — файл "дрожащий"
 */
export function needsFix(text, { tinyThreshold = 0.15, minSeg = 3 } = {}) {
  const stat = analyzeHPGL(text, minSeg);
  return stat.tinyRatio > tinyThreshold;
}

/**
 * Упрощает все контуры в HPGL-тексте.
 * removeMicroFeatures=true — дополнительно вырезает крошечные петли/круги
 * (см. findMicroFeatures) перед упрощением — для файлов вроде тех, где
 * "режет маленькие круги и начинает дёргаться".
 * Возвращает { hpgl, before, after, fixed, microFeaturesRemoved }
 */
export function simplifyHPGL(
  text,
  tolerance = 8,
  { removeMicroFeatures = false, maxFeatureSize = 30, minClusterLen = 6 } = {}
) {
  const items = parseHPGL(text);
  const before = analyzeItems(items);

  let microFeaturesRemoved = [];

  const fixedItems = items.map((item) => {
    if (item.type !== "path") return item;
    let all = dedupe([item.start, ...item.points]);

    if (removeMicroFeatures) {
      const stripped = stripMicroFeatures(all, { maxFeatureSize, minClusterLen });
      all = stripped.points;
      microFeaturesRemoved = microFeaturesRemoved.concat(stripped.removed);
    }

    if (all.length < 3) return { type: "path", start: all[0], points: all.slice(1) };
    const simplified = douglasPeucker(all, tolerance);
    return { type: "path", start: simplified[0], points: simplified.slice(1) };
  });

  const after = analyzeItems(fixedItems);

  let out = "";
  for (const item of fixedItems) {
    if (item.type === "cmd") {
      out += item.value + ";\n";
      continue;
    }
    if (!item.start) continue;
    out += `PU${Math.round(item.start.x)},${Math.round(item.start.y)};\n`;
    if (item.points.length) {
      out += "PD" + item.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(",") + ";\n";
    }
  }

  return {
    hpgl: out,
    before,
    after,
    fixed: after.totalPoints < before.totalPoints,
    microFeaturesRemoved,
  };
}

/**
 * Главная функция: если файл "дрожащий" — чинит и возвращает чистый HPGL,
 * если нет — возвращает исходный текст без изменений.
 *
 * removeMicroFeatures: включить вырезание крошечных (<maxFeatureSize, по
 * умолчанию ~0.75мм) петель/кругов — ставьте true, если знаете, что в
 * дизайне нет специально задуманных отверстий меньше миллиметра.
 */
export function autoFixHPGL(
  text,
  { tolerance = 8, tinyThreshold = 0.15, removeMicroFeatures = false, maxFeatureSize = 30, minClusterLen = 6 } = {}
) {
  if (!needsFix(text, { tinyThreshold })) {
    return { hpgl: text, wasFixed: false, before: analyzeHPGL(text), after: null, microFeaturesRemoved: [] };
  }
  const { hpgl, before, after, microFeaturesRemoved } = simplifyHPGL(text, tolerance, {
    removeMicroFeatures,
    maxFeatureSize,
    minClusterLen,
  });
  return { hpgl, wasFixed: true, before, after, microFeaturesRemoved };
}
