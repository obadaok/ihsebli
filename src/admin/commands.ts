import type { Store, Operation } from "../db/database.js";
import { normalizeAccountNumber, normalizeAmount, formatAmount } from "../utils/format.js";

export type AdminCommand =
  | { kind: "open" }
  | { kind: "completed" }
  | { kind: "all" }
  | { kind: "searchAccount"; account: string }
  | { kind: "searchName"; name: string }
  | { kind: "searchId"; id: number }
  | { kind: "editName"; id: number; name: string }
  | { kind: "editAccount"; id: number; account: string }
  | { kind: "editAmount"; id: number; amount: number }
  | { kind: "cancel"; id: number }
  | { kind: "reopen"; id: number }
  | { kind: "archive"; id: number }
  | { kind: "merge"; target: number; source: number }
  | { kind: "split"; id: number; amount: number }
  | { kind: "report"; scope: "day" | "month" }
  | { kind: "late"; days: number }
  | { kind: "help" };

const COMMANDS: Record<string, (args: string[]) => AdminCommand | null> = {
  open: (a) => a.length === 0 ? { kind: "open" } : null,
  مفتوحة: (a) => a.length === 0 ? { kind: "open" } : null,
  completed: (a) => a.length === 0 ? { kind: "completed" } : null,
  مكتملة: (a) => a.length === 0 ? { kind: "completed" } : null,
  all: (a) => a.length === 0 ? { kind: "all" } : null,
  الكل: (a) => a.length === 0 ? { kind: "all" } : null,
  account: (a) => a.length >= 1 ? { kind: "searchAccount", account: normalizeAccountNumber(a.join("")) } : null,
  حساب: (a) => a.length >= 1 ? { kind: "searchAccount", account: normalizeAccountNumber(a.join("")) } : null,
  name: (a) => a.length >= 1 ? { kind: "searchName", name: a.join(" ") } : null,
  اسم: (a) => a.length >= 1 ? { kind: "searchName", name: a.join(" ") } : null,
  op: (a) => a.length >= 1 ? { kind: "searchId", id: parseInt(a[0]) } : null,
  عملية: (a) => a.length >= 1 ? { kind: "searchId", id: parseInt(a[0]) } : null,
  editname: (a) => a.length >= 2 ? { kind: "editName", id: parseInt(a[0]), name: a.slice(1).join(" ") } : null,
  editaccount: (a) => a.length >= 2 ? { kind: "editAccount", id: parseInt(a[0]), account: normalizeAccountNumber(a[1]) } : null,
  editamount: (a) => a.length >= 2 ? { kind: "editAmount", id: parseInt(a[0]), amount: normalizeAmount(a.slice(1).join("")) ?? 0 } : null,
  cancel: (a) => a.length >= 1 ? { kind: "cancel", id: parseInt(a[0]) } : null,
  إلغاء: (a) => a.length >= 1 ? { kind: "cancel", id: parseInt(a[0]) } : null,
  reopen: (a) => a.length >= 1 ? { kind: "reopen", id: parseInt(a[0]) } : null,
  إعادة: (a) => a.length >= 2 ? { kind: "reopen", id: parseInt(a[1]) } : null,
  archive: (a) => a.length >= 1 ? { kind: "archive", id: parseInt(a[0]) } : null,
  أرشفة: (a) => a.length >= 1 ? { kind: "archive", id: parseInt(a[0]) } : null,
  merge: (a) => a.length >= 2 ? { kind: "merge", target: parseInt(a[0]), source: parseInt(a[1]) } : null,
  دمج: (a) => a.length >= 2 ? { kind: "merge", target: parseInt(a[0]), source: parseInt(a[1]) } : null,
  split: (a) => a.length >= 2 ? { kind: "split", id: parseInt(a[0]), amount: normalizeAmount(a.slice(1).join("")) ?? 0 } : null,
  تقسيم: (a) => a.length >= 2 ? { kind: "split", id: parseInt(a[0]), amount: normalizeAmount(a.slice(1).join("")) ?? 0 } : null,
  report: (a) => a[0] === "day" || a[0] === "اليوم" ? { kind: "report", scope: "day" } : a[0] === "month" || a[0] === "شهر" ? { kind: "report", scope: "month" } : null,
  تقرير: (a) => a[0] === "day" || a[0] === "اليوم" ? { kind: "report", scope: "day" } : a[0] === "month" || a[0] === "شهر" ? { kind: "report", scope: "month" } : null,
  late: (a) => a.length >= 1 ? { kind: "late", days: parseInt(a[0]) || 3 } : { kind: "late", days: 3 },
  متأخرة: (a) => a.length >= 1 ? { kind: "late", days: parseInt(a[0]) || 3 } : { kind: "late", days: 3 },
  help: (a) => { void a; return { kind: "help" }; },
  تعليمات: (a) => { void a; return { kind: "help" }; },
};

export function parseAdminCommand(text: string): AdminCommand | null {
  const t = text.trim();
  if (!t.startsWith("/") && !t.startsWith("!") && !t.startsWith("#")) return null;
  const parts = t.slice(1).split(/\s+/);
  const handler = COMMANDS[parts[0].toLowerCase()];
  if (!handler) return null;
  return handler(parts.slice(1));
}

