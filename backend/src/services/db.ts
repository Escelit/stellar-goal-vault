import Database from "better-sqlite3";
import path from "path";

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "campaigns.db");

type SQLiteDatabase = ReturnType<typeof Database>;

let db: SQLiteDatabase | null = null;

export type DbHealthStatus = "up" | "down";

export function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }

  return db;
}

export function initDb(): void {
  if (db) {
    return;
  }

  const fs = require("fs") as typeof import("fs");
  const dir = path.dirname(DB_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db);
}

export function checkDbHealth(): {
  status: DbHealthStatus;
  reachable: boolean;
} {
  try {
    const database = getDb();
    database.prepare("SELECT 1 AS ok").get();

    return {
      status: "up",
      reachable: true,
    };
  } catch {
    return {
      status: "down",
      reachable: false,
    };
  }
}

function migrate(database: SQLiteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id              TEXT PRIMARY KEY,
      creator         TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      asset_code      TEXT NOT NULL,
      target_amount   REAL NOT NULL,
      pledged_amount  REAL NOT NULL DEFAULT 0,
      deadline        INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      claimed_at      INTEGER,
      metadata_json   TEXT
    );

    CREATE TABLE IF NOT EXISTS pledges (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id       TEXT NOT NULL,
      contributor       TEXT NOT NULL,
      amount            REAL NOT NULL,
      created_at        INTEGER NOT NULL,
      refunded_at       INTEGER,
      transaction_hash  TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS campaign_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id         TEXT NOT NULL,
      event_type          TEXT NOT NULL,
      timestamp           INTEGER NOT NULL,
      actor               TEXT,
      amount              REAL,
      metadata            TEXT,
      blockchain_metadata TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_id ON pledges(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_id ON campaign_events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_timestamp ON campaign_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_tx_hash ON campaign_events(json_extract(blockchain_metadata, '$.txHash'));
    CREATE INDEX IF NOT EXISTS idx_campaign_events_ledger ON campaign_events(json_extract(blockchain_metadata, '$.ledgerNumber'));
  `);

  const pledgeColumns = database
    .prepare(`PRAGMA table_info(pledges)`)
    .all() as Array<{ name: string }>;

  const hasTransactionHash = pledgeColumns.some((column) => column.name === "transaction_hash");
  if (!hasTransactionHash) {
    database.exec(`ALTER TABLE pledges ADD COLUMN transaction_hash TEXT`);
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pledges_transaction_hash
    ON pledges(transaction_hash)
    WHERE transaction_hash IS NOT NULL
  `);

  try {
    database.exec(`ALTER TABLE campaign_events ADD COLUMN blockchain_metadata TEXT;`);
  } catch {
    // Column already exists, ignore error.
  }
}
