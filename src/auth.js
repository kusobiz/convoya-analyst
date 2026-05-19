import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQLiteStore = connectSqlite3(session);

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

export function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

export function loginHandler(req, res) {
  const { password } = req.body;
  if (password === process.env.MANAGER_PASSWORD) {
    req.session.authenticated = true;
    req.session.loginTime = Date.now();
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
}

export function logoutHandler(req, res) {
  req.session.destroy(() => {
    res.redirect('/login');
  });
}
