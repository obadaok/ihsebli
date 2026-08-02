import { test } from "node:test";
import assert from "node:assert/strict";
import { stripIban, normalizeAmount, formatAmount } from "../src/utils/format.js";
import { normalizeArabic, matchNames } from "../src/domain/nameMatch.js";
import { parseMessage } from "../src/utils/parsing.js";

test("stripIban يحذف أول 5 وآخر 4 أرقام", () => {
  assert.equal(stripIban("1003084099200001"), "8409920");
});

test("stripIban يتجاهل غير الأرقام", () => {
  assert.equal(stripIban("IQ10 0308 4099 2000 01"), "8409920");
});

test("normalizeAmount مع فواصل الآلاف", () => {
  assert.equal(normalizeAmount("46.000.000"), 46000000);
  assert.equal(normalizeAmount("46,000,000"), 46000000);
  assert.equal(normalizeAmount("12.060.000"), 12060000);
});

test("normalizeAmount مع نقطة عشرية", () => {
  assert.equal(normalizeAmount("188.000.000,50"), 188000000);
});

test("normalizeAmount قيمة صفرية ترفض", () => {
  assert.equal(normalizeAmount("0"), null);
  assert.equal(normalizeAmount(""), null);
});

test("formatAmount يعيد التنسيق", () => {
  assert.equal(formatAmount(46000000), "46.000.000");
});

test("normalizeArabic يوحّد الهمزات والياء", () => {
  assert.equal(normalizeArabic("مُحَمَّدُ"), "محمد");
  assert.equal(normalizeArabic("أحمد إبراهيم آء"), "احمد ابراهيم اء");
  assert.equal(normalizeArabic("على"), "علي");
});

test("matchNames يطابق اسماً كاملاً مع اسم مختصر", () => {
  const r = matchNames("ملاك زكي أحمد سليمان", "ملاك زكي");
  assert.equal(r.matched, true);
});

test("matchNames يرفض اسمين مختلفين", () => {
  const r = matchNames("احمد علي", "خالد محمود");
  assert.equal(r.matched, false);
});

test("matchNames يتجاهل كلمة محمد", () => {
  const r = matchNames("محمد عبادة كمال", "عبادة كمال");
  assert.equal(r.matched, true);
});

test("parseMessage يقرأ إنشاء عملية", () => {
  const r = parseMessage("8409920\nعبادة كمال\n46.000.000");
  assert.equal(r.kind, "operation");
  assert.equal(r.operation!.accountNumber, "8409920");
  assert.equal(r.operation!.name, "عبادة كمال");
  assert.equal(r.operation!.requiredAmount, 46000000);
});

test("parseMessage يدعم أسماء متعددة الأسطر", () => {
  const r = parseMessage("1003084099200001\nملاك زكي أحمد سليمان\n188.000.000");
  assert.equal(r.kind, "operation");
  assert.equal(r.operation!.name, "ملاك زكي أحمد سليمان");
});

test("parseMessage يدعم سطراً واحداً", () => {
  const r = parseMessage("8409920 عبادة كمال 46.000.000");
  assert.equal(r.kind, "operation");
  assert.equal(r.operation!.accountNumber, "8409920");
  assert.equal(r.operation!.name, "عبادة كمال");
  assert.equal(r.operation!.requiredAmount, 46000000);
});

test("parseMessage يدعم سطراً واحداً بفواصل عربية", () => {
  const r = parseMessage("8409920، عبادة كمال، 46.000.000");
  assert.equal(r.kind, "operation");
  assert.equal(r.operation!.name, "عبادة كمال");
});

test("parseMessage يدعم الاسم أولاً ثم الحساب ثم المبلغ", () => {
  const r = parseMessage("حسن ادريس\n1765195\n9.000.000");
  assert.equal(r.kind, "operation");
  assert.equal(r.operation!.accountNumber, "1765195");
  assert.equal(r.operation!.name, "حسن ادريس");
  assert.equal(r.operation!.requiredAmount, 9000000);
});

test("parseMessage يدعم الاسم أولاً في سطر واحد", () => {
  const r = parseMessage("حسن ادريس 1765195 9.000.000");
  assert.equal(r.kind, "operation");
  assert.equal(r.operation!.accountNumber, "1765195");
  assert.equal(r.operation!.name, "حسن ادريس");
});
