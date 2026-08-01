import type { WASocket } from "@whiskeysockets/baileys";

export const appState = {
  qr: "" as string,
  connection: "connecting" as string,
  statusMessage: "جاري الاتصال...",
  lastError: "" as string,
  pairingCode: "" as string,
  pairingPhone: "" as string,
  socket: null as WASocket | null,
};
