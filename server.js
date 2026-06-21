import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import net from "net";
import { autoFixHPGL, analyzeHPGL, needsFix, findMicroFeatures, parseHPGL } from "./hpglFix.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

// -------------------------
// НАСТРОЙКИ ПЛОТТЕРА
// -------------------------
const PLOTTER_IP = "192.168.31.31"; // <-- ВСТАВЬ IP плоттера
const PLOTTER_PORT = 9100;

// Папка, где лежат все .plt файлы, которые нужно проверять/чинить пачками
const PLT_DIR = path.resolve("plt_files");

// Допуск упрощения в единицах HPGL (1 ед. = 0.025мм). Чем больше — тем агрессивнее чистка.
// 2 единицы = макс. отклонение 0.05мм — ниже точности самого блейда/плоттера,
// но этого достаточно, чтобы полностью убрать микро-сегменты на ваших файлах.
const SIMPLIFY_TOLERANCE = 2;

// Удалять ли крошечные петли/круги (<0.75мм) прямо из контура.
// Включай, только если уверен, что в дизайнах нет специально задуманных
// отверстий меньше миллиметра — иначе можно случайно стереть нужную деталь.
const REMOVE_MICRO_FEATURES = false;
const MICRO_FEATURE_MAX_SIZE = 30; // единиц HPGL = 0.75мм

function epsToHpgl(filePath) {
  const eps = fs.readFileSync(filePath, "utf-8");

  let hpgl = "IN;\nSP1;\nPU;\n";

  let currentX = 0;
  let currentY = 0;

  // ищем координаты (очень упрощённо)
  const commands = eps.match(/-?\d+\.?\d*\s-?\d+\.?\d*/g);

  if (!commands) {
    throw new Error("Не удалось найти координаты в EPS");
  }

  let isPenDown = false;

  for (let i = 0; i < commands.length; i += 2) {
    const x = parseFloat(commands[i]) * 10;
    const y = parseFloat(commands[i + 1]) * 10;

    if (isNaN(x) || isNaN(y)) continue;

    if (!isPenDown) {
      hpgl += `PU${x},${y};\n`;
      isPenDown = true;
    } else {
      hpgl += `PD${x},${y};\n`;
    }

    currentX = x;
    currentY = y;
  }

  hpgl += "PU;\nSP0;\n";

  return hpgl;
}

// -------------------------
// Авто-починка перед резкой
// -------------------------
// Читает .plt файл, проверяет на "дрожь" (много микро-сегментов),
// при необходимости упрощает контуры алгоритмом Дугласа-Пекера.
// Если файл правился — сохраняет рядом версию "_fixed.plt" для истории.
function prepareForCutting(filePath, opts = {}) {
  const raw = fs.readFileSync(filePath, "utf-8");

  const { hpgl, wasFixed, before, after, microFeaturesRemoved } = autoFixHPGL(raw, {
    tolerance: SIMPLIFY_TOLERANCE,
    removeMicroFeatures: opts.removeMicroFeatures ?? REMOVE_MICRO_FEATURES,
    maxFeatureSize: MICRO_FEATURE_MAX_SIZE,
  });

  if (!wasFixed) {
    console.log(`✅ ${path.basename(filePath)}: файл чистый, починка не нужна (точек: ${before.totalPoints})`);
    return raw;
  }

  console.log(
    `🔧 ${path.basename(filePath)}: обнаружена "дрожь", чиню — ` +
      `точек ${before.totalPoints} → ${after.totalPoints}, ` +
      `микро-сегментов ${(before.tinyRatio * 100).toFixed(1)}% → ${(after.tinyRatio * 100).toFixed(1)}%`
  );

  if (microFeaturesRemoved && microFeaturesRemoved.length) {
    console.log(`   🔻 удалено крошечных деталей (вероятно, маленькие круги): ${microFeaturesRemoved.length}`);
    microFeaturesRemoved.forEach((f, idx) =>
      console.log(`      #${idx + 1}: ${f.bboxMm.w}x${f.bboxMm.h} мм, точек было: ${f.pointCount}`)
    );
  } else if (!opts.removeMicroFeatures && !REMOVE_MICRO_FEATURES) {
    // если такие детали есть, но удаление выключено — хотя бы предупредим
    const items = parseHPGL(raw);
    const mainPath = items.find((i) => i.type === "path" && i.points.length > 20);
    if (mainPath) {
      const found = findMicroFeatures([mainPath.start, ...mainPath.points], { maxFeatureSize: MICRO_FEATURE_MAX_SIZE });
      if (found.length) {
        console.log(
          `   ⚠️  найдено ${found.length} крошечных деталей (<0.75мм) — вероятно, это и трясёт. ` +
            `Чтобы их вырезать, отправь removeMicroFeatures=true`
        );
      }
    }
  }

  const fixedPath = filePath.replace(/\.plt$/i, "") + "_fixed.plt";
  fs.writeFileSync(fixedPath, hpgl, "utf-8");

  return hpgl;
}

// -------------------------
// Очередь задач (чтобы не ломать плоттер)
// -------------------------
let queue = [];
let isProcessing = false;

function processQueue() {
  if (isProcessing || queue.length === 0) return;

  isProcessing = true;
  const job = queue.shift();

  sendToPlotter(job.data)
    .then(() => {
      console.log("✅ Задание выполнено");
    })
    .catch((err) => {
      console.error("❌ Ошибка:", err.message);
    })
    .finally(() => {
      isProcessing = false;
      setTimeout(processQueue, 500); // пауза между заданиями
    });
}

