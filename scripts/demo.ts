import path from "node:path";
import { Store } from "../src/db/database.js";
import { ocrImage } from "../src/ocr/ocr.js";
import { processNotification } from "../src/domain/processor.js";
import { formatOperation } from "../src/utils/format.js";

const base = path.resolve("storage");
const store = new Store(path.join(base, "demo.db"));

const imagePath = process.argv[2] || "/tmp/opencode/notif_test.png";

const op = store.createOperation("8409920", "عبادة كمال", 46000000);
console.log("تم إنشاء العملية:\n" + formatOperation(op) + "\n");

const fields = await ocrImage(imagePath);
console.log("الحقول المستخرجة:", JSON.stringify(fields, null, 2));
console.log();

const result = processNotification({ store, imagePath, fields });
console.log("النتيجة:", result.type);
console.log(result.message);
console.log();

if (result.operation) {
  console.log("الحالة بعد المعالجة:\n" + formatOperation(result.operation));
}

store.close();
