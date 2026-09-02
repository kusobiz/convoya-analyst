import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sessionMiddleware, requireAuth, loginHandler, logoutHandler } from './src/auth.js';
import adminRouter from './routes/admin.js';
import {
  refreshCache,
  getOverview,
  getBranchSummary,
  getProductSummary,
  getBDFocusSummary,
  getStatusBreakdown,
  getPriceRangeSummary,
  getLotTypeSummary,
  getAgedStock,
  getBranchProductMatrix,
} from './src/reader.js';
import queryRouter from './routes/query.js';
import reportRouter from './routes/report.js';
import lotsRouter from './routes/lots.js';
import pricingRouter from './routes/pricing.js';
import velocityRouter from './routes/velocity.js';
import lifecycleRouter, { clearMigrationDateCache } from './routes/lifecycle.js';
import attributesRouter from './routes/attributes.js';
import overviewRouter from './routes/overview.js';
import snapshotsRouter from './routes/snapshots.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware());

// index.html is the authenticated app shell, not a public static asset — it must only ever be
// served through the '/' route below, after requireAuth. `index: false` stops express.static
// from auto-serving it for '/', and this redirect stops a direct '/index.html' request from
// doing the same (both would otherwise bypass auth, since express.static runs before requireAuth
// — the rest of public/ genuinely needs to be auth-free, since the login page needs its CSS/JS).
app.get('/index.html', (req, res) => res.redirect('/'));
app.use(express.static(join(__dirname, 'public'), { index: false }));

// Public auth routes
app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(join(__dirname, 'public/login.html'));
});
app.post('/api/login', loginHandler);
app.post('/api/logout', logoutHandler);

// Everything below requires a valid session
app.use(requireAuth);

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public/index.html'));
});

// Lets the frontend know who's logged in and whether to show the Admin-only User Management
// tab — role lives in the session (set at login), not re-queried from the DB per request.
app.get('/api/me', (req, res) => {
  res.json({
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
  });
});

// Batch dashboard data
app.get('/api/data', (req, res) => {
  try {
    const filters = { bigLotFilter: req.query.bigLotFilter };
    res.json({
      overview:    getOverview(filters),
      branches:    getBranchSummary(filters),
      products:    getProductSummary(filters),
      bdFocus:     getBDFocusSummary(filters),
      statuses:    getStatusBreakdown(filters),
      priceRanges: getPriceRangeSummary(filters),
      lotTypes:    getLotTypeSummary(filters),
      agedStock:   getAgedStock(filters).slice(0, 20),
      matrix:      getBranchProductMatrix(filters),
    });
  } catch (err) {
    console.error('Data load error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cache refresh
app.get('/api/refresh', (req, res) => {
  try {
    const data = refreshCache();
    clearMigrationDateCache();
    res.json({ success: true, rows: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/query', queryRouter);
app.use('/api/report', reportRouter);
app.use('/api/lots', lotsRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/velocity', velocityRouter);
app.use('/api/lifecycle', lifecycleRouter);
app.use('/api/attributes', attributesRouter);
app.use('/api/overview', overviewRouter);
app.use('/api/snapshots', snapshotsRouter);
app.use('/api/admin', adminRouter);

app.listen(PORT, () => {
  console.log(`analyst running on http://localhost:${PORT}`);
});
