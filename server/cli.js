// Запуск без Electron: `npm run serve` — открыть напечатанный адрес в браузере.
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Service } from "./service.js";
import { createServer } from "./http.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.YMC_DATA || path.join(os.homedir(), ".ym-classic");
const port = Number(process.env.PORT || 0);

const svc = new Service({ dataDir, log: (...a) => console.error("[ymc]", ...a) });
const auth = await svc.init();
const srv = createServer({ svc, staticDir: path.join(root, "dist"), key: process.env.YMC_KEY, log: (...a) => console.error("[ymc]", ...a) });
const { url } = await srv.listen(port);
const me = svc.me();
console.log(auth.authorized ? `Сессия: ${me.login} (источник: ${me.source})` : "Сессия не найдена — войдите в официальное приложение");
console.log(`Открыть: ${url}#k=${srv.key}`);
