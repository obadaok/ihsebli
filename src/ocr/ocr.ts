import tesseract from "node-tesseract-ocr";
import { normalizeAccountNumber, normalizeAmount } from "../utils/format.js";

export interface ExtractedFields {
  text: string;
  operationNumber: string | null;
  date: string | null;
  time: string | null;
  accountNumber: string | null;
  rawAccount: string | null;
  name: string | null;
  amount: number | null;
  accountCandidates?: string[];
}

interface OcrPass {
  lang: string;
  psm: number;
  image: string;
  weight: number;
}

const LABELS = [
  "الى حساب",
  "إلى حساب",
  "الى الحساب",
  "الحساب المرسل اليه",
  "من حساب",
  "من الحساب",
];

const NOISE_WORDS = new Set([
  "تحويلات",
  "تحويل",
  "المبلغ",
  "مبلغ",
  "التاريخ",
  "الزمن",
  "التعليق",
  "رقم الموبايل",
  "من حساب",
  "الى حساب",
  "إلى حساب",
  "طباعة",
  "تحميل",
  "بنك الخرطوم",
  "بنكك",
  "حساب",
  "موافق",
  "إضافة",
  "مشاركة",
  "بلال",
  "و",
  "ما",
  "لا",
]);

const OPERATION_NUMBER_PATTERNS = [
  /(?:رقم العملية|رقم العمليه)\s*[:：]?\s*(?:#)?\s*([\d]{4,12})/i,
];

const AMOUNT_PATTERNS = [
  /(?:المبلغ|مبلغ)\s*[:：]?\s*([\d.,]+)/i,
  /(?:amount|mblgh)\s*[:：]?\s*([\d.,]+)/i,
];

const DATE_PATTERNS = [
  /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/,
  /(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/,
];

const TIME_PATTERNS = [
  /(\d{1,2}):(\d{2}):?(\d{2})?/,
];

const BANK_NOTIFICATION_HINTS = [
  "تحويل",
  "مبلغ",
  "المبلغ",
  "حساب",
  "مستفيد",
  "بنك",
  "البنك",
  "رقم العملية",
  "الرصيد",
  "رصيد",
];

export async function runOcr(imagePath: string, opts: { lang?: string; psm?: number; timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  return Promise.race([
    tesseract.recognize(imagePath, {
      lang: opts.lang ?? "ara+eng",
      oem: 1,
      psm: opts.psm ?? 6,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`تجاوز زمن OCR (${timeoutMs}ms)`)), timeoutMs);
    }),
  ]);
}

export function looksLikeBankNotification(text: string): boolean {
  return BANK_NOTIFICATION_HINTS.some((h) => text.includes(h));
}

function extractOperationNumber(text: string): string | null {
  for (const p of OPERATION_NUMBER_PATTERNS) {
    const m = text.match(p);
    if (m) return m[1];
  }
  const idx = text.indexOf("رقم العملية");
  if (idx >= 0) {
    const after = text.slice(idx + "رقم العملية".length);
    const digits = after.match(/[\d]{4,12}/);
    if (digits) return digits[0];
  }
  return null;
}

function accountFromLabelGroup(digits: string): { account: string | null; raw: string | null } | null {
  const cleaned = digits.replace(/[^\d]/g, "");
  if (cleaned.length < 10) return null;
  const candidates: string[] = [];
  const stripped = cleaned.slice(5);
  for (let drop = 0; drop <= 4; drop++) {
    const c = stripped.slice(0, stripped.length - drop);
    if (c.length >= 6 && c.length <= 10) candidates.push(c);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.length - a.length);
  return { account: candidates[0], raw: cleaned };
}

export function accountCandidatesFromText(text: string): string[] {
  const seqs = text.match(/1003[\d ]{5,}[\d]{1,4}/g) ?? [];
  const out = new Set<string>();
  for (const seq of seqs) {
    const cleaned = seq.replace(/[^\d]/g, "");
    const stripped = cleaned.slice(5);
    for (let drop = 0; drop <= 5; drop++) {
      const c = stripped.slice(0, stripped.length - drop);
      if (c.length >= 6 && c.length <= 9) out.add(c);
    }
  }
  return [...out];
}

