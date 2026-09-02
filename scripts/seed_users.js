// One-time seed of the first two accounts (Admin + Manager) for the multi-user login system.
// Idempotent: skips entirely if the users table already has rows, so re-running this (e.g. as
// part of a deploy script) never resets existing accounts or passwords.
//
// Temporary passwords are randomly generated and printed to the console exactly once here —
// they are never logged again afterward (not even on subsequent seed runs, since those are
// no-ops). Whoever runs this script is responsible for recording them and relaying them to
// 'jacky' and 'kwkhoo' through a secure channel, then having them change on first login is
// left to a future "change password" feature — out of scope for this seed step.
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/stock.db');

// Readable temp password: 3 random words-ish blocks + a digit pair, not full base64 noise —
// easy to read aloud/type once when relaying it, still ~10^14 combinations of guess space.
function generateTempPassword() {
  const raw = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '');
  const digits = crypto.randomInt(10, 99);
  return `${raw}${digits}`;
}

const db = new Database(DB_PATH);
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

const existingCount = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
if (existingCount > 0) {
  console.log(`users table already has ${existingCount} row(s) — skipping seed.`);
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)
`);

const seedAccounts = [
  { username: 'jacky', displayName: 'Jacky', role: 'Admin' },
  { username: 'kwkhoo', displayName: 'KW Khoo', role: 'Manager' },
];

console.log('Seeding initial accounts — record these temporary passwords now, they will not be shown again:\n');
for (const acct of seedAccounts) {
  const tempPassword = generateTempPassword();
  const hash = bcrypt.hashSync(tempPassword, 10);
  insert.run(acct.username, hash, acct.displayName, acct.role);
  console.log(`  username: ${acct.username.padEnd(10)} role: ${acct.role.padEnd(8)} temporary password: ${tempPassword}`);
}
console.log('\nDone. These accounts can now sign in at /login with username + password.');
