# analyst — Nirvana CR Stock Analysis App

## Stack
Node.js ESM (type: module in package.json) · Express · xlsx · pptxgenjs · Chart.js (CDN in HTML)

## Data
- Source: ./data/stock_data.xlsx (fixed filename, replaced monthly)
- Master sheet: Master_Stock_Balance
- All aggregations in src/reader.js — cache in memory, refresh via /api/refresh

## Key domain rules
- Status = OPEN means unsold/available inventory
- BD Focus Zone = "yes" means priority sales zone
- Branches vary by data load (currently 9, incl. KL, SA, GX, SE, IJ, IP, KR, KN, N3) — always query distinct Branch from master_stock, never hardcode the list
- 9 products: NV Niche, NV Burial Plot, NV Pedestal, NV Seed, NV Pet Niche,
  NV EBL, NV Urn Burial Plot, NV Baby Paradise, NV Pet Burial Plot

## Auth
- Session-based, multi-user — accounts live in the `users` table (data/stock.db), managed via
  src/auth.js. Roles: 'Admin' | 'Manager'. Admin-only routes (routes/admin.js) use
  requireAdmin(); all other routes use requireAuth(). Login attempts are recorded in
  `login_audit`, viewable in the Admin-only User Management tab.
- First accounts are created via `node scripts/seed_users.js` (idempotent — no-ops once the
  users table has any rows). New accounts after that are created from the User Management tab.
- .env MANAGER_PASSWORD is legacy and no longer read by the login flow — do not reintroduce it.
- All routes require session except /login and /api/login

## Claude API
- Query route: claude-haiku-4-5-20251001 (fast responses)
- Report route: claude-sonnet-4-6 (quality content generation)
- Key from .env CLAUDE_API_KEY

## Ports & process
- App runs on PORT=3001 (set in .env)
- PM2 process name: analyst
- Nginx reverse proxy → analyst.convoya.ai (SSL via Certbot)

## Do not
- Do not hardcode API keys
- Do not use CommonJS require() — this is ESM (import/export only)
- Do not store sessions in memory for production — use connect-sqlite3
- Do not expose /api/refresh without session check