function extractAccountFromText(text: string): { account: string | null; raw: string | null } {
  for (const label of LABELS) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}\\s*[:：]?\\s*([\\d\\s]{10,})`, "i");
    const m = text.match(re);
    if (m) {
      const group = m[1];
      const result = accountFromLabelGroup(group);
      if (result) return result;
    }
  }
  const m = text.match(/\b(1003[\d ]{6,}[\d]{1,4})\b/);
  if (m) {
    const result = accountFromLabelGroup(m[1]);
    if (result) return result;
  }
  return { account: null, raw: null };
}

function extractAmount(text: string): number | null {
  for (const p of AMOUNT_PATTERNS) {
    const m = text.match(p);
    if (m) {
      const amount = normalizeAmount(m[1]);
      if (amount !== null) return amount;
    }
  }
  const tokens = text.match(/[\d.,]{5,}/g) ?? [];
  for (const token of tokens) {
    const amount = normalizeAmount(token);
    if (amount !== null && amount > 1000) return amount;
  }
  return null;
}

function extractDate(text: string): string | null {
  const m = text.match(DATE_PATTERNS[0]) || text.match(DATE_PATTERNS[1]);
  if (!m) return null;
  if (m[3].length === 4) return `${m[3]}-${m[2]}-${m[1]}`;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function extractTime(text: string): string | null {
  const m = text.match(TIME_PATTERNS[0]);
  if (!m) return null;
  return `${m[1]}:${m[2]}${m[3] ? ":" + m[3] : ""}`;
}

function isNoise(name: string): boolean {
  const words = name.split(" ");
  return words.length === 1 && NOISE_WORDS.has(words[0]);
}

function extractNameFromText(text: string): string | null {
  const lines = text.split(/\n/).map((l) => l.trim());
  const labelRe = /(?:اسم المستفيد|اسم المستلم|اسم المحول اليه|إسم المرسل اليه|اسم المرسل اليه|المستفيد)\s*[:：]?\s*(.+)/i;
  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (m) {
      const rest = m[1].replace(/[^\u0621-\u064A\s]/g, " ").replace(/\s+/g, " ").trim();
      if (rest.length >= 3 && !isNoise(rest)) candidates.push(rest);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[^\u0621-\u064A\s]/g, " ").replace(/\s+/g, " ").trim();
    if (line.split(" ").filter((w) => w.length > 1).length >= 2 && !isNoise(line)) {
      candidates.push(line);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.split(" ").length - a.split(" ").length);
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = c.replace(/\s+/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique[0] ?? null;
}

export function extractFields(text: string): ExtractedFields {
  const { account, raw } = extractAccountFromText(text);
  return {
    text,
    operationNumber: extractOperationNumber(text),
    date: extractDate(text),
    time: extractTime(text),
    accountNumber: account,
    rawAccount: raw,
    name: extractNameFromText(text),
    amount: extractAmount(text),
    accountCandidates: accountCandidatesFromText(text),
  };
}

function pickBest<T>(values: Array<{ v: T | null; w: number }>): T | null {
  let best: T | null = null;
  for (const { v, w } of values) {
    if (v !== null && v !== undefined && v !== "") {
      if (best === null) best = v;
      else if (w > 0) best = v;
    }
  }
  return best;
}

export async function ocrImage(imagePath: string): Promise<ExtractedFields> {
  const passes: OcrPass[] = [
    { lang: "ara+eng", psm: 6, image: imagePath, weight: 3 },
    { lang: "ara", psm: 11, image: imagePath, weight: 2 },
  ];

  const results: Array<{ pass: OcrPass; text: string }> = [];
  for (const pass of passes) {
    try {
      results.push({ pass, text: await runOcr(pass.image, { lang: pass.lang, psm: pass.psm, timeoutMs: 30000 }) });
    } catch (err) {
      console.error(`فشل ممر OCR (${pass.lang} psm${pass.psm}):`, (err as Error).message);
    }
  }

  const texts = results.map((r) => r.text);
  const mergedText = texts.join("\n");

  const accounts = results.map((r) => ({ v: extractAccountFromText(r.text).account, w: r.pass.weight }));
  const raws = results.map((r) => ({ v: extractAccountFromText(r.text).raw, w: r.pass.weight }));
  const amounts = results.map((r) => ({ v: extractAmount(r.text), w: r.pass.weight }));
  const names = results.map((r) => ({ v: extractNameFromText(r.text), w: r.pass.weight }));
  const opNumbers = results.map((r) => ({ v: extractOperationNumber(r.text), w: r.pass.weight }));
  const dates = results.map((r) => ({ v: extractDate(r.text), w: r.pass.weight }));
  const times = results.map((r) => ({ v: extractTime(r.text), w: r.pass.weight }));

  const candidateSet = new Set<string>();
  for (const r of results) {
    for (const c of accountCandidatesFromText(r.text)) candidateSet.add(c);
    const { account } = extractAccountFromText(r.text);
    if (account) candidateSet.add(account);
  }

  return {
    text: mergedText,
    operationNumber: pickBest(opNumbers),
    date: pickBest(dates),
    time: pickBest(times),
    accountNumber: pickBest(accounts),
    rawAccount: pickBest(raws),
    name: pickBest(names),
    amount: pickBest(amounts),
    accountCandidates: [...candidateSet],
  };
}

export function extractDigitGroups(text: string): string[] {
  const groups = text.match(/[\d][\d ]{5,}[\d]/g) ?? [];
  return groups.map((g) => normalizeAccountNumber(g)).filter((g) => g.length >= 6);
}

export { looksLikeBankNotification as isBankNotification };
