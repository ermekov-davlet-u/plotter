import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import net from "net";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// -------------------------
// НАСТРОЙКИ ПЛОТТЕРА
// -------------------------
const PLOTTER_IP = "192.168.31.31"; // <-- ВСТАВЬ IP плоттера
const PLOTTER_PORT = 9100;


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

    client.connect(9100, PLOTTER_IP, () => {
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

// -------------------------
// ТЕСТ РЕЗКИ
// -------------------------
app.get("/test", (req, res) => {
  const hpgl = `
    IN;
SP1;
PU;

PA500,500;

; круг (аппроксимация)
PD500,900;
PD650,880;
PD780,780;
PD880,650;
PD900,500;
PD880,350;
PD780,220;
PD650,120;
PD500,100;
PD350,120;
PD220,220;
PD120,350;
PD100,500;
PD120,650;
PD220,780;
PD350,880;
PD500,900;

PU;
SP0;
    `;

  queue.push({ data: hpgl });
  processQueue();

  res.json({ message: "Тестовая резка отправлена" });
});

app.get("/cut-eps", (req, res) => {
  try {
    const filePath = "test.eps";

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "test.eps не найден" });
    }

    // 1. конвертация EPS → HPGL
    const hpgl = epsToHpgl(filePath);

    // 2. отправка в очередь
    console.log(hpgl);
    
    queue.push({ data: hpgl });
    processQueue();

    res.json({
      message: "EPS конвертирован и отправлен на резку"
    });

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

    socket.on("error", () => { });
    socket.on("timeout", () => socket.destroy());
  }

  [9100, 515, 631].forEach(testPort);
});

// -------------------------
// РЕЗКА ФАЙЛА (.plt / HPGL)
// -------------------------
app.post("/cut", (req, res) => {
  const { filePath } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: "Не указан filePath" });
  }

  try {
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Файл не найден" });
    }

    const data = fs.readFileSync(fullPath, "utf-8");

    queue.push({ data });
    processQueue();

    res.json({ message: "Файл добавлен в очередь" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------
app.listen(PORT, () => {
  console.log(`🚀 Сервер: http://localhost:${PORT}`);
});