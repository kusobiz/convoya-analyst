# SPEC: Nirvana CR Stock Analysis Web App
**Project:** analyst.convoya.ai  
**Client:** Nirvana Asia Group — Central Region  
**Stack:** Node.js ESM · Express · Chart.js · pptxgenjs · SQLite (sessions) · xlsx  
**Host:** Hetzner CX22 VPS · PM2 · Nginx  
**AI:** Anthropic Claude API (claude-haiku for query, claude-sonnet for report generation)  
**Date:** May 2026

---

## 1. Overview

A password-protected web application hosted at `analyst.convoya.ai` that allows Central Region managers to:

1. View an interactive stock analysis dashboard (charts + tables, mobile/tablet/PC responsive)
2. Ask freeform questions about stock data via an AI query window
3. Generate on-demand or standard monthly reports (PDF/PPT export)

The data source is a single fixed-name Excel file (`stock_data.xlsx`) in the `/data` folder. This file is replaced monthly. All analysis is derived from the `Master_Stock_Balance` worksheet.

---

## 2. Project Structure

```
/analyst
├── server.js                  ← Express entry point
├── package.json
├── .env                       ← API keys, session secret (gitignored)
├── CLAUDE.md                  ← Claude Code context (see Section 10)
├── data/
│   └── stock_data.xlsx        ← Fixed filename, replaced monthly
├── src/
│   ├── reader.js              ← Excel reader + data transformer
│   ├── auth.js                ← Session-based login
│   └── pptExport.js          ← PPT generation with pptxgenjs
├── routes/
│   ├── query.js               ← POST /api/query → Claude API
│   └── report.js              ← POST /api/report → PPT file download
└── public/
    ├── index.html             ← Main dashboard (served after login)
    ├── login.html             ← Login page
    ├── css/
    │   └── style.css          ← Responsive styles
    └── js/
        ├── dashboard.js       ← Chart.js charts + table rendering
        └── query.js           ← AI query window (calls /api/query)
```

---

## 3. Data Layer — reader.js

### Source
- File: `./data/stock_data.xlsx`
- Master sheet: `Master_Stock_Balance`
- All analysis derived from this sheet only

### Key columns (confirmed from data)
| Column | Description |
|---|---|
| `Branch` | KL, SA, GX, SE, IJ, IP, KR, KN |
| `Material Type Desc.` | Product type (NV Niche, NV Burial Plot, etc.) |
| `Division Code` | Tied to material type |
| `Status` | CONFIRMED, EXERCISED, OPEN, HOLD, RESERVED, BOOKED |
| `Sales Status` | Sales pipeline status |
| `Price Range` | Pricing tier |
| `Lot Type` | Type of lot |
| `Total Stock Case` | Total inventory units |
| `Total Sold Case` | Units sold |
| `Total Balance Case` | Remaining units (stock − sold) |
| `Total Balance Amount` | MYR value of balance |
| `Unit Price` | Per-unit price |
| `BD Focus Zone` | "yes" if flagged as BD priority zone |
| `Lot Create On` | Date lot was created (for age analysis) |
| `Dragon Zone` | Premium zone flag |

### OPEN = unsold
Status = `OPEN` represents unsold available inventory.

### reader.js must export
```javascript
export function loadStockData()        // returns parsed master data
export function getBranchSummary()     // branch-level aggregates
export function getProductSummary()    // product-level aggregates  
export function getBDFocusSummary()    // BD focus zone aggregates
export function getStatusBreakdown()   // all statuses counts
export function getPriceRangeSummary() // price tier performance
export function getLotTypeSummary()    // lot type breakdown
export function getOverview()          // top-level KPIs
export function getAgedStock()         // unsold stock by age (Lot Create On)
export function getBranchProductMatrix() // cross-tab: branch × product sell-through
```

### Caching
- Cache parsed data in memory on first load
- Expose `refreshCache()` to reload when file is replaced
- Add `GET /api/refresh` endpoint (admin only) to trigger cache refresh

---

## 4. Authentication — auth.js

### Requirements
- Simple session-based login (no individual user accounts initially)
- Single shared password for all managers (configurable via `.env`)
- Session persists for 8 hours (idle timeout)
- All routes except `/login` and `/api/login` require active session
- No account creation — credentials set in `.env` only

