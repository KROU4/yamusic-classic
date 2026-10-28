// Development mode without Electron: built frontend + backend on a fixed port.
// `npm run dev` -> open http://127.0.0.1:4719/#k=<key from the console>
import crypto from "node:crypto";

process.env.PORT ||= "4719";
process.env.YMC_KEY ||= crypto.randomBytes(16).toString("hex");
await import("../server/cli.js");
