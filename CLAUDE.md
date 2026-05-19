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
- 8 branches: KL, SA, GX, SE, IJ, IP, KR, KN (all Central Region)
- 9 products: NV Niche, NV Burial Plot, NV Pedestal, NV Seed, NV Pet Niche,
  NV EBL, NV Urn Burial Plot, NV Baby Paradise, NV Pet Burial Plot

## Auth
- Session-based, shared password via .env MANAGER_PASSWORD
- All routes require session except /login and /api/login

## Claude API
- Query route: claude-haiku-4-5-20251001 (fast responses)
- Report route: claude-sonnet-4-6 (quality content generation)
- Key from .env CLAUDE_API_KEY

## Ports & process
- App runs on PORT=3000
- PM2 process name: analyst
- Nginx reverse proxy → analyst.convoya.ai (SSL via Certbot)

## Do not
- Do not hardcode API keys
- Do not use CommonJS require() — this is ESM (import/export only)
- Do not store sessions in memory for production — use connect-sqlite3
- Do not expose /api/refresh without session check
