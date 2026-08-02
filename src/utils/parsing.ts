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
  const parts = normalized.split(/[\s,،]+/).filter(Boolean);

  const buildOperation = (tokens: string[]): ParseResult | null => {
    if (tokens.length < 3) return null;
    const amount = normalizeAmount(tokens[tokens.length - 1]);
    if (amount === null) return null;
    const accountIdx = tokens.findIndex(
      (t, i) => i !== tokens.length - 1 && normalizeAccountNumber(t).length >= 6
    );
    if (accountIdx < 0) return null;
    const accountNumber = normalizeAccountNumber(tokens[accountIdx]);
    const name = tokens.filter((_, i) => i !== accountIdx && i !== tokens.length - 1).join(" ");
    if (accountNumber.length >= 6 && name.length > 0) {
      return { kind: "operation", operation: { accountNumber, name, requiredAmount: amount } };
    }
    return null;
  };

  const result = buildOperation(lines);
  if (result) return result;
  if (lines.length === 1) {
    const single = buildOperation(parts);
    if (single) return single;
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
