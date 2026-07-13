import paper from "paper";

// Инициализируем Paper.js один раз в глобальной области видимости
paper.setup(new paper.Size(10000, 10000));

/**
 * Парсит HPGL строку в массив путей с координатами точек
 */
export function parseHPGL(text) {
  // Разделяем по точке с запятой, убираем пробелы и пустые команды
  const commands = text.split(";").map(c => c.trim()).filter(Boolean);

  const paths = [];
  let currentPath = null;

  for (const cmd of commands) {
    if (cmd.startsWith("PU")) {
      // Pen Up — начало нового контура
      const coords = cmd.slice(2).split(",").map(Number);
      if (coords.length >= 2) {
        currentPath = {
          start: { x: coords[0], y: coords[1] },
          points: []
        };
        paths.push(currentPath);
      }
    } else if (cmd.startsWith("PD")) {
      // Pen Down — добавление точек к текущему контуру
      if (!currentPath) continue;

      const coords = cmd.slice(2).split(",").map(Number);
      for (let i = 0; i < coords.length; i += 2) {
        const x = coords[i];
        const y = coords[i + 1];
        if (!isNaN(x) && !isNaN(y)) {
          currentPath.points.push({ x, y });
        }
      }
    }
  }

  return paths;
}

/**
 * Очищает, сглаживает контур через Paper.js и возвращает массив точек
 */
function cleanAndSmoothPath(item, tolerance = 2) {
  const path = new paper.Path();

  // Добавляем стартовую точку и все последующие
  path.add(new paper.Point(item.start.x, item.start.y));
  for (const p of item.points) {
    path.add(new paper.Point(p.x, p.y));
  }

  // Проверяем на замкнутость (если первая и последняя точки совпадают или очень близки)
  if (item.points.length > 0) {
    const start = item.start;
    const end = item.points[item.points.length - 1];
    const dist = Math.hypot(start.x - end.x, start.y - end.y);
    if (dist < 5) {
      path.closed = true;
    }
  }

  // Оптимизируем контур (убираем лишний шум)
  // В Paper.js tolerance задается через аргумент (по умолчанию 2.5)
  path.simplify(tolerance);

  // Сглаживаем углы для плавного движения ножа плоттера
  path.smooth({ type: "continuous" });

  // Сохраняем результат в массив простых объектов координат
  const smoothedPoints = path.segments.map(s => ({
    x: s.point.x,
    y: s.point.y
  }));

  // ВАЖНО: Удаляем объект из памяти Paper.js, чтобы избежать утечек
  path.remove();

  return smoothedPoints;
}

/**
 * Вычисляет общий bounding box (границы) для всей детали целиком
 */
function getGlobalBounds(allPaths) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const pts of allPaths) {
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Поворачивает ВСЕ контуры на 90° по часовой стрелке вокруг общего центра детали
 */
function rotateAllPaths90(allPaths) {
  const { minX, minY, maxX, maxY } = getGlobalBounds(allPaths);

  // Общий центр всей детали
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return allPaths.map(pts =>
    pts.map(p => {
      const x = p.x - cx;
      const y = p.y - cy;
      return {
        x: Math.round(y + cx),
        y: Math.round(-x + cy)
      };
    })
  );
}

/**
 * Главная функция оптимизации HPGL
 */
export function simplifyHPGL(text) {
  const rawItems = parseHPGL(text);

  let totalBeforePoints = 0;
  let processedPaths = [];

  // 1. Очистка и сглаживание каждого контура по отдельности
  for (const item of rawItems) {
    const rawPtsCount = 1 + item.points.length;
    totalBeforePoints += rawPtsCount;

    const smoothPts = cleanAndSmoothPath(item);
    if (smoothPts.length > 0) {
      processedPaths.push(smoothPts);
    }
  }

  // 2. Поворот всей детали на 90° относительно ОБЩЕГО центра
  if (processedPaths.length > 0) {
    processedPaths = rotateAllPaths90(processedPaths);
  }

  // 3. Сборка нового HPGL файла с длинными пачками команд PD
  let hpgl = "IN;VS7;FS30;\n";// Добавили инициализацию IN
  let totalAfterPoints = 0;

  for (const pts of processedPaths) {
    totalAfterPoints += pts.length;

    // Перемещение к началу контура
    hpgl += `PU${pts[0].x},${pts[0].y};\n`;

    if (pts.length > 1) {
      // Собираем все остальные точки в одну длинную команду PD для плавности резки
      const tailPoints = pts.slice(1).map(p => `${p.x},${p.y}`).join(",");
      hpgl += `PD${tailPoints};\n`;
    }
  }

  // Очищаем активный проект Paper.js, завершая работу с файлом
  paper.project.clear();

  return {
    hpgl,
    before: { total: totalBeforePoints },
    after: { total: totalAfterPoints },
    fixed: true
  };
}

export function autoFixHPGL(text) {
  return simplifyHPGL(text);
}