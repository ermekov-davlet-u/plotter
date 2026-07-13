import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises"; // Добавляем модуль для работы с файлами

const exec = promisify(execFile);

const GS = 'C:\\Program Files\\gs\\gs10.07.1\\bin\\gswin64c.exe';
const PSTOEDIT = 'C:\\Program Files\\pstoedit\\pstoedit.exe';

export async function convertEpsToPlt(epsFile) {
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

  // 3. Пост-обработка PLT файла под параметры первого файла
  try {
    let content = await fs.readFile(plt, "utf-8");

    // Удаляем все автоматически сгенерированные pstoedit команды PW (например, PW0.00992;)
    // чтобы они не перебивали нашу глобальную настройку
    content = content.replace(/PW[\d.]+;/g, "");

    // Базовые настройки из вашего первого файла:
    // IN (Инициализация), PW0.025 (Толщина), PU (Поднять перо), PA (Абсолютные координаты), SP1 (Выбрать перо 1)
    const header = "IN;PW0.025;PU;PA;SP1;LT;";

    // Собираем файл заново: заменяем стандартное начало pstoedit на наш заголовок
    // Обычно pstoedit начинает с "IN;SC;..." или просто "IN;"
    if (content.startsWith("IN;")) {
      content = content.replace(/^IN;(\x1B\.[^\s;]+;)?(SC;)?/, header);
    } else {
      content = header + content;
    }

    // Записываем измененный контент обратно в файл
    await fs.writeFile(plt, content, "utf-8");
  } catch (error) {
    console.error("Ошибка при модификации параметров PLT:", error);
  }

  // (Опционально) Удаляем временный ps файл, если он больше не нужен
  try {
    await fs.unlink(ps);
  } catch (e) {}

  return plt;
}