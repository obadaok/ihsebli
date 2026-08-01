import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export type OperationStatus = "open" | "completed" | "cancelled" | "archived";

export interface Operation {
  id: number;
  accountNumber: string;
  name: string;
  requiredAmount: number;
  receivedAmount: number;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: number;
  operationId: number | null;
  operationNumber: string | null;
  date: string | null;
  time: string | null;
  accountNumber: string | null;
  name: string | null;
  amount: number | null;
  imagePath: string | null;
  extractedText: string | null;
  fingerprint: string | null;
  status: "pending" | "matched" | "unmatched" | "duplicate" | "error";
  receivedAt: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  details: string;
  createdAt: string;
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_number TEXT NOT NULL,
        name TEXT NOT NULL,
        required_amount INTEGER NOT NULL,
        received_amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id INTEGER REFERENCES operations(id),
        operation_number TEXT,
        date TEXT,
        time TEXT,
        account_number TEXT,
        name TEXT,
        amount INTEGER,
        image_path TEXT,
        extracted_text TEXT,
        fingerprint TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_operation_id ON notifications(operation_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_fingerprint ON notifications(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);
      CREATE INDEX IF NOT EXISTS idx_operations_account ON operations(account_number);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private audit(action: string, entityType: string, entityId: number | null, details: unknown): void {
    this.db
      .prepare(
        "INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(action, entityType, entityId, JSON.stringify(details), new Date().toISOString());
  }

  createOperation(accountNumber: string, name: string, requiredAmount: number): Operation {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO operations (account_number, name, required_amount, received_amount, status, created_at, updated_at)
         VALUES (?, ?, ?, 0, 'open', ?, ?)`
      )
      .run(accountNumber, name, requiredAmount, now, now);
    const op = this.getOperation(info.lastInsertRowid as number)!;
    this.audit("create", "operation", op.id, {
      accountNumber,
      name,
      requiredAmount,
    });
    return op;
  }

  getOperation(id: number): Operation | null {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id) as any;
    return row ? this.rowToOperation(row) : null;
  }

  findOperationByAccount(accountNumber: string): Operation[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM operations WHERE account_number = ? AND status != 'cancelled' ORDER BY created_at ASC"
      )
      .all(accountNumber) as any[];
    return rows.map(this.rowToOperation);
  }

  findOperationByName(name: string): Operation[] {
    const rows = this.db
      .prepare("SELECT * FROM operations WHERE name = ? AND status != 'cancelled' ORDER BY created_at ASC")
      .all(name) as any[];
    return rows.map(this.rowToOperation);
  }

  listOperations(status?: OperationStatus): Operation[] {
    const rows = status
      ? (this.db.prepare("SELECT * FROM operations WHERE status = ? ORDER BY created_at DESC").all(status) as any[])
      : (this.db.prepare("SELECT * FROM operations ORDER BY created_at DESC").all() as any[]);
    return rows.map(this.rowToOperation);
  }

  private rowToOperation(row: any): Operation {
    return {
      id: row.id,
      accountNumber: row.account_number,
      name: row.name,
      requiredAmount: row.required_amount,
      receivedAmount: row.received_amount,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateOperation(id: number, updates: Partial<Pick<Operation, "name" | "accountNumber" | "requiredAmount">>): Operation {
    const op = this.getOperation(id);
    if (!op) throw new Error(`Operation ${id} not found`);
    const name = updates.name ?? op.name;
    const accountNumber = updates.accountNumber ?? op.accountNumber;
    const requiredAmount = updates.requiredAmount ?? op.requiredAmount;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE operations SET name = ?, account_number = ?, required_amount = ?, updated_at = ? WHERE id = ?`
      )
      .run(name, accountNumber, requiredAmount, now, id);
    this.audit("update", "operation", id, { previous: op, next: { name, accountNumber, requiredAmount } });
    return this.getOperation(id)!;
  }

  setOperationStatus(id: number, status: OperationStatus): Operation {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE operations SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    this.audit("status", "operation", id, { status });
    return this.getOperation(id)!;
  }

  addReceivedAmount(id: number, amount: number): Operation {
    const op = this.getOperation(id)!;
    const received = op.receivedAmount + amount;
    const status: OperationStatus = received >= op.requiredAmount ? "completed" : "open";
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE operations SET received_amount = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(received, status, now, id);
    this.audit("receive", "operation", id, { amount, received, status });
    return this.getOperation(id)!;
  }

  saveNotification(n: Omit<Notification, "id" | "receivedAt">): Notification {
    const now = new Date().toISOString();
    const info = this.db
      .prepare(
        `INSERT INTO notifications (operation_id, operation_number, date, time, account_number, name, amount, image_path, extracted_text, fingerprint, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        n.operationId,
        n.operationNumber,
        n.date,
        n.time,
        n.accountNumber,
        n.name,
        n.amount,
        n.imagePath,
        n.extractedText,
        n.fingerprint,
        n.status,
        now
      );
    return this.getNotification(info.lastInsertRowid as number)!;
  }

  getNotification(id: number): Notification | null {
    const row = this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      operationId: row.operation_id,
      operationNumber: row.operation_number,
      date: row.date,
      time: row.time,
      accountNumber: row.account_number,
      name: row.name,
      amount: row.amount,
      imagePath: row.image_path,
      extractedText: row.extracted_text,
      fingerprint: row.fingerprint,
      status: row.status,
      receivedAt: row.received_at,
    };
  }

  findNotificationByFingerprint(fingerprint: string): Notification | null {
    const row = this.db.prepare("SELECT * FROM notifications WHERE fingerprint = ? LIMIT 1").get(fingerprint) as any;
    return row ? this.getNotification(row.id) : null;
  }

  findNotificationsByOperation(operationId: number): Notification[] {
    const rows = this.db
      .prepare("SELECT * FROM notifications WHERE operation_id = ? ORDER BY received_at ASC")
      .all(operationId) as any[];
    return rows.map((r) => this.getNotification(r.id)!);
  }

  listNotifications(): Notification[] {
    const rows = this.db.prepare("SELECT * FROM notifications ORDER BY received_at DESC").all() as any[];
    return rows.map((r) => this.getNotification(r.id)!);
  }

  listAudit(): AuditEntry[] {
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details,
      createdAt: r.created_at,
    }));
  }
}
