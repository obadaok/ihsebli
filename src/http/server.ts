import http from "node:http";
import { appState } from "./state.js";

function qrAscii(qr: string): string {
  let ascii = "";
  const size = Math.sqrt(qr.length) || 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      ascii += qr[y * size + x] === "1" ? "██" : "  ";
    }
    ascii += "\n";
  }
  return ascii;
}

function html(): string {
  const { qr, connection, statusMessage, lastError } = appState;
  const connected = connection === "open";
  const hasQr = qr.length > 0;
  const qrUrl = hasQr
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`
    : "";
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>احسب لي - حالة الاتصال</title>
<style>
body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;padding:2rem;margin:0}
.card{background:#1e293b;border-radius:16px;padding:2rem;max-width:520px;width:100%;text-align:center}
h1{color:#38bdf8;font-size:1.4rem}
.status{padding:.5rem 1rem;border-radius:999px;display:inline-block;font-weight:bold;margin:.5rem 0}
.open{background:#16a34a;color:white}
.connecting{background:#d97706;color:white}
.close{background:#dc2626;color:white}
img{width:280px;height:280px;border-radius:8px;margin:1rem auto}
pre{background:#0f172a;color:#94a3b8;padding:.5rem;border-radius:8px;overflow:auto;direction:ltr;text-align:left;font-size:10px;line-height:1}
p{color:#94a3b8}
a{color:#38bdf8}
</style>
</head>
<body>
<div class="card">
<h1>🤖 احسب لي</h1>
<div class="status ${connected ? "open" : "connecting"}">${connected ? "✅ متصل بواتساب" : hasQr ? "📱 بانتظار مسح الرمز" : statusMessage}</div>
${hasQr && !connected ? `<p>امسح الرمز من واتساب: الإعدادات ← الأجهزة المرتبطة ← ربط جهاز</p><img src="${qrUrl}" alt="QR Code">` : ""}
${lastError ? `<p style="color:#f87171">${lastError}</p>` : ""}
${hasQr && !connected ? `<details><summary>الرمز النصي (اضغط للنسخ)</summary><pre>${qrAscii(qr)}</pre></details>` : ""}
</div>
</body>
</html>`;
}

export function startQrServer(port: number): void {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html());
  });
  server.listen(port, () => {
    console.log(`🖥️ صفحة الحالة (QR): http://localhost:${port}`);
  });
}