### .env variables
```
SESSION_SECRET=<random string>
MANAGER_PASSWORD=<shared password>
CLAUDE_API_KEY=<anthropic key>
PORT=3000
```

### Routes
- `GET /login` → serve `login.html`
- `POST /api/login` → validate password, set session, redirect to `/`
- `POST /api/logout` → destroy session, redirect to `/login`
- Middleware: check session on all other routes

### Login page design
- Clean, minimal, centred card
- Nirvana Asia Group branding (navy + gold colour scheme)
- Password field + Login button
- Error message if wrong password

---

## 5. Dashboard — public/index.html + dashboard.js

### Layout
- Responsive: single column (mobile), two column (tablet), full (desktop)
- Sticky top navigation bar with: logo, "YTD [Month Year]" badge, Logout button
- Five tabs: Overview · Branch · Product · BD Focus · AI Query

### Tab 1 — Overview
**KPI cards (top row):**
- Total Stock
- Total Sold  
- Balance Units
- Sell-through %
- Balance Value (MYR)

**Charts:**
1. Branch sell-through bar chart — colour coded green (≥80%) / blue (50–79%) / red (<50%)
2. Balance by product — donut chart (top 6 products)
3. Stock status stacked bar — Confirmed / Exercised / Open / Hold / Reserved+Booked

### Tab 2 — Branch
**Table columns:** Branch · Stock · Sold · Balance · Balance Value · Sell-through (mini bar) · Status badge  
**Chart:** Stacked bar — Sold vs Balance per branch

### Tab 3 — Product
**Table columns:** Product · Stock · Sold · Balance · Sell-through (mini bar) · Velocity badge  
**Chart:** Horizontal bar — sell-through % sorted best to worst  
**Velocity badges:** Fast (≥80%) · Normal (60–79%) · Slow (<60%)

### Tab 4 — BD Focus
**Table columns:** Branch · Balance Units · Balance Value · Avg Value/Unit · Priority badge  
**Priority badges:** Critical (≥10,000) · High (≥5,000) · Medium (≥2,000) · Low (<2,000)  
**Summary note:** Total BD Focus units and value with management interpretation

### Tab 5 — AI Query
**Layout:**
- 6 quick-prompt chips (pre-filled questions)
- Chat window (scrollable message history)
- Text input + Send button (Enter key also sends)
- "Analysing..." loading state while waiting for response
- Error display if API fails (show actual error message)

**Quick prompts:**
- Lowest balance stock by branch
- Slowest moving product
- Management summary of stock health
- Marketing strategy for KN and KR
- Most urgent BD Focus zone
- Compare top 3 vs bottom 3 branches

### Colour palette
- Primary: `#1A2C5B` (navy)
- Accent: `#C9A84C` (gold)
- Success: `#1D9E75` (green)
- Warning: `#EF9F27` (amber)
- Danger: `#E24B4A` (red)
- Info: `#378ADD` (blue)
- Background: `#F5F6F8`
- Text: `#1A1A2E`

---

## 6. AI Query — routes/query.js

### Route
`POST /api/query`  
Body: `{ question: string, history: [{role, content}] }`  
Response: `{ answer: string }`

### Model
- Use `claude-haiku-4-5-20251001` for query (fast, cost-efficient)
- Use `claude-sonnet-4-6` for report generation (higher quality)

### System prompt
Inject the following data context into every query:
- Overview KPIs (total stock, sold, balance, sell-through %, balance value)
- Branch summary table (all 8 branches: stock, sold, balance, value, sell-through %)
- Product summary table (all 9 products: stock, sold, balance, sell-through %)
- BD Focus zone summary (all 8 branches: balance, value, priority)
- Status breakdown
- Price range performance
- Current month/year from filename or system date

Data is loaded fresh from `reader.js` cache on each request.

### Behaviour
- Concise, data-driven, action-oriented responses
- Use bullet points for recommendations
- Format all numbers with commas and MYR prefix
- Keep responses under 400 words unless explicitly asked for a full report
- Support multi-turn conversation (history passed from frontend)

---

## 7. PPT Export — src/pptExport.js + routes/report.js

