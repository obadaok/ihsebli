import path from "node:path";
import { Store } from "./db/database.js";
import { startWhatsApp } from "./whatsapp/client.js";
import { startQrServer } from "./http/server.js";

const baseDir = process.env.IHSEBLI_DATA ?? path.resolve("storage");

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 0;
  if (port > 0) {
    startQrServer(port);
  }

  const store = new Store(path.join(baseDir, "ihsebli.db"));
  console.log("📊 قاعدة البيانات جاهزة.");

  await startWhatsApp({
    store,
    sessionDir: path.join(baseDir, "session"),
    imagesDir: path.join(baseDir, "images"),
    logFile: path.join(baseDir, "bot.log"),
  });

  console.log("🤖 احسب لي يعمل الآن. بانتظار رسائل واتساب...");
}

main().catch((err) => {
  console.error("فشل بدء التشغيل:", err);
  process.exit(1);
});
