import type { Store, Operation, Notification } from "../db/database.js";
import type { ExtractedFields } from "../ocr/ocr.js";
import { formatAmount } from "../utils/format.js";
import { matchNames } from "./nameMatch.js";
import { computeFingerprint } from "./dedup.js";

export interface ProcessingResult {
  type:
    | "matched"
    | "operation_completed"
    | "duplicate"
    | "not_bank"
    | "unmatched"
    | "ambiguous"
    | "ocr_error"
    | "over_limit";
  operation?: Operation;
  notification?: Notification;
  message: string;
}

export interface ProcessContext {
  store: Store;
  imagePath: string;
  fields: ExtractedFields;
  fingerprint?: string;
}

function candidateOperations(store: Store, fields: ExtractedFields): Operation[] {
  const candidates = new Set<string>();
  if (fields.accountNumber) candidates.add(fields.accountNumber);
  for (const c of fields.accountCandidates ?? []) candidates.add(c);

  if (candidates.size > 0) {
    const found: Operation[] = [];
    for (const acc of candidates) {
      for (const op of store.findOperationByAccount(acc)) {
        if (!found.some((f) => f.id === op.id)) found.push(op);
      }
    }
    if (found.length > 0) return found;
  }

  const byName = fields.name ? store.findOperationByName(fields.name) : [];
  if (byName.length > 0) return byName;

  if (fields.name) {
    const open = store.listOperations().filter((op) => op.status === "open");
    const matched: Operation[] = [];
    for (const op of open) {
      const r = matchNames(fields.name, op.name);
      if (r.matched) matched.push(op);
    }
    return matched;
  }

  const open = store.listOperations().filter((op) => op.status === "open");
  const text = fields.text.replace(/[\s،.؛]/g, "");
  const reversed = text.split("").reverse().join("");
  const bySubstring = open.filter((op) => {
    const account = op.accountNumber;
    return text.includes(account) || reversed.includes(account) || text.includes(account.slice(1));
  });
  return bySubstring;
}

export function processNotification(ctx: ProcessContext): ProcessingResult {
  const { store, imagePath, fields } = ctx;

  const fingerprint = computeFingerprint(imagePath, fields);
  ctx.fingerprint = fingerprint;
  const existing = store.findNotificationByFingerprint(fingerprint);
  if (existing) {
    const op = existing.operationId ? (store.getOperation(existing.operationId) ?? undefined) : undefined;
    return {
      type: "duplicate",
      operation: op,
      message: `⚠️ إشعار مكرر\nتم استلام هذا الإشعار سابقاً${op ? ` للعملية ${op.name}` : ""}.\nلن يتم احتسابه مجدداً.`,
    };
  }

  if (fields.amount === null) {
    const notif = store.saveNotification({
      operationId: null,
      operationNumber: fields.operationNumber,
      date: fields.date,
      time: fields.time,
      accountNumber: fields.accountNumber,
      name: fields.name,
      amount: null,
      imagePath,
      extractedText: fields.text,
      fingerprint,
      status: "error",
    });
    return {
      type: "ocr_error",
      notification: notif,
      message: `❌ تعذر قراءة المبلغ من الإشعار.\nقد تكون الصورة غير واضحة أو مقصوصة.\nالرجاء إرسال الصورة مجدداً.`,
    };
  }

  const candidates = candidateOperations(store, fields);

  if (candidates.length === 0) {
    const notif = store.saveNotification({
      operationId: null,
      operationNumber: fields.operationNumber,
      date: fields.date,
      time: fields.time,
      accountNumber: fields.accountNumber,
      name: fields.name,
      amount: fields.amount,
      imagePath,
      extractedText: fields.text,
      fingerprint,
      status: "unmatched",
    });
    return {
      type: "unmatched",
      notification: notif,
      message:
        `❓ لم يتم العثور على عملية مطابقة.\n` +
        (fields.name ? `الاسم: ${fields.name}\n` : "") +
        (fields.accountNumber ? `الحساب: ${fields.accountNumber}\n` : "") +
        `المبلغ: ${formatAmount(fields.amount)}\n` +
        `تم حفظ الإشعار كقيد الانتظار حتى يتم ربطه.`,
    };
  }

  if (candidates.length > 1) {
    let best: Operation | null = null;
    let bestScore = 0;
    if (fields.name) {
      for (const c of candidates) {
        const r = matchNames(fields.name, c.name);
        if (r.matched && r.score > bestScore) {
          best = c;
          bestScore = r.score;
        }
      }
    }
    if (best) {
      return applyMatch(ctx, best);
    }
    const notif = store.saveNotification({
      operationId: null,
      operationNumber: fields.operationNumber,
      date: fields.date,
      time: fields.time,
      accountNumber: fields.accountNumber,
      name: fields.name,
      amount: fields.amount,
      imagePath,
      extractedText: fields.text,
      fingerprint,
      status: "pending",
    });
    return {
      type: "ambiguous",
      notification: notif,
      message:
        `❓ وجدت أكثر من عملية محتملة لهذا الإشعار:\n` +
        candidates.map((c) => `- ${c.accountNumber} ${c.name}`).join("\n") +
        `\n\nالمبلغ ${formatAmount(fields.amount)} محفوظ مؤقتاً.`,
    };
  }

  return applyMatch(ctx, candidates[0]);
}

