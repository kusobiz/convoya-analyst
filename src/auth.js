import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQLiteStore = connectSqlite3(session);
const DB_PATH = join(__dirname, '../data/stock.db');

export function sessionMiddleware() {
  return session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: join(__dirname, '../'),
    }),
    secret: process.env.SESSION_SECRET || 'changeme',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      httpOnly: true,
      sameSite: 'lax',
    },
  });
}

// This module owns users + login_audit, same "not readonly, CREATE TABLE IF NOT EXISTS on
// first open" pattern as routes/attributes.js owning zone_attributes — a small persistent
// table living alongside master_stock in the same file, unaffected by the monthly data
// refresh (scripts/excel_to_sqlite.py only replaces master_stock). Exported so
// routes/admin.js and scripts/seed_users.js can share the same connection/schema.
let db = null;
export function getAuthDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'Manager',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        last_login_at TEXT
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        success INTEGER NOT NULL,
        ip_address TEXT,
        attempted_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_login_audit_attempted ON login_audit(attempted_at)`);
  }
  return db;
}

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

// Admin-only routes sit behind requireAuth already (mounted below it in server.js) — this
// only adds the role check, so an unauthenticated request still gets requireAuth's redirect
// rather than a 403 that leaks the route's existence.
export function requireAdmin(req, res, next) {
  if (req.session?.role === 'Admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

function recordLoginAttempt(username, success, ipAddress) {
  getAuthDb().prepare(
    `INSERT INTO login_audit (username, success, ip_address) VALUES (?, ?, ?)`
  ).run(username, success ? 1 : 0, ipAddress || null);
}

// A real (but unusable — nobody knows this plaintext) bcrypt hash to compare against when the
// username doesn't exist, so bcrypt.compareSync still does real work either way and an unknown
// username can't be timed-out from a real one.
const DUMMY_HASH = bcrypt.hashSync('no-such-user-placeholder', 10);

export function loginHandler(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const ip = req.ip;

  if (!username || !password) return res.redirect('/login?error=1');

  const user = getAuthDb().prepare(`SELECT * FROM users WHERE username = ?`).get(username);

  // Same generic failure path whether the username doesn't exist, the account is inactive,
  // or the password is wrong — never reveal which of those it was. bcrypt.compareSync still
  // runs against a dummy hash on unknown-username so the response time doesn't leak that
  // distinction either.
  const passwordOk = bcrypt.compareSync(password, user?.password_hash || DUMMY_HASH);

  if (!user || !user.is_active || !passwordOk) {
    recordLoginAttempt(username, false, ip);
    return res.redirect('/login?error=1');
  }

  getAuthDb().prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  recordLoginAttempt(username, true, ip);

  req.session.authenticated = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.display_name;
  req.session.role = user.role;
  req.session.loginTime = Date.now();
  res.redirect('/');
}

export function logoutHandler(req, res) {
  req.session.destroy(() => {
    res.redirect('/login');
  });
}
