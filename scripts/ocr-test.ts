import { ocrImage, extractFields, isBankNotification } from "../src/ocr/ocr.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: tsx scripts/ocr-test.ts <image>");
  process.exit(1);
}

const fields = await ocrImage(path);
console.log("--- نص مستخرج ---");
console.log(fields.text);
console.log("--- حقول ---");
console.log(JSON.stringify(
  {
    operationNumber: fields.operationNumber,
    date: fields.date,
    time: fields.time,
    accountNumber: fields.accountNumber,
    rawAccount: fields.rawAccount,
    name: fields.name,
    amount: fields.amount,
    isBank: isBankNotification(fields.text),
  },
  null,
  2
));