function applyMatch(ctx: ProcessContext, op: Operation): ProcessingResult {
  const { store, imagePath, fields } = ctx;
  const fingerprint = ctx.fingerprint ?? "";
  if (fields.amount === null) throw new Error("amount is required for match");

  if (op.status === "cancelled" || op.status === "archived") {
    const notif = store.saveNotification({
      operationId: null,
      operationNumber: fields.operationNumber,
      date: fields.date,
      time: fields.time,
      accountNumber: fields.accountNumber,
      name: fields.name,
      amount: fields.amount,
      imagePath,
      extractedText: fields.text,
      fingerprint,
      status: "unmatched",
    });
    return {
      type: "unmatched",
      notification: notif,
      message: `⚠️ هذا الإشعار يخص عملية ${op.name} وهي حالياً (${op.status}).\nلن يتم احتساب المبلغ.`,
    };
  }

  const notif = store.saveNotification({
    operationId: op.id,
    operationNumber: fields.operationNumber,
    date: fields.date,
    time: fields.time,
    accountNumber: fields.accountNumber,
    name: fields.name,
    amount: fields.amount,
    imagePath,
    extractedText: fields.text,
    fingerprint,
    status: "matched",
  });

  const remainingBefore = op.requiredAmount - op.receivedAmount;
  if (fields.amount > remainingBefore) {
    store.updateOperation(op.id, { requiredAmount: op.receivedAmount + fields.amount });
    const updated = store.getOperation(op.id)!;
    return {
      type: "over_limit",
      operation: updated,
      notification: notif,
      message:
        `⚠️ إشعار يتجاوز المبلغ المتبقي\n` +
        `${op.accountNumber}\n${op.name}\n` +
        `المبلغ المستلم: ${formatAmount(fields.amount)}\n` +
        `المطلوب كان: ${formatAmount(op.requiredAmount)} وتم رفعه تلقائياً إلى: ${formatAmount(updated.requiredAmount)}`,
    };
  }

  const updated = store.addReceivedAmount(op.id, fields.amount);
  const remaining = updated.requiredAmount - updated.receivedAmount;

  if (updated.status === "completed") {
    return {
      type: "operation_completed",
      operation: updated,
      notification: notif,
      message:
        `✅ اكتملت العملية\n` +
        `${updated.accountNumber}\n${updated.name}\n` +
        `${formatAmount(updated.requiredAmount)} ✅`,
    };
  }

  return {
    type: "matched",
    operation: updated,
    notification: notif,
    message:
      `✔️ تم استلام مبلغ\n` +
      `${updated.accountNumber}\n${updated.name}\n` +
      `وصل: ${formatAmount(updated.receivedAmount)}\n` +
      `المتبقي: ${formatAmount(remaining)}`,
  };
}

export function getOperationImages(store: Store, operationId: number): string[] {
  return store
    .findNotificationsByOperation(operationId)
    .filter((n) => n.imagePath && n.status === "matched")
    .map((n) => n.imagePath as string);
}
