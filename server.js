import express from "express";
import cors from "cors";
import multer from "multer";
import net from "net";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { autoFixHPGL } from "./hpglFix.js";

import { convertEpsToPlt } from "./converter.js"; import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const GS =
  'C:\\Program Files\\gs\\gs10.07.1\\bin\\gswin64c.exe';

const PSTOEDIT =
  'C:\\Program Files\\pstoedit\\pstoedit.exe';



const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

const IP = "192.168.31.31";
const PORT = 9100;

const TOL = 0.4;

let queue = [];
let busy = false;

function run() {
  if (busy || !queue.length) return;

  busy = true;
  const job = queue.shift();

  const socket = new net.Socket();

  socket.connect(PORT, IP, () => {
    socket.write(job.data);
    socket.write("\x03");
    socket.end();
  });

  socket.on("close", () => {
    busy = false;
    setTimeout(run, 200);
  });

  socket.on("error", (e) => {
    console.log("ERR", e.message);
    busy = false;
  });
}

app.post("/cut", upload.single("file"), async (req, res) => {
  try {

    if (!req.file) {
      return res.status(400).json({ error: "Файл не получен" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();

    let hpgl;

    // Если уже PLT/HPGL
    if (ext === ".plt" || ext === ".hpgl") {

      hpgl = req.file.buffer.toString("utf8");

    }
    // Если EPS
    else if (ext === ".eps") {

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eps-"));

      try {

        const epsFile = path.join(tempDir, req.file.originalname);

        await fs.writeFile(epsFile, req.file.buffer);

        console.log("Конвертация EPS:", epsFile);

        const pltFile = await convertEpsToPlt(epsFile);

        // имя файла без расширения
        const baseName = path.parse(req.file.originalname).name;

      const savedPlt = path.join(
          process.cwd(),
          `${baseName}_${Date.now()}.plt`
      );

      await fs.copyFile(pltFile, savedPlt);

      console.log("PLT сохранен:", savedPlt);

      hpgl = await fs.readFile(savedPlt, "utf8");

      } finally {

        await fs.rm(tempDir, {
          recursive: true,
          force: true
        });

      }

    }
    else {

      return res.status(400).json({
        error: "Поддерживаются только .eps, .plt и .hpgl"
      });

    }

    const fixed = autoFixHPGL(hpgl, {
      tolerance: TOL
    });

    queue.push({
      data: fixed.hpgl
    });

    run();

    res.json({
      ok: true,
      before: fixed.before,
      after: fixed.after
    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error: e.message
    });

  }
});

app.listen(5000, () => {
  console.log("RUN http://localhost:5000");
});