import express from "express";
import cors from "cors";
import multer from "multer";
import net from "net";

import { autoFixHPGL } from "./hpglFix.js";

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

app.post("/cut", upload.single("file"), (req, res) => {
  const raw = req.file.buffer.toString("utf-8");

  const fixed = autoFixHPGL(raw, {
    tolerance: TOL
  });

  queue.push({ data: fixed.hpgl });
  run();

  res.json({
    ok: true,
    before: fixed.before,
    after: fixed.after
  });
});

app.listen(3000, () => {
  console.log("RUN http://localhost:3000");
});