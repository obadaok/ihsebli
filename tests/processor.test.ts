import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/db/database.js";
import { processNotification } from "../src/domain/processor.js";
import type { ExtractedFields } from "../src/ocr/ocr.js";

let store: Store;
let imageDir: string;
let counter = 0;

function makeImage(seed: string): string {
  const file = path.join(imageDir, `test_${counter++}_${seed}.jpg`);
  fs.writeFileSync(file, Buffer.from(`fake-image-${seed}-${counter}`));
  return file;
}

function fields(partial: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    text: "رقم العملية: 12345",
    operationNumber: "12345",
    date: "2026-01-01",
    time: "10:30",
    accountNumber: null,
    rawAccount: null,
    name: null,
    amount: null,
    ...partial,
  };
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ihsebli-test-"));
  store = new Store(path.join(dir, "test.db"));
  imageDir = dir;
});

test("إنشاء عملية وإضافة إشعار وربطه بالعملية", () => {
  const op = store.createOperation("8409920", "عبادة كمال", 46000000);
  assert.equal(op.status, "open");

  const result = processNotification({
    store,
    imagePath: makeImage("a"),
    fields: fields({ accountNumber: "8409920", amount: 12060000 }),
  });

  assert.equal(result.type, "matched");
  assert.equal(result.operation!.receivedAmount, 12060000);
  assert.equal(result.operation!.status, "open");
});

test("اكتمال العملية عند وصول كامل المبلغ", () => {
  const op = store.createOperation("8409920", "عبادة كمال", 46000000);
  const first = processNotification({
    store,
    imagePath: makeImage("b1"),
    fields: fields({ accountNumber: "8409920", amount: 12060000 }),
  });
  assert.equal(first.type, "matched");
  assert.equal(store.getOperation(op.id)!.status, "open");

  const second = processNotification({
    store,
    imagePath: makeImage("b2"),
    fields: fields({ accountNumber: "8409920", amount: 12060000 }),
  });
  assert.equal(second.type, "matched");
  assert.equal(store.getOperation(op.id)!.status, "open");

  const final = processNotification({
    store,
    imagePath: makeImage("b3"),
    fields: fields({ accountNumber: "8409920", amount: 21880000 }),
  });
  assert.equal(final.type, "operation_completed");
  assert.equal(store.getOperation(op.id)!.status, "completed");
  assert.equal(store.getOperation(op.id)!.receivedAmount, 46000000);
});

test("منع التكرار: نفس الصورة لا تحتسب مرتين", () => {
  store.createOperation("8409920", "عبادة كمال", 46000000);
  const img = makeImage("dup");
  const first = processNotification({
    store,
    imagePath: img,
    fields: fields({ accountNumber: "8409920", amount: 12060000 }),
  });
  assert.equal(first.type, "matched");

  const second = processNotification({
    store,
    imagePath: img,
    fields: fields({ accountNumber: "8409920", amount: 12060000 }),
  });
  assert.equal(second.type, "duplicate");
  assert.equal(store.getOperation(1)!.receivedAmount, 12060000);
});

test("إشعار لا يجد عملية مطابقة يُحفظ كقيد انتظار", () => {
  const result = processNotification({
    store,
    imagePath: makeImage("c"),
    fields: fields({ accountNumber: "9999999", amount: 5000000 }),
  });
  assert.equal(result.type, "unmatched");
  assert.equal(result.notification!.status, "unmatched");
});

test("مطابقة عبر الاسم عندما يكون الحساب ناقصاً", () => {
  store.createOperation("8409920", "ملاك زكي", 188000000);
  const result = processNotification({
    store,
    imagePath: makeImage("d"),
    fields: fields({
      accountNumber: null,
      name: "ملاك زكي أحمد سليمان",
      amount: 160000000,
    }),
  });
  assert.equal(result.type, "matched");
  assert.equal(result.operation!.receivedAmount, 160000000);
});

test("إشعار أكبر من المتبقي يرفع المطلوب تلقائياً", () => {
  store.createOperation("8409920", "عبادة كمال", 46000000);
  const result = processNotification({
    store,
    imagePath: makeImage("e"),
    fields: fields({ accountNumber: "8409920", amount: 50000000 }),
  });
  assert.equal(result.type, "over_limit");
  assert.equal(result.operation!.requiredAmount, 50000000);
});

test("إشعار بلا مبلغ (خطأ OCR) يعطي رسالة خطأ", () => {
  const result = processNotification({
    store,
    imagePath: makeImage("f"),
    fields: fields({ accountNumber: "8409920", amount: null }),
  });
  assert.equal(result.type, "ocr_error");
});

test("إشعار لعملية ملغاة لا يحتسب", () => {
  const op = store.createOperation("8409920", "عبادة كمال", 46000000);
  store.setOperationStatus(op.id, "cancelled");
  const result = processNotification({
    store,
    imagePath: makeImage("g"),
    fields: fields({ accountNumber: "8409920", amount: 10000000 }),
  });
  assert.equal(result.type, "unmatched");
  assert.equal(store.getOperation(op.id)!.receivedAmount, 0);
});
