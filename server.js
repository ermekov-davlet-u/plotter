import express from "express";
import cors from "cors";
import multer from "multer";
import net from "net";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

// Пути к сторонним программам
const GS = 'C:\\Program Files\\gs\\gs10.07.1\\bin\\gswin64c.exe';
const PSTOEDIT = 'C:\\Program Files\\pstoedit\\pstoedit.exe';

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

// Сетевые настройки плоттера
const IP = "192.168.31.31";
const PORT = 9100;

let queue = [];
let busy = false;

// Очередь и функция отправки на плоттер
function run() {
  if (busy || !queue.length) return;

  busy = true;
  const job = queue.shift();

  const socket = new net.Socket();
  socket.setTimeout(10000); // Таймаут 10 секунд, если плоттер недоступен

  console.log(`[Плоттер] Отправка задания на ${IP}:${PORT}...`);

  socket.connect(PORT, IP, () => {
    console.log("[Плоттер] Соединение установлено. Передача данных резки...");
    
    // Переводим HP-GL строку в бинарный буфер
    const bufferData = Buffer.from(job.data, "utf-8");
    
    socket.write(bufferData, () => {
      console.log("[Плоттер] Данные успешно отправлены в буфер станка.");
      socket.end(); // Даем сигнал плоттеру начать резку
    });
  });

  socket.on("close", () => {
    console.log("[Плоттер] Соединение закрыто.");
    busy = false;
    setTimeout(run, 500); // Пауза перед следующим заданием
  });

  socket.on("timeout", () => {
    console.log("[Плоттер] Превышено время ожидания ответа от плоттера (Timeout).");
    socket.destroy();
    busy = false;
    setTimeout(run, 1000);
  });

  socket.on("error", (e) => {
    console.error("[Плоттер] ОШИБКА ПОДКЛЮЧЕНИЯ:", e.message);
    busy = false;
    setTimeout(run, 2000);
  });
}

// Внутренняя функция конвертации EPS -> PLT с пост-обработкой параметров резки
async function convertEpsToPlt(epsFile) {
  const dir = path.dirname(epsFile);
  const ps = path.join(dir, "temp.ps");
  const plt = path.join(dir, "temp.plt");

  // 1. Конвертация EPS в PS через Ghostscript
  await exec(GS, [
    "-dNOPAUSE",
    "-dBATCH",
    "-sDEVICE=ps2write",
    `-sOutputFile=${ps}`,
    epsFile,
  ]);

  // 2. Конвертация PS в PLT через pstoedit
  await exec(PSTOEDIT, [
    "-f",
    "hpgl",
    ps,
    plt,
  ]);

  // 3. Пост-обработка: принудительно выставляем толщину PW0.025 и убираем мусор pstoedit
  try {
    let content = await fs.readFile(plt, "utf-8");

    // Удаляем все автоматические мелкие PW (например, PW0.00992;) перед линиями
    content = content.replace(/PW[\d.]+;/g, "");

    // Наш эталонный заголовок с толщиной пера из первого файла
    const header = "IN;PW0.025;PU;PA;SP1;LT;\n";

    // Заменяем стандартное начало pstoedit (до первых координат PU) на чистый заголовок
    if (content.startsWith("IN;")) {
      content = content.replace(/^IN;([\s\S]*?)(?=PU\d)/, header);
    } else {
      content = header + content;
    }

    await fs.writeFile(plt, content, "utf-8");
  } catch (error) {
    console.error("[Конвертер] Ошибка при модификации параметров PLT:", error);
  }

  // Чистим временный PS файл
  try {
    await fs.unlink(ps);
  } catch (e) {}

  return plt;
}

// Роут для приема файлов на резку
app.post("/cut", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Файл не получен" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let hpgl;

    // Если файл уже в формате PLT/HPGL
    if (ext === ".plt" || ext === ".hpgl") {
      let content = req.file.buffer.toString("utf8");
      
      // Обрабатываем и готовый PLT, чтобы там тоже была толщина 0.025
      content = content.replace(/PW[\d.]+;/g, "");
      const header = "IN;PW0.025;PU;PA;SP1;LT;\n";
      if (content.startsWith("IN;")) {
        hpgl = content.replace(/^IN;([\s\S]*?)(?=PU\d)/, header);
      } else {
        hpgl = header + content;
      }
    } 
    // Если пришел файл EPS
    else if (ext === ".eps") {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eps-"));

      try {
        const epsFile = path.join(tempDir, req.file.originalname);
        await fs.writeFile(epsFile, req.file.buffer);

        console.log("[Сервер] Конвертация EPS:", epsFile);
        const pltFile = await convertEpsToPlt(epsFile);

        const baseName = path.parse(req.file.originalname).name;
        const savedPlt = path.join(
          process.cwd(),
          `${baseName}_${Date.now()}.plt`
        );

        // Сохраняем копию готового PLT на диск
        await fs.copyFile(pltFile, savedPlt);
        console.log("[Сервер] PLT сохранен на диск:", savedPlt);

        hpgl = await fs.readFile(savedPlt, "utf8");
      } finally {
        // Удаляем временную папку
        await fs.rm(tempDir, {
          recursive: true,
          force: true
        });
      }
    } else {
      return res.status(400).json({
        error: "Поддерживаются только .eps, .plt и .hpgl"
      });
    }

    // Добавляем чистый HPGL код напрямую в очередь на резку (без autoFixHPGL)
    queue.push({
      data: hpgl
    });

    // Запускаем отправку
    run();

    res.json({
      ok: true,
      message: "Файл добавлен в очередь на резку"
    });

  } catch (e) {
    console.error("[Сервер] Критическая ошибка:", e);
    res.status(500).json({
      error: e.message
    });
  }
});

app.listen(5000, () => {
  console.log("Сервер запущен: http://localhost:5000");
});