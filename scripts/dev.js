// Режим разработки без Electron: собранный фронтенд + бэкенд на фиксированном порту.
// `npm run dev` -> открыть http://127.0.0.1:4719/#k=<ключ из консоли>
import crypto from "node:crypto";

process.env.PORT ||= "4719";
process.env.YMC_KEY ||= crypto.randomBytes(16).toString("hex");
await import("../server/cli.js");
