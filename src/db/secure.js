/**
 * Защищенный модуль базы данных с предотвращением SQL-инъекций
 * Использует parameterized queries (подготовленные выражения)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'bot.db');

let db = null;

/**
 * Инициализация базы данных
 */
function initDatabase() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log('✅ База данных SQLite инициализирована (защищенная)');
  
  return db;
}

/**
 * Получение экземпляра базы данных
 */
function getDb() {
  if (!db) {
    initDatabase();
  }
  return db;
}

/**
 * Выполнение SELECT запроса с параметрами
 */
function select(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params);
}

/**
 * Выполнение SELECT запроса с возвратом одной строки
 */
function selectOne(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params);
}

/**
 * Выполнение INSERT запроса
 */
function insert(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

/**
 * Выполнение UPDATE запроса
 */
function update(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

/**
 * Выполнение DELETE запроса
 */
function remove(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

/**
 * Создание таблиц
 */
function createTables() {
  const db = getDb();
  
  // Создаем таблицы
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      balance REAL DEFAULT 0,
      currency TEXT DEFAULT 'RUB',
      is_premium INTEGER DEFAULT 0,
      premium_expires_at TEXT,
      weekly_products_scans INTEGER DEFAULT 0,
      weekly_receipts_scans INTEGER DEFAULT 0,
      last_scan_week TEXT,
      language TEXT DEFAULT 'ru',
      notifications INTEGER DEFAULT 1,
      reminder_days INTEGER DEFAULT 2,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  try {
    db.exec(`ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'RUB'`);
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('Колонка currency уже существует или ошибка:', e.message);
    }
  }

  try {
    db.exec(`ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'ru'`);
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('Колонка language уже существует или ошибка:', e.message);
    }
  }

  try {
    db.exec(`ALTER TABLE users ADD COLUMN notifications INTEGER DEFAULT 1`);
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('Колонка notifications уже существует или ошибка:', e.message);
    }
  }

  try {
    db.exec(`ALTER TABLE users ADD COLUMN reminder_days INTEGER DEFAULT 2`);
  } catch (e) {
    if (!e.message.includes('duplicate column name')) {
      console.log('Колонка reminder_days уже существует или ошибка:', e.message);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      quantity TEXT,
      expiry_date TEXT,
      raw_response TEXT,
      image_file_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount REAL,
      period TEXT,
      payment_due_date TEXT,
      address TEXT,
      service_type TEXT,
      meter_readings TEXT,
      raw_response TEXT,
      image_file_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      room TEXT,
      status TEXT DEFAULT 'offline',
      mqtt_topic TEXT,
      custom_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS device_logs (
      id INTEGER PRIMARY KEY,
      device_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      status TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'RUB',
      status TEXT DEFAULT 'pending',
      payment_url TEXT,
      crypto_invoice_id TEXT,
      stars_amount INTEGER,
      stars_payment_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(telegram_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Создаем индексы
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_receipts_due ON receipts(payment_due_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_device_logs_device ON device_logs(device_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)`);
  
  console.log('✅ Таблицы созданы');
}

// Инициализация
initDatabase();
createTables();

module.exports = {
  initDatabase,
  getDb,
  select,
  selectOne,
  insert,
  update,
  remove,
  createTables
};