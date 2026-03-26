const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'yolo-pipeline.db');
let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      classes TEXT NOT NULL,           -- JSON array of class names
      status TEXT DEFAULT 'pending',   -- pending/generating_prompts/generating_images/labeling/training/testing/completed/failed
      progress INTEGER DEFAULT 0,
      image_count INTEGER DEFAULT 50,
      epochs INTEGER DEFAULT 50,
      test_split REAL DEFAULT 0.2,
      model_path TEXT,
      metrics TEXT,                    -- JSON: {precision, recall, mAP50, mAP50_95}
      error TEXT,
      log TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_images (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      prompt TEXT,
      image_path TEXT,
      label_path TEXT,
      split TEXT DEFAULT 'train',     -- train/val
      status TEXT DEFAULT 'pending',  -- pending/generated/labeled/failed
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  return db;
}

module.exports = { getDB, initDB };