// -------------------------
// Отправка на плоттер
// -------------------------
function sendToPlotter(data) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(PLOTTER_PORT, PLOTTER_IP, () => {
      console.log("🔌 Подключено к плоттеру");

      client.write(data);
      client.write("\x03"); // иногда важно (End of Text, для некоторых плоттеров)
      client.end();
    });

    client.on("close", () => {
      resolve();
    });

    client.on("error", (err) => {
      reject(err);
    });

    client.setTimeout(10000, () => {
      client.destroy();
      reject(new Error("Timeout плоттера"));
    });
  });
}

app.get("/test", (req, res) => {
  try {
    const filePath = path.resolve("phone12.plt");

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "phone12.plt не найден" });
    }

    const data = prepareForCutting(filePath);

    queue.push({ data });
    processQueue();

    res.json({ message: "Тестовая резка из файла отправлена" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/cut-eps", (req, res) => {
  try {
    const filePath = "test.eps";

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "test.eps не найден" });
    }

    // 1. конвертация EPS → HPGL
    let hpgl = epsToHpgl(filePath);

    // 2. чиним, если получилось "дрожащее" (autotrace часто этим грешит)
    const fixResult = autoFixHPGL(hpgl, { tolerance: SIMPLIFY_TOLERANCE });
    if (fixResult.wasFixed) {
      console.log(
        `🔧 EPS после конвертации был "дрожащим", починил: ` +
          `${fixResult.before.totalPoints} → ${fixResult.after.totalPoints} точек`
      );
      hpgl = fixResult.hpgl;
    }

    console.log(hpgl);

    queue.push({ data: hpgl });
    processQueue();

    res.json({ message: "EPS конвертирован, проверен и отправлен на резку" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/connect", (req, res) => {
  function testPort(port) {
    const socket = new net.Socket();

    socket.setTimeout(2000);

    socket.connect(port, "192.168.31.50", () => {
      console.log("OPEN:", port);
      socket.destroy();
    });

    socket.on("error", () => {});
    socket.on("timeout", () => socket.destroy());
  }

  [9100, 515, 631].forEach(testPort);
  res.json({ message: "Проверка портов запущена, смотри консоль" });
});

// -------------------------
// РЕЗКА ОДНОГО ФАЙЛА (.plt / HPGL) — с авто-починкой
// -------------------------
app.post("/cut", (req, res) => {
  const { filePath, removeMicroFeatures } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Не указан filePath" });
  }

  try {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Файл не найден" });
    }

    const data = prepareForCutting(fullPath, { removeMicroFeatures });

    queue.push({ data });
    processQueue();

    res.json({ message: "Файл проверен, при необходимости починен и добавлен в очередь" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------
// ПРОВЕРКА ОДНОГО ФАЙЛА БЕЗ ОТПРАВКИ — посмотреть диагностику
// -------------------------
app.get("/check", (req, res) => {
  const { filePath } = req.query;

  if (!filePath) {
    return res.status(400).json({ error: "Укажи ?filePath=..." });
  }

  try {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Файл не найден" });
    }

    const raw = fs.readFileSync(fullPath, "utf-8");
    const stat = analyzeHPGL(raw);

    const items = parseHPGL(raw);
    let microFeatures = [];
    for (const item of items) {
      if (item.type !== "path") continue;
      const all = [item.start, ...item.points];
      microFeatures = microFeatures.concat(
        findMicroFeatures(all, { maxFeatureSize: MICRO_FEATURE_MAX_SIZE })
      );
    }

    res.json({
      file: path.basename(fullPath),
      needsFix: needsFix(raw),
      ...stat,
      tinyRatioPercent: (stat.tinyRatio * 100).toFixed(1) + "%",
      microFeaturesFound: microFeatures.length,
      microFeatures: microFeatures.map((f) => ({ sizeMm: f.bboxMm, pointCount: f.pointCount })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------
// ПАКЕТНАЯ ПРОВЕРКА/ПОЧИНКА ВСЕХ ФАЙЛОВ В ПАПКЕ
// Кладёшь все .plt файлы в папку plt_files/ рядом с сервером,
// дёргаешь GET /fix-all — получаешь отчёт, "дрожащие" файлы
// автоматически получают рядом версию *_fixed.plt
// -------------------------
app.get("/fix-all", (req, res) => {
  try {
    if (!fs.existsSync(PLT_DIR)) {
      return res.status(404).json({ error: `Папка ${PLT_DIR} не найдена. Создай её и положи туда .plt файлы` });
    }

    const files = fs
      .readdirSync(PLT_DIR)
      .filter((f) => f.toLowerCase().endsWith(".plt") && !f.toLowerCase().endsWith("_fixed.plt"));

    const report = files.map((fileName) => {
      const fullPath = path.join(PLT_DIR, fileName);
      const raw = fs.readFileSync(fullPath, "utf-8");
      const before = analyzeHPGL(raw);
      const fix = autoFixHPGL(raw, { tolerance: SIMPLIFY_TOLERANCE });

      if (fix.wasFixed) {
        const fixedPath = fullPath.replace(/\.plt$/i, "") + "_fixed.plt";
        fs.writeFileSync(fixedPath, fix.hpgl, "utf-8");
      }

      return {
        file: fileName,
        wasFixed: fix.wasFixed,
        pointsBefore: before.totalPoints,
        pointsAfter: fix.wasFixed ? fix.after.totalPoints : before.totalPoints,
        tinyRatioBefore: (before.tinyRatio * 100).toFixed(1) + "%",
        tinyRatioAfter: fix.wasFixed ? (fix.after.tinyRatio * 100).toFixed(1) + "%" : (before.tinyRatio * 100).toFixed(1) + "%",
      };
    });

    res.json({
      checked: files.length,
      fixed: report.filter((r) => r.wasFixed).length,
      report,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------
app.listen(PORT, () => {
  console.log(`🚀 Сервер: http://localhost:${PORT}`);
});
