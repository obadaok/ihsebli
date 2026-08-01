import { normalizeAmount, normalizeAccountNumber } from "./format.js";

export interface ParsedOperation {
  accountNumber: string;
  name: string;
  requiredAmount: number;
}

export interface ParseResult {
  kind: "operation" | "help" | "status" | "unknown";
  operation?: ParsedOperation;
}

const HELP = ["help", "مساعدة", "تعليمات", "/help", "؟"];

export function parseMessage(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "unknown" };

  const normalized = trimmed.replace(/\r/g, "");
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length >= 3) {
    const accountNumber = normalizeAccountNumber(lines[0]);
    const amount = normalizeAmount(lines[lines.length - 1]);
    const name = lines.slice(1, lines.length - 1).join(" ");
    if (accountNumber.length >= 6 && amount !== null && name.length > 0) {
      return {
        kind: "operation",
        operation: { accountNumber, name, requiredAmount: amount },
      };
    }
  }

  const lower = trimmed.toLowerCase();
  if (HELP.some((h) => lower.includes(h.toLowerCase())) && trimmed.length < 30) {
    return { kind: "help" };
  }
  if (trimmed === "/status" || trimmed === "الحالة") {
    return { kind: "status" };
  }

  return { kind: "unknown" };
}
