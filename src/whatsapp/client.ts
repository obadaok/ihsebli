import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { webcrypto } from "node:crypto";

if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import qrcode from "qrcode-terminal";
import type { Store } from "../db/database.js";
import { appState } from "../http/state.js";
import { parseMessage } from "../utils/parsing.js";
import { formatOperation, formatAmount } from "../utils/format.js";
import { parseAdminCommand, handleAdminCommand } from "../admin/commands.js";
import { processNotification, getOperationImages } from "../domain/processor.js";
import { ocrImage, isBankNotification } from "../ocr/ocr.js";

export interface WhatsAppConfig {
  store: Store;
  sessionDir: string;
  imagesDir: string;
  logFile: string;
}

let log: (msg: string) => void = () => {};

export async function startWhatsApp(config: WhatsAppConfig): Promise<WASocket> {
  const { store, sessionDir, imagesDir, logFile } = config;
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });

  log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logFile, line + "\n");
  };

  log("🚀 بدء التشغيل...");
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }) as any,
    browser: ["احسب لي", "Chrome", "1.0"],
    markOnlineOnConnect: true,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      appState.qr = qr;
      appState.connection = "connecting";
      appState.statusMessage = "امسح الرمز من الهاتف";
      qrcode.generate(qr, { small: true });
      log("📱 امسح رمز QR أعلاه من الهاتف.");
    }
    if (connection) {
      appState.connection = connection;
    }
    if (connection === "open") {
      appState.qr = "";
      appState.statusMessage = "متصل";
      log("✅ متصل بواتساب بنجاح.");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      appState.lastError = `انقطع الاتصال (الكود ${code})`;
      log(`🔌 انقطع الاتصال (الكود ${code}).`);
      if (shouldReconnect) startWhatsApp(config);
      else log("تم تسجيل الخروج. احذف مجلد الجلسة وأعد التشغيل.");
    }
  });

  sock.ev.on("messages.upsert", async (upsert) => {
    log(`📨 رسالة جديدة (${upsert.type}): ${upsert.messages.length} رسالة`);
    for (const msg of upsert.messages) {
      if (msg.key.fromMe) continue;
      log(`  نوع الرسالة: ${msg.message ? Object.keys(msg.message).join(",") : "لا يوجد"}`);
      await handleIncoming(sock, store, imagesDir, msg);
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      const st = (u as any).status;
      if (st && st !== 3) {
        log(`📬 حالة رسالة: ${st}`);
      }
    }
  });

  return sock;
}

async function handleIncoming(
  sock: WASocket,
  store: Store,
  imagesDir: string,
  msg: BaileysEventMap["messages.upsert"]["messages"][number]
): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!jid) return;
  const reply = (text: string) => sock.sendMessage(jid, { text });

  const imageMsg = msg.message?.imageMessage;
  const viewOnce = msg.message?.viewOnceMessage?.message?.imageMessage;
  const extendedImage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

  if (imageMsg || viewOnce || extendedImage) {
    await handleImage(sock, store, imagesDir, msg, reply);
    return;
  }

  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  if (!text.trim()) return;

  log(`💬 نص: ${text.slice(0, 100)}`);

  const adminCmd = parseAdminCommand(text);
  if (adminCmd) {
    await reply(handleAdminCommand(store, adminCmd));
    return;
  }

  const parsed = parseMessage(text);
  switch (parsed.kind) {
    case "operation": {
      const op = parsed.operation!;
      const existing = store.findOperationByAccount(op.accountNumber);
      const created = store.createOperation(op.accountNumber, op.name, op.requiredAmount);
      log(`✅ تم إنشاء العملية #${created.id}`);
      await reply(
        `✅ تم إنشاء العملية #${created.id}\n\n` +
          formatOperation(created) +
          (existing.length > 0
            ? `\n\n⚠️ يوجد عمليات أخرى لنفس الحساب:\n` +
              existing.map((e) => `#${e.id} ${e.name}`).join("\n")
            : "")
      );
      return;
    }
    case "status": {
      const ops = store.listOperations("open");
      await reply(
        ops.length
          ? "العمليات المفتوحة:\n\n" +
            ops.map((op) => `#${op.id} ${op.accountNumber} ${op.name} — ${formatAmount(op.requiredAmount - op.receivedAmount)} متبقي`).join("\n")
          : "لا توجد عمليات مفتوحة."
      );
      return;
    }
    case "help":
      await reply(
        "مرحباً بك في احسب لي 📊\n\n" +
          "لإنشاء عملية جديدة أرسل 3 أسطر:\n" +
          "رقم الحساب\nالاسم\nالمبلغ\n\n" +
          "مثال:\n8409920\nعبادة كمال\n46.000.000\n\n" +
          "ثم أرسل صور إشعارات البنك مباشرة.\n\n" +
          "لمزيد من الأوامر أرسل /help"
      );
      return;
    case "unknown":
      await reply("لم أفهم الرسالة. أرسل /help للتعليمات.");
      return;
  }
}

async function handleImage(
  sock: WASocket,
  store: Store,
  imagesDir: string,
  msg: BaileysEventMap["messages.upsert"]["messages"][number],
  reply: (text: string) => Promise<unknown>
): Promise<void> {
  const jid = msg.key.remoteJid!;
  try {
    log("🖼️ استقبال صورة... جاري التنزيل");
    let buffer: Buffer;
    try {
      buffer = (await downloadMediaMessage(msg, "buffer", {}, {
        reuploadRequest: sock.updateMediaMessage as any,
        logger: pino({ level: "silent" }) as any,
      })) as Buffer;
    } catch (err) {
      log(`⚠️ فشل تنزيل مباشر: ${(err as Error).message}`);
      buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;
    }
    log(`📥 تم تنزيل الصورة (${buffer.length} بايت)`);

    const filePath = path.join(imagesDir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);
    fs.writeFileSync(filePath, buffer);

    await reply("🔍 جاري قراءة الإشعار...");

    const fields = await ocrImage(filePath);
    log(`🔎 OCR: مبلغ=${fields.amount} حساب=${fields.accountNumber} اسم=${fields.name} عملية=${fields.operationNumber}`);

    if (!isBankNotification(fields.text)) {
      log("⚠️ الصورة ليست إشعار بنك");
      await reply("⚠️ يبدو أن هذه الصورة ليست إشعار بنك. لم يتم احتسابها.");
      return;
    }

    const result = processNotification({ store, imagePath: filePath, fields });
    log(`✅ نتيجة المعالجة: ${result.type}`);
    await reply(result.message);

    if (result.type === "operation_completed" && result.operation) {
      const images = getOperationImages(store, result.operation.id);
      for (const img of images) {
        await sock.sendMessage(jid, {
          image: fs.readFileSync(img),
          caption: `إشعارات العملية ${result.operation.name}`,
        });
      }
    }
  } catch (err) {
    log(`❌ خطأ في معالجة الصورة: ${(err as Error).message}`);
    console.error(err);
    await reply("❌ حدث خطأ أثناء معالجة الصورة. حاول مرة أخرى.");
  }
}