### Route
`POST /api/report`  
Body: `{ reportType: 'standard' | 'branch' | 'bd_focus' | 'product', branchFilter?: string }`  
Response: PPT file download (`Content-Disposition: attachment`)

### Library
`pptxgenjs` — install via `npm install pptxgenjs`

### Slide deck structure (Standard Monthly Report)

**Slide 1 — Cover**
- Title: "Central Region Stock Analysis"
- Subtitle: "YTD [Month Year]"
- Navy background, gold accent line
- "Nirvana Asia Group" logo text bottom right

**Slide 2 — Executive Snapshot**
- 5 KPI boxes (Total Stock, Sold, Balance, Sell-through %, Balance Value)
- One-line management commentary (Claude-generated)

**Slide 3 — Branch Performance**
- Table: all 8 branches with sell-through % and colour coding
- Bar chart: sell-through % by branch

**Slide 4 — Product Analysis**
- Table: all 9 products sorted by sell-through %
- Horizontal bar chart

**Slide 5 — BD Focus Zones**
- Table: priority zones with balance and value
- Management action bullets (Claude-generated)

**Slide 6 — Cross Analysis: Branch × Product**
- Sell-through % heatmap matrix

**Slide 7 — Aged Stock Alert**
- Products/branches with highest proportion of old unsold stock
- Flagged for sales team action

**Slide 8 — Recommendations & Marketing Strategies**
- Per-branch action items (Claude-generated via Sonnet)
- Colour coded: Urgent / This Month / Pipeline

**Slide 9 — Appendix: Price Range Distribution**
- Which price tiers move fastest across branches

### Slide design rules
- All slides: 10" × 7.5" widescreen
- Font: Calibri or Arial
- Navy header bar on each slide with slide title in white
- Gold accent horizontal rule below header
- Slide number bottom right
- "Confidential · Internal Use Only" footer

### On-demand report types
- `branch` — single branch deep dive (filter by branch name)
- `bd_focus` — BD Focus zones only
- `product` — product category analysis only

---

## 8. Nginx Configuration

```nginx
server {
    listen 80;
    server_name analyst.convoya.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name analyst.convoya.ai;

    ssl_certificate     /etc/letsencrypt/live/analyst.convoya.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analyst.convoya.ai/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**SSL:** Use Certbot (Let's Encrypt) — `certbot --nginx -d analyst.convoya.ai`

---

## 9. PM2 Configuration — ecosystem.config.cjs

```javascript
module.exports = {
  apps: [{
    name: 'analyst',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
```

**Commands:**
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs analyst
```

---

## 10. CLAUDE.md (paste into project root)

```markdown
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
```

---

## 11. Package.json dependencies

```json
{
  "type": "module",
  "dependencies": {
    "express": "^4.18.0",
    "express-session": "^1.17.0",
    "connect-sqlite3": "^0.9.0",
    "xlsx": "^0.18.5",
    "pptxgenjs": "^3.12.0",
    "dotenv": "^16.0.0",
    "node-fetch": "^3.3.0"
  }
}
```

---

## 12. Build sequence for Claude Code

Instruct Claude Code to build in this exact order:

1. `package.json` + install dependencies
2. `.env` template (with placeholder values)
3. `CLAUDE.md`
4. `src/reader.js` — Excel parser + all aggregate functions
5. `src/auth.js` — session middleware + login logic
6. `routes/query.js` — Claude API query route
7. `src/pptExport.js` — PPT generation
8. `routes/report.js` — report download route
9. `server.js` — Express app wiring all routes
10. `public/login.html` — login page
11. `public/index.html` — dashboard shell + tab structure
12. `public/css/style.css` — responsive styles
13. `public/js/dashboard.js` — Chart.js charts + tables
14. `public/js/query.js` — AI query window
15. `ecosystem.config.cjs` — PM2 config
16. Nginx config block for `analyst.convoya.ai`
17. Certbot SSL setup instructions

---

## 13. Future enhancements (out of scope for v1)

- Individual manager logins with audit log (who queried what)
- WhatsApp query interface via Kaki (forward queries to /api/query)
- Month-over-month trend analysis (archive previous months)
- Email delivery of standard monthly report (nodemailer)
- Role-based access (sales team vs director view)
- Auto-refresh when new Excel file is detected (chokidar file watcher)
```