function renderOperations(ops: Operation[]): string {
  if (ops.length === 0) return "لا توجد عمليات.";
  const lines = ops.map((op) => {
    const remaining = Math.max(0, op.requiredAmount - op.receivedAmount);
    const icon = op.status === "completed" ? "✅" : op.status === "cancelled" ? "🗑️" : op.status === "archived" ? "📦" : "📂";
    return `${icon} #${op.id} ${op.accountNumber} ${op.name}\n   المطلوب: ${formatAmount(op.requiredAmount)} | وصل: ${formatAmount(op.receivedAmount)} | المتبقي: ${formatAmount(remaining)}`;
  });
  return lines.join("\n\n");
}

export function handleAdminCommand(store: Store, cmd: AdminCommand): string {
  switch (cmd.kind) {
    case "help":
      return (
        "أوامر الإدارة:\n" +
        "/open - العمليات المفتوحة\n" +
        "/completed - المكتملة\n" +
        "/all - كل العمليات\n" +
        "/account <رقم> - بحث برقم الحساب\n" +
        "/name <اسم> - بحث بالاسم\n" +
        "/op <id> - بحث برقم العملية\n" +
        "/editname <id> <اسم>\n" +
        "/editaccount <id> <رقم>\n" +
        "/editamount <id> <مبلغ>\n" +
        "/cancel <id>\n" +
        "/reopen <id>\n" +
        "/archive <id>\n" +
        "/merge <id1> <id2>\n" +
        "/split <id> <مبلغ>\n" +
        "/report day|month\n" +
        "/late [أيام]"
      );
    case "open":
      return "العمليات المفتوحة:\n\n" + renderOperations(store.listOperations("open"));
    case "completed":
      return "العمليات المكتملة:\n\n" + renderOperations(store.listOperations("completed"));
    case "all":
      return "كل العمليات:\n\n" + renderOperations(store.listOperations());
    case "searchAccount": {
      const ops = store.findOperationByAccount(cmd.account);
      return ops.length ? "نتائج البحث برقم الحساب:\n\n" + renderOperations(ops) : `لا توجد عمليات بالحساب ${cmd.account}.`;
    }
    case "searchName": {
      const ops = store.listOperations().filter((op) => op.name.includes(cmd.name));
      return ops.length ? "نتائج البحث بالاسم:\n\n" + renderOperations(ops) : `لا توجد عمليات بالاسم "${cmd.name}".`;
    }
    case "searchId": {
      const op = store.getOperation(cmd.id);
      return op ? renderOperations([op]) : `لا توجد عملية برقم ${cmd.id}.`;
    }
    case "editName":
      return updateResult(store.updateOperation(cmd.id, { name: cmd.name }));
    case "editAccount":
      return updateResult(store.updateOperation(cmd.id, { accountNumber: cmd.account }));
    case "editAmount":
      return updateResult(store.updateOperation(cmd.id, { requiredAmount: cmd.amount }));
    case "cancel":
      return updateResult(store.setOperationStatus(cmd.id, "cancelled"));
    case "reopen":
      return updateResult(store.setOperationStatus(cmd.id, "open"));
    case "archive":
      return updateResult(store.setOperationStatus(cmd.id, "archived"));
    case "merge": {
      const target = store.getOperation(cmd.target);
      const source = store.getOperation(cmd.source);
      if (!target || !source) return "إحدى العمليتين غير موجودة.";
      store.addReceivedAmount(target.id, source.receivedAmount);
      store.setOperationStatus(source.id, "archived");
      return `تم دمج العملية #${source.id} في #${target.id}.\n\n` + renderOperations([store.getOperation(target.id)!]);
    }
    case "split": {
      const op = store.getOperation(cmd.id);
      if (!op) return `لا توجد عملية برقم ${cmd.id}.`;
      if (cmd.amount <= 0 || cmd.amount >= op.requiredAmount) return "مبلغ التقسيم غير صالح.";
      store.addReceivedAmount(op.id, -cmd.amount);
      const splitOp = store.createOperation(op.accountNumber, op.name, cmd.amount);
      return `تم تقسيم ${formatAmount(cmd.amount)} من العملية #${cmd.id} إلى عملية جديدة.\n\n` + renderOperations([store.getOperation(cmd.id)!, splitOp]);
    }
    case "report": {
      const ops = store.listOperations();
      const cutoff = new Date();
      if (cmd.scope === "day") cutoff.setHours(0, 0, 0, 0);
      else cutoff.setDate(1);
      const inRange = ops.filter((op) => new Date(op.createdAt) >= cutoff);
      const totalRequired = inRange.reduce((s, o) => s + o.requiredAmount, 0);
      const totalReceived = inRange.reduce((s, o) => s + o.receivedAmount, 0);
      const completed = inRange.filter((o) => o.status === "completed").length;
      return (
        `تقرير ${cmd.scope === "day" ? "يومي" : "شهري"}\n` +
        `العمليات: ${inRange.length}\n` +
        `المكتملة: ${completed}\n` +
        `المطلوب: ${formatAmount(totalRequired)}\n` +
        `الواصل: ${formatAmount(totalReceived)}`
      );
    }
    case "late": {
      const cutoff = new Date(Date.now() - cmd.days * 24 * 60 * 60 * 1000);
      const late = store.listOperations("open").filter((op) => new Date(op.createdAt) < cutoff);
      return late.length
        ? `عمليات متأخرة (أكثر من ${cmd.days} يوم):\n\n` + renderOperations(late)
        : `لا توجد عمليات متأخرة (${cmd.days} يوم).`;
    }
  }
}

function updateResult(op: Operation): string {
  return "تم التحديث:\n\n" + renderOperations([op]);
}
