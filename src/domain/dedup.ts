import crypto from "node:crypto";
import fs from "node:fs";
import type { ExtractedFields } from "../ocr/ocr.js";

export function hashImage(imagePath: string): string {
  const buf = fs.readFileSync(imagePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

export function computeFingerprint(
  imagePath: string,
  fields: ExtractedFields
): string {
  const imageHash = hashImage(imagePath);
  const op = fields.operationNumber ?? "";
  const acc = fields.rawAccount ?? "";
  const amount = fields.amount ?? "";
  return crypto
    .createHash("sha256")
    .update(`${imageHash}|${op}|${acc}|${amount}`)
    .digest("hex")
    .slice(0, 24);
}
