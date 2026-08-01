const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

const HAMZA_MAP: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
};

const YAA_MAP: Record<string, string> = {
  "ى": "ي",
  "ئ": "ي",
};

const TA_MARBUTA_MAP: Record<string, string> = {
  "ة": "ه",
};

export function normalizeArabic(text: string): string {
  let out = text.replace(DIACRITICS, "");
  out = out.replace(/[أإآٱ]/g, (c) => HAMZA_MAP[c] ?? "ا");
  out = out.replace(/[ىئ]/g, (c) => YAA_MAP[c] ?? "ي");
  out = out.replace(/ة/g, (c) => TA_MARBUTA_MAP[c] ?? "ه");
  out = out.replace(/[^\u0621-\u064A\s]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

const NOISE_WORDS = new Set([
  "محمد",
  "السيد",
  "الاستاذ",
  "الأستاذ",
  "د",
  "دكتور",
  "الشيخ",
]);

export function tokenize(name: string): string[] {
  const normalized = normalizeArabic(name);
  return normalized.split(" ").filter((t) => t.length > 1 && !NOISE_WORDS.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function tokenSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export interface NameMatchResult {
  score: number;
  matched: boolean;
}

const CONTAINS_THRESHOLD = 0.85;
const STRICT_THRESHOLD = 0.6;

export function matchNames(notificationName: string, operationName: string): NameMatchResult {
  const a = tokenize(notificationName);
  const b = tokenize(operationName);
  if (a.length === 0 || b.length === 0) return { score: 0, matched: false };

  const setA = new Set(a);
  const setB = new Set(b);
  const common = new Set([...setA].filter((t) => setB.has(t))).size;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = common / union;

  const matches = b.map((bt) => Math.max(...a.map((at) => tokenSimilarity(at, bt))));
  const avgBest = matches.reduce((s, m) => s + m, 0) / matches.length;

  const contains = (setA.size >= setB.size && setB.has([...setA][0])) ||
    (setB.size >= setA.size && setA.has([...setB][0]));

  const score = Math.max(jaccard * 0.5 + avgBest * 0.5, contains ? 0.7 : 0);
  const matched = score >= CONTAINS_THRESHOLD || (score >= STRICT_THRESHOLD && jaccard >= 0.5);
  return { score, matched };
}

export function bestNameMatch(notificationName: string, candidates: string[]): { name: string; score: number; matched: boolean } | null {
  let best: { name: string; score: number; matched: boolean } | null = null;
  for (const candidate of candidates) {
    const r = matchNames(notificationName, candidate);
    if (!best || r.score > best.score) best = { name: candidate, score: r.score, matched: r.matched };
  }
  return best;
}
