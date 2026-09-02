import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getAuthDb, requireAdmin } from '../src/auth.js';

const router = Router();

// Every route here is Admin-only — requireAuth is already applied ahead of this router's
// mount point in server.js, so an unauthenticated request gets requireAuth's redirect/401
// rather than this router's 403.
router.use(requireAdmin);

const VALID_ROLES = ['Admin', 'Manager'];

// Never selects password_hash — this is the one place user rows are returned to the client.
const USER_COLUMNS = 'id, username, display_name, role, is_active, created_at, last_login_at';

router.get('/users', (req, res) => {
  try {
    const users = getAuthDb().prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY username`).all();
    res.json({ users });
  } catch (err) {
    console.error('Admin users list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const displayName = req.body?.displayName ? String(req.body.displayName).trim() : null;
    const role = req.body?.role;

    if (!username) return res.status(400).json({ error: 'Username is required.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}.` });

    const db = getAuthDb();
    const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
    if (existing) return res.status(409).json({ error: 'That username is already taken.' });

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)`
    ).run(username, hash, displayName, role);

    const user = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ user });
  } catch (err) {
    console.error('Admin user create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });

    const db = getAuthDb();
    const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const updates = [];
    const params = [];
    if (req.body?.isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(req.body.isActive ? 1 : 0);
    }
    if (req.body?.role !== undefined) {
      if (!VALID_ROLES.includes(req.body.role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
      updates.push('role = ?');
      params.push(req.body.role);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update — pass isActive and/or role.' });

    params.push(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
    res.json({ user: updated });
  } catch (err) {
    console.error('Admin user update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/login-activity', (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = [10, 25].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 10;
    const offset = (page - 1) * pageSize;

    const db = getAuthDb();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM login_audit`).get().n;
    const rows = db.prepare(
      `SELECT id, username, success, ip_address, attempted_at FROM login_audit
       ORDER BY attempted_at DESC, id DESC LIMIT ? OFFSET ?`
    ).all(pageSize, offset);

    res.json({ rows, total, page, pageSize });
  } catch (err) {
    console.error('Admin login-activity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
