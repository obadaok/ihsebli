export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export function stripIban(raw: string): string {
  const digits = normalizeAccountNumber(raw);
  if (digits.length > 13) {
    return digits.slice(5, digits.length - 4);
  }
  return digits;
}

export function normalizeAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");
  let amountStr: string;
  if (hasDot && hasComma) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    const decimalSep = lastDot > lastComma ? "." : ",";
    const integerPart = decimalSep === "." ? cleaned.split(".")[0] : cleaned.split(",")[0];
    const dec = decimalSep === "." ? cleaned.split(".").pop()! : cleaned.split(",").pop()!;
    const integer = integerPart.replace(/[.,]/g, "");
    amountStr = dec.length > 0 ? integer : cleaned.replace(/[.,]/g, "");
  } else if (hasDot) {
    const parts = cleaned.split(".");
    const last = parts.pop()!;
    const allThousand = parts.every((p) => p.length === 3) && parts.length >= 1 && last.length === 3;
    if (allThousand) {
      amountStr = parts.join("") + last;
    } else if (last.length <= 2 && parts.length === 1) {
      amountStr = parts[0] + last;
    } else {
      amountStr = cleaned.replace(/\./g, "");
    }
  } else if (hasComma) {
    const parts = cleaned.split(",");
    const last = parts.pop()!;
    const allThousand = parts.every((p) => p.length === 3) && parts.length >= 1 && last.length === 3;
    if (allThousand) {
      amountStr = parts.join("") + last;
    } else if (last.length <= 2 && parts.length === 1) {
      amountStr = parts[0] + last;
    } else {
      amountStr = cleaned.replace(/,/g, "");
    }
  } else {
    amountStr = cleaned;
  }
  const num = Number(amountStr);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

export function formatAmount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatOperation(op: {
  accountNumber: string;
  name: string;
  requiredAmount: number;
  receivedAmount: number;
  status: string;
}): string {
  const remaining = Math.max(0, op.requiredAmount - op.receivedAmount);
  const done = op.receivedAmount >= op.requiredAmount;
  return (
    `${op.accountNumber}\n${op.name}\n` +
    `${done ? "اكتملت ✅" : ""}\n` +
    `المطلوب: ${formatAmount(op.requiredAmount)}\n` +
    `وصل: ${formatAmount(op.receivedAmount)}\n` +
    `المتبقي: ${formatAmount(remaining)}\n` +
    `الحالة: ${op.status}`
  );
}
