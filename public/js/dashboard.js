/* dashboard.js — Chart.js charts + table rendering */

const C = {
  navy:  '#1A2C5B',
  gold:  '#C9A84C',
  green: '#1D9E75',
  amber: '#EF9F27',
  red:   '#E24B4A',
  blue:  '#378ADD',
  muted: '#6B7280',
};

const CHART_DEFAULTS = {
  font: { family: "'Segoe UI', Arial, sans-serif", size: 12 },
  plugins: {
    legend: { labels: { font: { family: "'Segoe UI', Arial, sans-serif", size: 11 } } },
  },
};

Chart.defaults.font.family = "'Segoe UI', Arial, sans-serif";

function sellColor(pct) {
  if (pct >= 80) return C.green;
  if (pct >= 50) return C.blue;
  return C.red;
}

function badgeClass(pct) {
  if (pct >= 80) return 'badge--green';
  if (pct >= 50) return 'badge--blue';
  return 'badge--red';
}

function priorityBadgeClass(p) {
  return { Critical: 'badge--red', High: 'badge--amber', Medium: 'badge--blue', Low: 'badge--green' }[p] || 'badge--navy';
}

function velocityBadge(pct) {
  if (pct >= 80) return { label: 'Fast',   cls: 'badge--green' };
  if (pct >= 60) return { label: 'Normal', cls: 'badge--blue' };
  return            { label: 'Slow',   cls: 'badge--red' };
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function myr(n) {
  return 'MYR ' + fmt(n);
}

function pct(n) {
  return Number(n).toFixed(1) + '%';
}

function miniBar(val, color) {
  return `
    <div class="mini-bar-wrap">
      <div class="mini-bar-track">
        <div class="mini-bar-fill" style="width:${Math.min(val,100).toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="mini-bar-label" style="color:${color}">${pct(val)}</span>
    </div>`;
}

// ── Global "Big Lot" filter (Unit Price >= 500,000 MYR) — one control in the header,
// applied to every tab's API requests via the choke points below (buildArrayQuery,
// fetchLotsDetail, fetchPricingJSON, the /api/data fetch, and velocity.js's fetchVeloJSON).
window.bigLotFilter = 'all';

function updateBigLotBadge() {
  const badge = document.getElementById('bigLotBadge');
  if (!badge) return;
  if (window.bigLotFilter === 'exclude') {
    badge.textContent = 'Filtering: Excluding Big Lots (≥500K)';
    badge.hidden = false;
  } else if (window.bigLotFilter === 'only') {
    badge.textContent = 'Filtering: Big Lots Only (≥500K)';
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

// Re-runs every tab that already has data on screen so switching the header control once
// refreshes Overview/Branch/Product/BD Focus immediately, plus Lot Drill-Down, Pricing
// Intelligence and Sales Velocity if the user has already searched/opened them.
function onBigLotFilterChange() {
  const select = document.getElementById('bigLotFilterSelect');
  window.bigLotFilter = select ? select.value : 'all';
  updateBigLotBadge();

  initDashboard();
  renderLotDrillDown();
  if (pricingLoaded) {
    renderPricingIntelligence();
    generatePricingPivot();
  }
  if (typeof refreshVelocityForBigLotFilter === 'function') refreshVelocityForBigLotFilter();
  if (typeof refreshLifecycleForBigLotFilter === 'function') refreshLifecycleForBigLotFilter();
  if (typeof refreshAttributesForBigLotFilter === 'function') refreshAttributesForBigLotFilter();
}
window.onBigLotFilterChange = onBigLotFilterChange;

// ── Chart instances (kept for potential future destroy/re-create) ──
let charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── Overview: Branch Sell-through bar ──
function renderBranchSellthroughChart(branches) {
  destroyChart('branchSellthrough');
  const ctx = document.getElementById('chartBranchSellthrough');
  if (!ctx) return;
  const branchSellthroughTotal = sumFinite(branches.map(b => b.sellThrough));
  charts.branchSellthrough = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: branches.map(b => b.branch),
      datasets: [{
        label: 'Sell-through %',
        data: branches.map(b => parseFloat(b.sellThrough.toFixed(1))),
        backgroundColor: branches.map(b => sellColor(b.sellThrough) + 'CC'),
        borderColor:     branches.map(b => sellColor(b.sellThrough)),
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%${pctOfTotalLabel(ctx.raw, branchSellthroughTotal, 'total across all bars shown')}` },
        },
      },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%' },
          grid: { color: '#E2E6EE' },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

// ── Overview: Product Donut ──
function renderProductDonut(products) {
  destroyChart('productDonut');
  const ctx = document.getElementById('chartProductDonut');
  if (!ctx) return;
  const top6 = [...products].sort((a,b) => b.totalBalance - a.totalBalance).slice(0, 6);
  const palette = [C.navy, C.gold, C.blue, C.green, C.amber, C.red];
  const donutTotal = sumFinite(top6.map(p => p.totalBalance));
  charts.productDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top6.map(p => stripNVPrefix(p.product)),
      datasets: [{
        data: top6.map(p => p.totalBalance),
        backgroundColor: palette,
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 10 }, padding: 10, boxWidth: 12 },
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)} units${pctOfTotalLabel(ctx.raw, donutTotal, 'total')}` },
        },
      },
    },
  });
}

// ── Overview: Status stacked bar ──
function renderStatusBar(statuses) {
  destroyChart('statusBar');
  const ctx = document.getElementById('chartStatusBar');
  if (!ctx) return;
  const colorMap = {
    OPEN:      C.red,
    CONFIRMED: C.green,
    EXERCISED: C.blue,
    HOLD:      C.amber,
    RESERVED:  '#A78BFA',
    BOOKED:    '#6B7280',
  };
  const datasets = statuses.map(s => ({
    label: s.status,
    data: [s.count],
    backgroundColor: (colorMap[s.status] || '#AAAAAA') + 'CC',
    borderColor:     colorMap[s.status] || '#AAAAAA',
    borderWidth: 1,
    borderRadius: 4,
  }));
  const statusBarTotal = sumFinite(statuses.map(s => s.count));
  charts.statusBar = new Chart(ctx, {
    type: 'bar',
    data: { labels: ['All Lots'], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8, boxWidth: 12 } },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)} lots${pctOfTotalLabel(ctx.raw, statusBarTotal, "this bar's total")}` },
        },
      },
      scales: {
        x: { stacked: true, ticks: { callback: v => fmt(v) }, grid: { color: '#E2E6EE' } },
        y: { stacked: true, grid: { display: false } },
      },
    },
  });
}

// ── Branch tab: Stacked bar ──
function renderBranchStackedChart(branches) {
  destroyChart('branchStacked');
  const ctx = document.getElementById('chartBranchStacked');
  if (!ctx) return;
  charts.branchStacked = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: branches.map(b => b.branch),
      datasets: [
        {
          label: 'Sold',
          data: branches.map(b => b.totalSold),
          backgroundColor: C.green + 'CC',
          borderColor: C.green,
          borderWidth: 1.5,
          borderRadius: { topLeft: 0, topRight: 0 },
        },
        {
          label: 'Balance',
          data: branches.map(b => b.totalBalance),
          backgroundColor: C.red + 'BB',
          borderColor: C.red,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const barTotal = sumFinite(ctx.chart.data.datasets.map(ds => ds.data[ctx.dataIndex]));
              return ` ${ctx.dataset.label}: ${fmt(ctx.raw)}${pctOfTotalLabel(ctx.raw, barTotal, "this bar's total")}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: v => fmt(v) }, grid: { color: '#E2E6EE' } },
      },
    },
  });
}

// ── Product tab: Horizontal bar ──
function renderProductHBar(products) {
  destroyChart('productBar');
  const ctx = document.getElementById('chartProductBar');
  if (!ctx) return;
  const sorted = [...products].sort((a, b) => b.sellThrough - a.sellThrough);
  const productBarTotal = sumFinite(sorted.map(p => p.sellThrough));
  charts.productBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(p => stripNVPrefix(p.product)),
      datasets: [{
        label: 'Sell-through %',
        data: sorted.map(p => parseFloat(p.sellThrough.toFixed(1))),
        backgroundColor: sorted.map(p => sellColor(p.sellThrough) + 'CC'),
        borderColor:     sorted.map(p => sellColor(p.sellThrough)),
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%${pctOfTotalLabel(ctx.raw, productBarTotal, 'total across all bars shown')}` },
        },
      },
      scales: {
        x: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#E2E6EE' } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ── Table: Branch ──
function renderBranchTable(branches) {
  const tbody = document.querySelector('#tableBranch tbody');
  if (!tbody) return;
  tbody.innerHTML = branches.map(b => {
    const color = sellColor(b.sellThrough);
    const bc    = badgeClass(b.sellThrough);
    const label = b.sellThrough >= 80 ? 'On Track' : b.sellThrough >= 50 ? 'Monitor' : 'Attention';
    return `<tr>
      <td><strong>${b.branch}</strong></td>
      <td>${fmt(b.totalStock)}</td>
      <td>${fmt(b.totalSold)}</td>
      <td>${fmt(b.totalBalance)}</td>
      <td>${myr(b.totalValue)}</td>
      <td>${miniBar(b.sellThrough, color)}</td>
      <td><span class="badge ${bc}">${label}</span></td>
    </tr>`;
  }).join('');
}

// ── Table: Product ──
function renderProductTable(products) {
  const tbody = document.querySelector('#tableProduct tbody');
  if (!tbody) return;
  tbody.innerHTML = products.map(p => {
    const color = sellColor(p.sellThrough);
    const vel   = velocityBadge(p.sellThrough);
    return `<tr>
      <td>${stripNVPrefix(p.product)}</td>
      <td>${fmt(p.totalStock)}</td>
      <td>${fmt(p.totalSold)}</td>
      <td>${fmt(p.totalBalance)}</td>
      <td>${miniBar(p.sellThrough, color)}</td>
      <td><span class="badge ${vel.cls}">${vel.label}</span></td>
    </tr>`;
  }).join('');
}

// ── Table: BD Focus ──
function renderBDFocusTable(bdFocus) {
  const tbody = document.querySelector('#tableBDFocus tbody');
  if (!tbody) return;
  tbody.innerHTML = bdFocus.map(b => {
    const pc = priorityBadgeClass(b.priority);
    return `<tr>
      <td><strong>${b.branch}</strong></td>
      <td>${fmt(b.totalBalance)}</td>
      <td>${myr(b.totalValue)}</td>
      <td>${myr(b.avgValuePerUnit)}</td>
      <td><span class="badge ${pc}">${b.priority}</span></td>
    </tr>`;
  }).join('');
}

// ── BD Focus summary note ──
function renderBDSummary(bdFocus) {
  const el = document.getElementById('bdSummaryNote');
  if (!el || !bdFocus.length) return;
  const totalUnits = bdFocus.reduce((s, b) => s + b.totalBalance, 0);
  const totalValue = bdFocus.reduce((s, b) => s + b.totalValue, 0);
  const critical   = bdFocus.filter(b => b.priority === 'Critical').map(b => b.branch).join(', ');
  const high       = bdFocus.filter(b => b.priority === 'High').map(b => b.branch).join(', ');
  el.innerHTML = `
    <strong>BD Focus Zone Summary:</strong>
    Total unsold BD Focus inventory — <strong>${fmt(totalUnits)} units</strong> valued at <strong>${myr(totalValue)}</strong>.
    ${critical ? `<br>&#128308; <strong>Critical priority:</strong> ${critical}` : ''}
    ${high     ? `<br>&#9899; <strong>High priority:</strong> ${high}` : ''}
    <br><em>Focus sales team efforts on Critical and High zones immediately.</em>
  `;
}

// ── KPI Cards ──
function renderKPIs(overview) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('kpi-totalStock',    fmt(overview.totalStock));
  set('kpi-totalSold',     fmt(overview.totalSold));
  set('kpi-balance',       fmt(overview.totalBalance));
  set('kpi-sellThrough',   pct(overview.sellThrough));
  set('kpi-balanceValue',  myr(overview.totalValue));
}

// ── YTD Badge ──
function renderYTDBadge() {
  const el = document.getElementById('ytdBadge');
  if (!el) return;
  const now = new Date();
  const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  el.textContent = 'YTD ' + label;
}

// ── Monthly Trend (Overview tab, above KPI cards) ──
// Backed by monthly_snapshots — the one table this app carries across monthly data reloads (see
// scripts/excel_to_sqlite.py), so this is the only place a trend-over-time view is possible at
// all; everything else only ever reflects whichever month's Excel file is currently loaded.
const TREND_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatTrendMonth(yearMonth) {
  const [y, m] = String(yearMonth).split('-');
  return `${TREND_MONTH_ABBR[parseInt(m, 10) - 1] || m} ${y}`;
}

function renderMonthlyTrendChart(rows) {
  destroyChart('monthlyTrend');
  const ctx = document.getElementById('chartMonthlyTrend');
  if (!ctx || !rows.length) return;
  charts.monthlyTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map(r => formatTrendMonth(r.yearMonth)),
      datasets: [
        {
          label: 'Sell-Through %',
          data: rows.map(r => r.sellThroughPct),
          borderColor: C.blue,
          backgroundColor: C.blue,
          yAxisID: 'y',
          tension: 0.3,
        },
        {
          label: 'Balance Value',
          data: rows.map(r => r.balanceValue),
          borderColor: C.gold,
          backgroundColor: C.gold,
          yAxisID: 'y1',
          tension: 0.3,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y:  { type: 'linear', position: 'left',  title: { display: true, text: 'Sell-Through %' },
              ticks: { callback: v => v + '%' } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'Balance Value' },
              grid: { drawOnChartArea: false }, ticks: { callback: v => myrCompact(v) } },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          callbacks: {
            label: (c) => c.dataset.label === 'Sell-Through %'
              ? `${c.dataset.label}: ${pct(c.parsed.y)}`
              : `${c.dataset.label}: ${myr(c.parsed.y)}`,
          },
        },
      },
    },
  });
}

// One cell = this month's value plus a small colored MoM % indicator underneath — same
// direction/color convention as Sales Velocity's MoM columns (pct-up/pct-down/pct-none), with a
// ▲/▼ glyph added (matching the sort-arrow glyph already used elsewhere) since this is a single
// stacked cell rather than its own dedicated MoM column.
function renderTrendCell(formattedValue, momPct) {
  if (momPct === null || momPct === undefined || !isFinite(momPct)) {
    return `<td>${formattedValue}<div class="trend-mom pct-none">—</div></td>`;
  }
  const cls = momPct > 0 ? 'pct-up' : momPct < 0 ? 'pct-down' : 'pct-none';
  const arrow = momPct > 0 ? '▲' : momPct < 0 ? '▼' : '–';
  const sign = momPct > 0 ? '+' : '';
  return `<td>${formattedValue}<div class="trend-mom ${cls}">${arrow} ${sign}${momPct.toFixed(1)}%</div></td>`;
}

function renderMonthlyTrendTable(rows) {
  const body = document.querySelector('#tableMonthlyTrend tbody');
  if (!body) return;
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${formatTrendMonth(r.yearMonth)}</td>
      ${renderTrendCell(fmt(r.totalStock), r.momPct.totalStock)}
      ${renderTrendCell(fmt(r.totalSold), r.momPct.totalSold)}
      ${renderTrendCell(fmt(r.totalBalance), r.momPct.totalBalance)}
      ${renderTrendCell(pct(r.sellThroughPct), r.momPct.sellThroughPct)}
      ${renderTrendCell(myr(r.balanceValue), r.momPct.balanceValue)}
    </tr>
  `).join('');
}

async function loadMonthlyTrend() {
  try {
    const res = await fetch('/api/overview/monthly-trend');
    if (res.status === 401 || res.redirected || res.url.includes('/login')) return;
    if (!res.ok) throw new Error('Failed to load monthly trend');
    const d = await res.json();
    renderMonthlyTrendChart(d.rows);
    renderMonthlyTrendTable(d.rows);
  } catch (err) {
    console.error('[dashboard] loadMonthlyTrend failed:', err);
  }
}

// ── Lot Drill-Down ──
let lastLotRows = [];
let lastLotMode = 'structured';

const STRUCTURED_MATERIAL_TYPES = ['NV Niche', 'NV Pedestal', 'NV Pet Niche', 'NV EBL', 'NV Baby Paradise'];
const FLAT_MATERIAL_TYPES = ['NV Burial Plot', 'NV Seed', 'NV Urn Burial Plot', 'NV Pet Burial Plot'];

function materialTypeMode(materialType) {
  if (!materialType) return null;
  if (STRUCTURED_MATERIAL_TYPES.includes(materialType)) return 'structured';
  if (FLAT_MATERIAL_TYPES.includes(materialType)) return 'flat';
  return null;
}

// stripNVPrefix lives in common.js (loaded first) — shared across every tab.

function lotStatusBadgeClass(status) {
  return { OPEN: 'badge--red', CONFIRMED: 'badge--green', EXERCISED: 'badge--blue', HOLD: 'badge--amber' }[status] || 'badge--navy';
}

function sumLotRows(rows) {
  return rows.reduce((acc, r) => {
    acc.lotCount += r.lotCount;
    acc.totalStock += r.totalStock;
    acc.totalSold += r.totalSold;
    acc.totalBalance += r.totalBalance;
    acc.totalBalanceAmount += r.totalBalanceAmount;
    return acc;
  }, { lotCount: 0, totalStock: 0, totalSold: 0, totalBalance: 0, totalBalanceAmount: 0 });
}

// Column configs drive header rendering, sorting, and body rendering together so
// structured/flat modes and text/number sort behavior stay in one place.
const LOT_COLUMNS = {
  structured: [
    { key: 'materialType',       label: 'Product Type',  type: 'text',   render: r => stripNVPrefix(r.materialType) },
    { key: 'zone',                label: 'Zone',           type: 'text' },
    { key: 'level',                label: 'Level',          type: 'text' },
    { key: 'lotType',              label: 'Lot Type',       type: 'text' },
    { key: 'status',               label: 'Status',         type: 'text',   render: r => `<span class="badge ${lotStatusBadgeClass(r.status)}">${r.status}</span>` },
    { key: 'lotCount',            label: 'Lots',           type: 'number', render: r => fmt(r.lotCount) },
    { key: 'totalStock',         label: 'Total Stock',    type: 'number', render: r => fmt(r.totalStock) },
    { key: 'totalSold',           label: 'Sold',           type: 'number', render: r => fmt(r.totalSold) },
    { key: 'totalBalance',       label: 'Balance',        type: 'number', render: r => fmt(r.totalBalance) },
    { key: 'totalBalanceAmount', label: 'Balance Value',  type: 'number', render: r => myr(r.totalBalanceAmount) },
  ],
  flat: [
    { key: 'materialType',       label: 'Product Type',  type: 'text',   render: r => stripNVPrefix(r.materialType) },
    { key: 'lotType',              label: 'Lot Type',       type: 'text' },
    { key: 'status',               label: 'Status',         type: 'text',   render: r => `<span class="badge ${lotStatusBadgeClass(r.status)}">${r.status}</span>` },
    { key: 'lotCount',            label: 'Lots',           type: 'number', render: r => fmt(r.lotCount) },
    { key: 'totalStock',         label: 'Total Stock',    type: 'number', render: r => fmt(r.totalStock) },
    { key: 'totalSold',           label: 'Sold',           type: 'number', render: r => fmt(r.totalSold) },
    { key: 'totalBalance',       label: 'Balance',        type: 'number', render: r => fmt(r.totalBalance) },
    { key: 'totalBalanceAmount', label: 'Balance Value',  type: 'number', render: r => myr(r.totalBalanceAmount) },
  ],
};

function lotColumnsFor(mode) {
  return LOT_COLUMNS[mode] || LOT_COLUMNS.structured;
}

// +1 for the trailing View Lots action column (not a sortable data column, so it isn't part
// of LOT_COLUMNS itself).
function lotTableColumnCount(mode) {
  return lotColumnsFor(mode).length + 1;
}

// { key: null } means unsorted (server/group order).
let lotSortState = { key: null, dir: 'asc' };

function sortLotRows(rows, sortState) {
  if (!sortState.key) return rows;
  const { key, dir } = sortState;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : naturalCompare(av, bv);
    return cmp * sign;
  });
}

function renderLotsTableHead(mode) {
  const headRow = document.getElementById('lotsHeadRow');
  if (!headRow) return;
  headRow.innerHTML = lotColumnsFor(mode).map(col => {
    const isSorted = lotSortState.key === col.key;
    const arrow = isSorted ? `<span class="sort-arrow">${lotSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th${isSorted ? ' sorted' : ''}" data-key="${col.key}">${col.label}${arrow}</th>`;
  }).join('') + '<th></th>';
}

// Lot Results rows are already grouped by Zone+Level+Lot Type+Status (structured) or
// Lot Type+Status (flat) — see queryLots in routes/lots.js — granular enough that View Lots
// attaches directly to the row, no intermediate breakdown step needed. Branch/Price Range
// aren't part of that grouping (a row can span every branch/price range currently in scope),
// so the underlying fetch reads those live from the filter panel — see
// loadLotResultRowLotsContent — the same "no single pinned value, fall back to the tab's own
// filter" approach Aged Inventory's Zone Breakdown already uses for its multi-branch rows.
function renderLotResultViewLotsCell(r, mode) {
  const lotTypeFilter = renderLotTypeFilterHTML({
    product: r.materialType,
    priceRange: '', // Price Range is scoped at the filter-panel level here, not per row
    zone: mode === 'structured' ? r.zone : undefined,
  });
  const zoneAttr = mode === 'structured' ? ` data-zone="${escapeHtml(r.zone)}"` : '';
  const levelAttr = mode === 'structured' ? ` data-level="${escapeHtml(r.level)}"` : '';
  const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-lotresult-lots"
    data-material-type="${escapeHtml(r.materialType)}" data-lot-type="${escapeHtml(r.lotType)}"
    data-status="${escapeHtml(r.status)}"${zoneAttr}${levelAttr}>View Lots</button>`;
  return `<div class="row-actions">${lotTypeFilter}${viewLotsBtn}</div>`;
}

function renderLotResultsBody(mode) {
  const tbody = document.querySelector('#tableLots tbody');
  const tfoot = document.querySelector('#tableLots tfoot');
  if (!tbody) return;

  const columns = lotColumnsFor(mode);
  const colCount = lotTableColumnCount(mode);
  const rows = sortLotRows(lastLotRows, lotSortState);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No lots match these filters.</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const cells = columns.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('');
    return `<tr class="accordion-row">${cells}<td>${renderLotResultViewLotsCell(r, mode)}</td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>`;
  }).join('');

  const t = sumLotRows(lastLotRows);
  const textColCount = columns.filter(c => c.type === 'text').length;
  const numericCells = columns.filter(c => c.type === 'number')
    .map(col => `<td>${col.key === 'totalBalanceAmount' ? myr(t[col.key]) : fmt(t[col.key])}</td>`).join('');
  if (tfoot) {
    tfoot.innerHTML = `<tr class="totals-row"><td colspan="${textColCount}">Totals</td>${numericCells}<td></td></tr>`;
  }
}

// Re-renders head + body from the cached rows/mode/sort state — no re-query.
function renderLotResultsTable() {
  renderLotsTableHead(lastLotMode);
  renderLotResultsBody(lastLotMode);
}

function onLotSortClick(key) {
  if (lotSortState.key === key) {
    lotSortState = { key, dir: lotSortState.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    lotSortState = { key, dir: 'asc' };
  }
  renderLotResultsTable();
}

// ── Lot Results row-level View Lots ──
// Unlike Pricing's Zone Breakdown (whose rows share one already-known Branch/Price Range), a
// Lot Results row can span every branch/price range currently in scope, so this reads them
// live from the filter panel rather than a pinned per-row value. Status is NOT forced to OPEN
// here (unlike Pricing's patterns, which are inherently about unsold stock) — Lot Results
// covers every status, so View Lots uses each row's own status. The row's own Lot Type is
// already fixed by the GROUP BY that produced it, so an untouched Lot Type filter defaults to
// exactly that value; explicitly checking/clearing options (including Clear All, to broaden
// beyond this row) takes over from there, same as everywhere else the filter appears.
async function loadLotResultRowLotsContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const checkedLotTypes = lotTypeFilterValues(btn.closest('tr'));
    const lotType = checkedLotTypes.length ? checkedLotTypes : [btn.dataset.lotType];
    const filters = {
      materialType: [btn.dataset.materialType],
      branch: lotFilters.branch.getValues(),
      priceRange: lotFilters.priceRange.getValues(),
      status: [btn.dataset.status],
      lotType,
    };
    if (btn.dataset.zone !== undefined) filters.zone = [btn.dataset.zone];
    if (btn.dataset.level !== undefined) filters.level = [btn.dataset.level];

    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    const zoneLabel = btn.dataset.zone !== undefined ? ` · Zone ${escapeHtml(btn.dataset.zone)}` : '';
    const levelLabel = btn.dataset.level !== undefined ? ` · Level ${escapeHtml(btn.dataset.level)}` : '';
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.materialType))} (${fmt(totalQty)} units)${zoneLabel}${levelLabel} · ${escapeHtml(btn.dataset.status)}`,
      filenameBase: `lot_results_${sanitizeForFilename(btn.dataset.materialType)}_${sanitizeForFilename(btn.dataset.lotType)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] loadLotResultRowLotsContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

async function toggleLotResultLots(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = 'View Lots'; return; }

  detailRow.style.display = '';
  btn.textContent = 'Hide Lots';
  const content = detailRow.querySelector('[data-drill-content]');
  if (content.dataset.loaded === 'true') return;
  await loadLotResultRowLotsContent(btn, content);
}

// Delegated listener for the Lot Results table's View Lots + Lot Type filter interactions —
// mirrors initPricingTabEvents()'s equivalent block, scoped to this tab instead.
function initLotResultsEvents() {
  const panel = document.getElementById('tab-lots');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    if (handleDrillDownPaginationOrExport(e)) return;

    const viewLotsBtn = e.target.closest('button[data-action="toggle-lotresult-lots"]');
    if (viewLotsBtn) { toggleLotResultLots(viewLotsBtn); return; }

    const lotTypeCb = e.target.closest('[data-lot-type-filter] input[type="checkbox"]');
    if (lotTypeCb) {
      onLotTypeFilterChanged(lotTypeCb.closest('[data-lot-type-filter]'), {
        buttonSelector: 'button[data-action="toggle-lotresult-lots"]',
        loader: loadLotResultRowLotsContent,
      });
      return;
    }

    const lotTypeSelectAll = e.target.closest('[data-lot-type-select-all]');
    if (lotTypeSelectAll) {
      const details = lotTypeSelectAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      onLotTypeFilterChanged(details, {
        buttonSelector: 'button[data-action="toggle-lotresult-lots"]',
        loader: loadLotResultRowLotsContent,
      });
      return;
    }

    const lotTypeClearAll = e.target.closest('[data-lot-type-clear-all]');
    if (lotTypeClearAll) {
      const details = lotTypeClearAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      onLotTypeFilterChanged(details, {
        buttonSelector: 'button[data-action="toggle-lotresult-lots"]',
        loader: loadLotResultRowLotsContent,
      });
      return;
    }
  });

  // Lot Type options are fetched lazily on first open — <details>'s "toggle" event doesn't
  // bubble, so this has to listen in the capture phase to catch it via delegation at all.
  panel.addEventListener('toggle', (e) => {
    const details = e.target.closest && e.target.closest('[data-lot-type-filter]');
    if (details && details.open && details.dataset.loaded !== 'true') {
      details.dataset.loaded = 'true';
      loadLotTypeOptionsForDetails(details, lotFilters.branch.getValues());
    }
  }, true);
}

async function renderLotDrillDown() {
  const tbody = document.querySelector('#tableLots tbody');
  const tfoot = document.querySelector('#tableLots tfoot');
  if (!tbody) return;

  const materialType = lotFilters.materialType.getValues();
  const mode = modeForSelection(materialType);

  if (!materialType.length || !mode) {
    lastLotRows = [];
    lastLotMode = 'structured';
    lotSortState = { key: null, dir: 'asc' };
    matrixSortState = { key: null, dir: 'desc' };
    renderLotsTableHead('structured');
    tbody.innerHTML = `<tr><td colspan="${lotTableColumnCount('structured')}" style="text-align:center;color:var(--muted)">Please select a Product Type to begin.</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    renderLotMatrix([], {}, 'structured');
    return;
  }

  const body = {
    materialType,
    branch: lotFilters.branch.getValues(),
    zone:   lotFilters.zone.getValues(),
    status: lotFilters.status.getValues(),
    priceRange: lotFilters.priceRange.getValues(),
    bigLotFilter: window.bigLotFilter,
  };
  if (mode === 'structured') {
    body.suiteNo = lotFilters.suiteNo.getValues();
    body.section = lotFilters.section.getValues();
    body.level   = lotFilters.level.getValues();
  } else {
    body.lotType = lotFilters.lotType.getValues();
  }

  renderLotsTableHead(mode);
  const colCount = lotTableColumnCount(mode);
  tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  if (tfoot) tfoot.innerHTML = '';

  try {
    const res = await fetch('/api/lots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.redirected || res.url.includes('/login')) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--red)">Session expired — please log in again.</td></tr>`;
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || 'Failed to load lot data');
    }

    const data = await res.json();
    const rows = data.rows;
    const resolvedMode = data.mode || mode;
    lastLotRows = rows;
    lastLotMode = resolvedMode;
    lotSortState = { key: null, dir: 'asc' };
    // Default matrix view: newest/highest Level first. Lot Type (flat land) rows
    // have no such ordering, so they keep the natural ascending default.
    matrixSortState = { key: null, dir: resolvedMode === 'flat' ? 'asc' : 'desc' };
    const matrixCtx = { branch: body.branch, materialType, zone: body.zone, suite: body.suiteNo || [], section: body.section || [] };

    renderLotResultsTable();
    renderLotMatrix(rows, matrixCtx, resolvedMode);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
    renderLotMatrix([], {}, mode);
  }
}

// ── Zone Summary Matrix ──
const MATRIX_STATUS_ORDER = ['CONFIRMED', 'EXERCISED', 'OPEN', 'HOLD', 'RESERVED', 'BOOKED'];

function naturalCompare(a, b) {
  const re = /^(\d+)(.*)$/;
  const ma = String(a).match(re);
  const mb = String(b).match(re);
  if (ma && mb) {
    const na = parseInt(ma[1], 10);
    const nb = parseInt(mb[1], 10);
    if (na !== nb) return na - nb;
    return ma[2].localeCompare(mb[2]);
  }
  return String(a).localeCompare(String(b));
}

function myrCompact(n) {
  const num = Number(n) || 0;
  const abs = Math.abs(num);
  let val, suffix;
  if (abs >= 1e9)      { val = num / 1e9; suffix = 'B'; }
  else if (abs >= 1e6) { val = num / 1e6; suffix = 'M'; }
  else if (abs >= 1e3) { val = num / 1e3; suffix = 'K'; }
  else                 { val = num; suffix = ''; }
  const formatted = suffix ? val.toFixed(1).replace(/\.0$/, '') : Math.round(val).toString();
  return 'RM ' + formatted + suffix;
}

// Qty is always shown; Amount/% become their own columns only when their checkbox is on
// (rather than stacked lines in one cell), on-screen and in both exports alike.
function matrixMetrics(showAmount, showPercentage) {
  const metrics = [{ key: 'qty', label: 'Qty' }];
  if (showAmount) metrics.push({ key: 'amount', label: 'Amount' });
  if (showPercentage) metrics.push({ key: 'pct', label: '%' });
  return metrics;
}

function matrixMetricPct(units, grandTotal) {
  return grandTotal > 0 ? (units / grandTotal) * 100 : 0;
}

// Display text for the on-screen table and the PDF (which, like the screen, favors the
// compact "RM 8.2M" form). Excel uses raw numbers instead — see matrixMetricRawValue.
function matrixMetricText(key, units, amount, grandTotal) {
  if (key === 'qty') return fmt(units);
  if (key === 'amount') return myrCompact(amount);
  return `${matrixMetricPct(units, grandTotal).toFixed(1)}%`;
}

function matrixMetricClass(key) {
  return key === 'qty' ? 'matrix-qty-col' : key === 'amount' ? 'matrix-amount-col' : 'matrix-pct-col';
}

// Cache of the last matrix render inputs so the Show Amount / Show Percentage
// checkboxes (and sort clicks) can re-render instantly client-side without re-querying.
let lastMatrixRows = [];
let lastMatrixCtx = {};
let lastMatrixMode = 'structured';

// key: null (default natural order) | 'GROUP' (row label, i.e. Level/Lot Type) |
// one of MATRIX_STATUS_ORDER (that column's total) | 'TOTAL' (the row-total column).
let matrixSortState = { key: null, dir: 'asc' };

function matrixSortArrow(key) {
  return matrixSortState.key === key
    ? `<span class="sort-arrow">${matrixSortState.dir === 'asc' ? '▲' : '▼'}</span>`
    : '';
}

function joinOrAll(list, allLabel) {
  return (list && list.length) ? list.join(', ') : allLabel;
}

// Single source of truth for the matrix's aggregation/sort — used by both the on-screen
// render and the Excel/PDF exports, so they can never drift out of sync with each other.
function computeMatrixData(rows, mode) {
  const showAmount = document.getElementById('matrixShowAmount')?.checked ?? true;
  const showPercentage = document.getElementById('matrixShowPercentage')?.checked ?? false;

  const groupKey = mode === 'flat' ? 'lotType' : 'level';
  const groupLabel = mode === 'flat' ? 'Lot Type' : 'Level';
  const groups = Array.from(new Set(rows.map(r => r[groupKey])));

  const cells = {};
  for (const status of MATRIX_STATUS_ORDER) {
    cells[status] = {};
    for (const group of groups) cells[status][group] = { units: 0, amount: 0 };
  }
  for (const r of rows) {
    if (!cells[r.status]) continue;
    cells[r.status][r[groupKey]].units += r.totalStock;
    cells[r.status][r[groupKey]].amount += r.totalBalanceAmount;
  }

  // Per-group (row) totals, needed for the TOTAL column, for sorting by it, and for export.
  const groupTotals = {};
  const groupAmounts = {};
  for (const group of groups) {
    groupTotals[group] = MATRIX_STATUS_ORDER.reduce((sum, s) => sum + cells[s][group].units, 0);
    groupAmounts[group] = MATRIX_STATUS_ORDER.reduce((sum, s) => sum + cells[s][group].amount, 0);
  }

  // Sort rows: default is natural order (e.g. Level "2" before "10"); explicit clicks can
  // sort by the row label itself or by any column's (or the TOTAL column's) units value.
  const { key: sortKey, dir: sortDir } = matrixSortState;
  const sign = sortDir === 'asc' ? 1 : -1;
  groups.sort((a, b) => {
    let cmp;
    if (!sortKey || sortKey === 'GROUP') cmp = naturalCompare(a, b);
    else if (sortKey === 'TOTAL') cmp = groupTotals[a] - groupTotals[b];
    else cmp = cells[sortKey][a].units - cells[sortKey][b].units;
    return cmp * sign;
  });

  // Percentages are always relative to the grand total (not the row total), per spec.
  const colTotals = {};
  MATRIX_STATUS_ORDER.forEach(s => { colTotals[s] = { units: 0, amount: 0 }; });
  let grandUnits = 0;
  let grandAmount = 0;
  for (const group of groups) {
    for (const status of MATRIX_STATUS_ORDER) {
      colTotals[status].units += cells[status][group].units;
      colTotals[status].amount += cells[status][group].amount;
    }
    grandUnits += groupTotals[group];
    grandAmount += groupAmounts[group];
  }

  return {
    showAmount, showPercentage, groupKey, groupLabel, groups, cells,
    groupTotals, groupAmounts, colTotals, grandUnits, grandAmount,
  };
}

function renderLotMatrix(rows, ctx, mode = 'structured') {
  lastMatrixRows = rows;
  lastMatrixCtx = ctx;
  lastMatrixMode = mode;

  const card = document.getElementById('lotMatrixCard');
  const titleEl = document.getElementById('lotMatrixTitle');
  if (!card) return;

  if (!rows.length) {
    card.style.display = 'none';
    return;
  }

  const { showAmount, showPercentage, groupLabel, groups, cells, groupTotals, groupAmounts, colTotals, grandUnits, grandAmount } =
    computeMatrixData(rows, mode);
  const metrics = matrixMetrics(showAmount, showPercentage);
  const metricText = (key, units, amount) => matrixMetricText(key, units, amount, grandUnits);

  if (titleEl) titleEl.textContent = mode === 'flat' ? 'Lot Type Summary Matrix' : 'Zone Summary Matrix';

  const headerEl = document.getElementById('matrixHeader');
  if (headerEl) {
    const branchLabel = joinOrAll(ctx.branch, 'All Branches');
    const productLabel = joinOrAll((ctx.materialType || []).map(stripNVPrefix), 'All');
    const zoneLabel = joinOrAll(ctx.zone, 'All');
    const suiteLabel = joinOrAll(ctx.suite, 'All');
    headerEl.innerHTML = mode === 'flat'
      ? `<span><strong>${branchLabel}</strong> — <strong>${productLabel}</strong> — Lot Type Summary</span>`
      : `<span><strong>${branchLabel}</strong> — <strong>${productLabel}</strong> — Zone <strong>${zoneLabel}</strong> — Suite <strong>${suiteLabel}</strong></span>`;
  }

  const headRow = document.getElementById('matrixHeadRow');
  if (headRow) {
    const groupTh = `<th rowspan="2" class="sortable-th${matrixSortState.key === 'GROUP' ? ' sorted' : ''}" data-matrix-key="GROUP">${groupLabel}${matrixSortArrow('GROUP')}</th>`;
    const statusThs = MATRIX_STATUS_ORDER.map(s => {
      const openClass = s === 'OPEN' ? ' matrix-open-col' : '';
      const sortedClass = matrixSortState.key === s ? ' sorted' : '';
      return `<th colspan="${metrics.length}" class="sortable-th${openClass}${sortedClass}" data-matrix-key="${s}">${s}${matrixSortArrow(s)}</th>`;
    }).join('');
    const totalTh = `<th colspan="${metrics.length}" class="sortable-th${matrixSortState.key === 'TOTAL' ? ' sorted' : ''}" data-matrix-key="TOTAL">TOTAL${matrixSortArrow('TOTAL')}</th>`;
    headRow.innerHTML = groupTh + statusThs + totalTh;
  }

  const subHeadRow = document.getElementById('matrixSubHeadRow');
  if (subHeadRow) {
    const statusSubThs = MATRIX_STATUS_ORDER.map(s => {
      const openClass = s === 'OPEN' ? ' matrix-open-col' : '';
      return metrics.map(m => `<th class="matrix-sub-th${openClass}">${m.label}</th>`).join('');
    }).join('');
    const totalSubThs = metrics.map(m => `<th class="matrix-sub-th">${m.label}</th>`).join('');
    subHeadRow.innerHTML = statusSubThs + totalSubThs;
  }

  const body = document.getElementById('matrixBody');
  if (body) {
    body.innerHTML = groups.map(group => {
      const tds = MATRIX_STATUS_ORDER.map(status => {
        const c = cells[status][group];
        const openClass = status === 'OPEN' ? ' matrix-open-col' : '';
        return metrics.map(m => `<td class="${matrixMetricClass(m.key)}${openClass}">${metricText(m.key, c.units, c.amount)}</td>`).join('');
      }).join('');
      const totalTds = metrics.map(m =>
        `<td class="matrix-total-cell ${matrixMetricClass(m.key)}">${metricText(m.key, groupTotals[group], groupAmounts[group])}</td>`
      ).join('');
      return `<tr>
        <td><strong>${group}</strong></td>
        ${tds}
        ${totalTds}
      </tr>`;
    }).join('');
  }

  const foot = document.getElementById('matrixFoot');
  if (foot) {
    const tds = MATRIX_STATUS_ORDER.map(status => {
      const openClass = status === 'OPEN' ? ' matrix-open-col' : '';
      return metrics.map(m => `<td class="${matrixMetricClass(m.key)}${openClass}">${metricText(m.key, colTotals[status].units, colTotals[status].amount)}</td>`).join('');
    }).join('');
    const totalTds = metrics.map(m => `<td class="${matrixMetricClass(m.key)}">${metricText(m.key, grandUnits, grandAmount)}</td>`).join('');
    foot.innerHTML = `<tr class="matrix-total-row">
      <td>TOTAL</td>
      ${tds}
      ${totalTds}
    </tr>`;
  }

  const totalUnits = rows.reduce((s, r) => s + r.totalStock, 0);
  const totalSold  = rows.reduce((s, r) => s + r.totalSold, 0);
  const totalUnsoldOpen = rows.filter(r => r.status === 'OPEN').reduce((s, r) => s + r.totalBalance, 0);

  const kpiRow = document.getElementById('matrixKpiRow');
  if (kpiRow) {
    kpiRow.innerHTML = `
      <div class="matrix-kpi"><div class="matrix-kpi-value">${fmt(totalUnits)}</div><div class="matrix-kpi-label">Total Units</div></div>
      <div class="matrix-kpi"><div class="matrix-kpi-value">${fmt(totalSold)}</div><div class="matrix-kpi-label">Total Sold</div></div>
      <div class="matrix-kpi"><div class="matrix-kpi-value">${fmt(totalUnsoldOpen)}</div><div class="matrix-kpi-label">Total Unsold (OPEN)</div></div>
    `;
  }

  card.style.display = '';
}

function exportLotsCSV() {
  if (!lastLotRows.length) { alert('No data to export. Run a search first.'); return; }
  const isFlat = lastLotMode === 'flat';
  const header = isFlat
    ? ['Product Type', 'Lot Type', 'Status', 'Lots', 'Total Stock', 'Sold', 'Balance', 'Balance Value']
    : ['Product Type', 'Zone', 'Level', 'Lot Type', 'Status', 'Lots', 'Total Stock', 'Sold', 'Balance', 'Balance Value'];
  const lines = [header.join(',')];
  for (const r of lastLotRows) {
    const fields = isFlat
      ? [stripNVPrefix(r.materialType), r.lotType, r.status, r.lotCount, r.totalStock, r.totalSold, r.totalBalance, r.totalBalanceAmount]
      : [stripNVPrefix(r.materialType), r.zone, r.level, r.lotType, r.status, r.lotCount, r.totalStock, r.totalSold, r.totalBalance, r.totalBalanceAmount];
    lines.push(fields.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lot_drilldown_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Zone/Lot Type Summary Matrix — Excel & PDF export ──
function sanitizeForFilename(s) {
  return String(s ?? '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function filenamePart(list) {
  if (!list || !list.length) return 'All';
  return sanitizeForFilename(list.join('_')) || 'All';
}

function fileTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Shared labels/filename base for both export formats, built from the matrix's cached
// filter context (lastMatrixCtx) rather than re-reading the DOM.
function matrixExportContext() {
  const ctx = lastMatrixCtx || {};
  const mode = lastMatrixMode;
  const productTypes = (ctx.materialType || []).map(stripNVPrefix);
  const title = mode === 'flat' ? 'Lot Type Summary Matrix' : 'Zone Summary Matrix';
  const filenameBase = [
    'Zone_Summary',
    filenamePart(ctx.branch),
    filenamePart(productTypes),
    filenamePart(ctx.zone),
    fileTimestamp(),
  ].join('_');
  return {
    ctx, mode, title, filenameBase,
    branchLabel: joinOrAll(ctx.branch, 'All Branches'),
    productLabel: joinOrAll(productTypes, 'All'),
    zoneLabel: joinOrAll(ctx.zone, 'All'),
    suiteLabel: joinOrAll(ctx.suite, 'All'),
    sectionLabel: joinOrAll(ctx.section, 'All'),
  };
}

// Raw numeric value per metric for Excel (as opposed to the compact display strings used
// on-screen and in the PDF) — lets analysts sum/sort/filter the sheet natively.
function matrixMetricRawValue(key, units, amount, grandTotal) {
  if (key === 'qty') return units;
  if (key === 'amount') return amount;
  return Number(matrixMetricPct(units, grandTotal).toFixed(1));
}

function matrixMetricNumFmt(key) {
  if (key === 'qty') return '#,##0';
  if (key === 'amount') return '"RM "#,##0';
  return '0.0"%"';
}

function exportMatrixExcel() {
  if (!lastMatrixRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const { mode, branchLabel, productLabel, zoneLabel, suiteLabel, sectionLabel, title, filenameBase } = matrixExportContext();
  const { showAmount, showPercentage, groupLabel, groups, cells, groupTotals, groupAmounts, colTotals, grandUnits, grandAmount } =
    computeMatrixData(lastMatrixRows, mode);
  const metrics = matrixMetrics(showAmount, showPercentage);
  const rawVal = (key, units, amount) => matrixMetricRawValue(key, units, amount, grandUnits);

  const aoa = [
    [title],
    ['Branch', branchLabel],
    ['Product Type', productLabel],
    ['Zone', zoneLabel],
  ];
  if (mode === 'structured') {
    aoa.push(['Suite No', suiteLabel]);
    aoa.push(['Section', sectionLabel]);
  }
  aoa.push([]);

  // Two-row header: status name spanning its Qty/Amount/% sub-columns, mirroring the
  // on-screen table (and merged below the same way a colspan/rowspan would render it).
  const headerRowIdx1 = aoa.length;
  const headerRowIdx2 = headerRowIdx1 + 1;
  const headerRow1 = [groupLabel];
  const headerRow2 = [''];
  MATRIX_STATUS_ORDER.forEach(s => {
    headerRow1.push(s, ...Array(metrics.length - 1).fill(''));
    headerRow2.push(...metrics.map(m => m.label));
  });
  headerRow1.push('TOTAL', ...Array(metrics.length - 1).fill(''));
  headerRow2.push(...metrics.map(m => m.label));
  aoa.push(headerRow1, headerRow2);

  const dataRowStart = aoa.length;
  for (const group of groups) {
    const row = [group];
    MATRIX_STATUS_ORDER.forEach(s => {
      const c = cells[s][group];
      metrics.forEach(m => row.push(rawVal(m.key, c.units, c.amount)));
    });
    metrics.forEach(m => row.push(rawVal(m.key, groupTotals[group], groupAmounts[group])));
    aoa.push(row);
  }
  const totalRow = ['TOTAL'];
  MATRIX_STATUS_ORDER.forEach(s => {
    metrics.forEach(m => totalRow.push(rawVal(m.key, colTotals[s].units, colTotals[s].amount)));
  });
  metrics.forEach(m => totalRow.push(rawVal(m.key, grandUnits, grandAmount)));
  aoa.push(totalRow);
  const dataRowEnd = aoa.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const merges = [{ s: { r: headerRowIdx1, c: 0 }, e: { r: headerRowIdx2, c: 0 } }];
  if (metrics.length > 1) {
    let col = 1;
    [...MATRIX_STATUS_ORDER, 'TOTAL'].forEach(() => {
      merges.push({ s: { r: headerRowIdx1, c: col }, e: { r: headerRowIdx1, c: col + metrics.length - 1 } });
      col += metrics.length;
    });
  }
  ws['!merges'] = merges;

  const totalCols = 1 + (MATRIX_STATUS_ORDER.length + 1) * metrics.length;
  ws['!cols'] = [{ wch: 12 }, ...Array(totalCols - 1).fill({ wch: 11 })];

  // Apply per-metric number formats to the data + TOTAL rows so Amount/% read naturally.
  for (let r = dataRowStart; r <= dataRowEnd; r++) {
    let col = 1;
    [...MATRIX_STATUS_ORDER, 'TOTAL'].forEach(() => {
      metrics.forEach(m => {
        const ref = XLSX.utils.encode_cell({ r, c: col });
        if (ws[ref]) ws[ref].z = matrixMetricNumFmt(m.key);
        col++;
      });
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, mode === 'flat' ? 'Lot Type Summary' : 'Zone Summary');
  XLSX.writeFile(wb, `${filenameBase}.xlsx`);
}

function exportMatrixPDF() {
  if (!lastMatrixRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof window.jspdf === 'undefined') { alert('PDF export library failed to load — check your connection and try again.'); return; }

  const { jsPDF } = window.jspdf;
  const { mode, branchLabel, productLabel, zoneLabel, suiteLabel, title, filenameBase } = matrixExportContext();
  const { showAmount, showPercentage, groupLabel, groups, cells, groupTotals, groupAmounts, colTotals, grandUnits, grandAmount } =
    computeMatrixData(lastMatrixRows, mode);
  const metrics = matrixMetrics(showAmount, showPercentage);
  const cellText = (key, units, amount) => matrixMetricText(key, units, amount, grandUnits);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  // Structured types carry a Suite No context (flat land has no such concept).
  const titleText = mode === 'structured'
    ? `${title} — ${branchLabel} — ${productLabel} — Zone ${zoneLabel} — Suite ${suiteLabel}`
    : `${title} — ${branchLabel} — ${productLabel} — Zone ${zoneLabel}`;

  doc.setFontSize(14);
  doc.setTextColor(26, 44, 91);
  doc.text(titleText, 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 52);

  // Two-row header: status name spanning its Qty/Amount/% sub-columns.
  const head = [
    [
      { content: groupLabel, rowSpan: 2 },
      ...MATRIX_STATUS_ORDER.map(s => ({ content: s, colSpan: metrics.length })),
      { content: 'TOTAL', colSpan: metrics.length },
    ],
    [
      ...MATRIX_STATUS_ORDER.flatMap(() => metrics.map(m => m.label)),
      ...metrics.map(m => m.label),
    ],
  ];
  const body = groups.map(group => [
    group,
    ...MATRIX_STATUS_ORDER.flatMap(s => metrics.map(m => cellText(m.key, cells[s][group].units, cells[s][group].amount))),
    ...metrics.map(m => cellText(m.key, groupTotals[group], groupAmounts[group])),
  ]);
  const foot = [[
    'TOTAL',
    ...MATRIX_STATUS_ORDER.flatMap(s => metrics.map(m => cellText(m.key, colTotals[s].units, colTotals[s].amount))),
    ...metrics.map(m => cellText(m.key, grandUnits, grandAmount)),
  ]];

  const openColStart = 1 + MATRIX_STATUS_ORDER.indexOf('OPEN') * metrics.length;
  const openColEnd = openColStart + metrics.length - 1;
  const totalColStart = 1 + MATRIX_STATUS_ORDER.length * metrics.length;
  const totalColEnd = totalColStart + metrics.length - 1;

  doc.autoTable({
    startY: 66,
    head, body, foot,
    styles: { fontSize: 8, cellPadding: 4, valign: 'middle', halign: 'center' },
    headStyles: { fillColor: [26, 44, 91], textColor: [255, 255, 255] },
    footStyles: { fillColor: [219, 227, 245], textColor: [26, 44, 91], fontStyle: 'bold' },
    columnStyles: { 0: { fontStyle: 'bold' } },
    didParseCell(d) {
      const isOpenCol = d.column.index >= openColStart && d.column.index <= openColEnd;
      const isTotalCol = d.column.index >= totalColStart && d.column.index <= totalColEnd;
      const isFoot = d.section === 'foot';
      const isHead = d.section === 'head';
      // Mirrors the on-screen CSS: OPEN gets a light-blue tint everywhere (a darker
      // blend where it meets the TOTAL row); the TOTAL column is bold-tinted in
      // body/foot only — its header cell stays the plain navy/white header style.
      if (isOpenCol) {
        d.cell.styles.fillColor = isFoot ? [199, 213, 242] : [230, 241, 251];
        d.cell.styles.textColor = [26, 44, 91];
        if (isFoot) d.cell.styles.fontStyle = 'bold';
      }
      if (isTotalCol && !isHead) {
        d.cell.styles.fillColor = [219, 227, 245];
        d.cell.styles.textColor = [26, 44, 91];
        d.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage() {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text('Confidential — Nirvana Asia Group Central Region', 40, pageHeight - 18);
    },
  });

  doc.save(`${filenameBase}.pdf`);
}

// ── Multi-select dropdown component ──
// Mimics just enough of a <select multiple>'s API (getValues/setOptions/setDisabled) that
// the cascade logic below can treat every filter uniformly. Empty selection == "All" (no filter).
class MultiSelect {
  constructor(id, { placeholder = 'All', disabledText, emptyText = 'No options', displayFn = v => v, onChange = () => {} } = {}) {
    this.root = document.getElementById(id);
    // `placeholder` shows when enabled with nothing selected ("All branches" == no filter).
    // `disabledText` shows only while gated off (e.g. "Select product type first") — kept
    // separate so re-enabling the field doesn't leave it stuck on the disabled-gate text.
    this.placeholder = placeholder;
    this.disabledText = disabledText || placeholder;
    this.emptyText = emptyText;
    this.displayFn = displayFn;
    this.onChange = onChange;
    this.options = [];
    this.selected = new Set();
    this.disabled = false;
    if (!this.root) return;
    this.root.classList.add('ms');
    this.root.innerHTML = `
      <button type="button" class="ms-toggle"></button>
      <div class="ms-panel" hidden>
        <div class="ms-actions">
          <button type="button" class="ms-select-all">Select All</button>
          <button type="button" class="ms-clear-all">Clear All</button>
        </div>
        <div class="ms-options"></div>
      </div>`;
    this.toggleBtn = this.root.querySelector('.ms-toggle');
    this.panel = this.root.querySelector('.ms-panel');
    this.optionsEl = this.root.querySelector('.ms-options');

    this.toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); this._togglePanel(); });
    this.root.querySelector('.ms-select-all').addEventListener('click', (e) => { e.stopPropagation(); this.selectAll(); });
    this.root.querySelector('.ms-clear-all').addEventListener('click', (e) => { e.stopPropagation(); this.clearAll(); });
    this.optionsEl.addEventListener('change', (e) => {
      if (!e.target.matches('input[type="checkbox"]')) return;
      if (e.target.checked) this.selected.add(e.target.value); else this.selected.delete(e.target.value);
      this._render();
      this.onChange(this.getValues());
    });
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target)) this.panel.setAttribute('hidden', '');
    });

    this._render();
  }

  _togglePanel() {
    if (this.disabled) return;
    const isHidden = this.panel.hasAttribute('hidden');
    document.querySelectorAll('.ms-panel').forEach(p => p.setAttribute('hidden', ''));
    if (isHidden) this.panel.removeAttribute('hidden');
  }

  _render() {
    this.optionsEl.innerHTML = this.options.length
      ? this.options.map(v => `<label class="ms-option"><input type="checkbox" value="${escapeHtml(v)}" ${this.selected.has(v) ? 'checked' : ''}> ${escapeHtml(this.displayFn(v))}</label>`).join('')
      : `<div class="ms-empty">${escapeHtml(this.disabled ? this.disabledText : this.emptyText)}</div>`;

    const n = this.selected.size;
    let label;
    if (this.disabled) label = this.disabledText;
    else if (!this.options.length) label = this.emptyText;
    else if (n === 0) label = this.placeholder;
    else if (n === this.options.length) label = `All (${n})`;
    else if (n <= 2) label = [...this.selected].map(this.displayFn).join(', ');
    else label = `${n} selected`;
    this.toggleBtn.textContent = label;
  }

  // preserveSelection keeps any currently-checked values that still exist in the new list —
  // e.g. changing Branch shouldn't blow away a Zone pick that's still valid for the new branch.
  // selectAll defaults every value to checked instead — used where "All" should be the initial
  // state rather than empty, without going through selectAll()'s own onChange side effect.
  setOptions(values, { preserveSelection = true, selectAll = false } = {}) {
    this.options = values;
    this.selected = selectAll ? new Set(values)
      : preserveSelection ? new Set([...this.selected].filter(v => values.includes(v))) : new Set();
    this._render();
  }

  setDisabled(disabled, disabledText) {
    this.disabled = disabled;
    if (disabledText !== undefined) this.disabledText = disabledText;
    this.toggleBtn.disabled = disabled;
    this.root.classList.toggle('ms-disabled', disabled);
    if (disabled) this.panel.setAttribute('hidden', '');
    this._render();
  }

  selectAll() {
    this.selected = new Set(this.options);
    this._render();
    this.onChange(this.getValues());
  }

  clearAll() {
    this.selected = new Set();
    this._render();
    this.onChange(this.getValues());
  }

  // Same effect as clearAll() but skips the onChange callback — for callers that clear
  // several MultiSelects as one batch (e.g. a "reset these fields" quick action) and want
  // a single follow-up refresh instead of one per field.
  clearAllSilent() {
    this.selected = new Set();
    this._render();
  }

  // Programmatically sets the selection to an exact list of values (e.g. a status-flag summary
  // card jumping the filter straight to one value) without going through the checkbox change
  // handler — skips onChange same as clearAllSilent(), so callers that immediately trigger
  // their own refresh right after don't get it fired twice.
  setSelectedValues(values) {
    this.selected = new Set(values.filter(v => this.options.includes(v)));
    this._render();
  }

  getValues() { return [...this.selected]; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function applyLotModeUI(mode) {
  document.querySelectorAll('.structured-only').forEach(el => { el.style.display = mode === 'structured' ? '' : 'none'; });
  document.querySelectorAll('.flat-only').forEach(el => { el.style.display = mode === 'flat' ? '' : 'none'; });
}

// Mirrors the backend's classifyMaterialTypes: mixing structured + flat falls back to the
// structured view; a pure flat-land selection is the only case that gets the flat view.
function modeForSelection(materialTypes) {
  if (!materialTypes.length) return null;
  const modes = new Set(materialTypes.map(materialTypeMode));
  if (modes.has('structured')) return 'structured';
  if (modes.size === 1 && modes.has('flat')) return 'flat';
  return null;
}

// Builds a query string using repeated keys for arrays (?branch=GX&branch=KL), which
// Express's default `qs` query parser reassembles into req.query.branch = ['GX','KL'].
function buildArrayQuery(paramsObj) {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(paramsObj)) {
    const list = Array.isArray(val) ? val : (val !== undefined && val !== null && val !== '' ? [val] : []);
    for (const v of list) qs.append(key, v);
  }
  if (window.bigLotFilter && window.bigLotFilter !== 'all') qs.append('bigLotFilter', window.bigLotFilter);
  return qs.toString();
}

async function fetchLotFilters(branch, materialType) {
  try {
    const res = await fetch(`/api/lots/filters?${buildArrayQuery({ branch, materialType })}`);
    if (!res.ok) return { materialTypes: [], branches: [], priceRanges: [] };
    const { materialTypes, branches, priceRanges } = await res.json();
    return { materialTypes: materialTypes || [], branches: branches || [], priceRanges: priceRanges || [] };
  } catch (e) {
    console.error('[dashboard] fetchLotFilters failed:', e);
    return { materialTypes: [], branches: [], priceRanges: [] };
  }
}

async function fetchLotZones(branch, materialType, priceRange) {
  try {
    const res = await fetch(`/api/lots/zones?${buildArrayQuery({ branch, materialType, priceRange })}`);
    if (!res.ok) return [];
    const { zones } = await res.json();
    return zones;
  } catch (e) {
    console.error('[dashboard] fetchLotZones failed:', e);
    return [];
  }
}

async function fetchLotSuites(branch, zone, materialType, priceRange) {
  try {
    const res = await fetch(`/api/lots/suites?${buildArrayQuery({ branch, zone, materialType, priceRange })}`);
    if (!res.ok) return { suites: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotSuites failed:', e);
    return { suites: [], statuses: [] };
  }
}

async function fetchLotSections(branch, zone, suiteNo, materialType, priceRange) {
  try {
    const res = await fetch(`/api/lots/sections?${buildArrayQuery({ branch, zone, suiteNo, materialType, priceRange })}`);
    if (!res.ok) return { sections: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotSections failed:', e);
    return { sections: [], statuses: [] };
  }
}

async function fetchLotLevels(branch, zone, suiteNo, section, materialType, priceRange) {
  try {
    const res = await fetch(`/api/lots/levels?${buildArrayQuery({ branch, zone, suiteNo, section, materialType, priceRange })}`);
    if (!res.ok) return { levels: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotLevels failed:', e);
    return { levels: [], statuses: [] };
  }
}

async function fetchLotTypes(branch, zone, materialType, priceRange) {
  try {
    const res = await fetch(`/api/lots/lotTypes?${buildArrayQuery({ branch, zone, materialType, priceRange })}`);
    if (!res.ok) return { lotTypes: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotTypes failed:', e);
    return { lotTypes: [], statuses: [] };
  }
}

// ── Filter registry + cascade orchestration ──
// Every downstream level's options are re-derived from whatever the upstream levels currently
// have selected (which may be empty == "All"), rather than being hard-gated on a non-empty
// parent pick. That's what lets, e.g., Suite No legitimately show "no suite data" while Section
// still resolves normally — there's no separate bypass path to maintain.
const lotFilters = {};

async function refreshLotLocationFields() {
  const materialType = lotFilters.materialType.getValues();
  const mode = modeForSelection(materialType);
  if (!mode) return;

  const branch = lotFilters.branch.getValues();
  const zone = lotFilters.zone.getValues();
  const priceRange = lotFilters.priceRange.getValues();

  if (mode === 'structured') {
    const { suites, statuses: suiteStatuses } = await fetchLotSuites(branch, zone, materialType, priceRange);
    lotFilters.suiteNo.setOptions(suites);

    const suiteNo = lotFilters.suiteNo.getValues();
    const { sections, statuses: sectionStatuses } = await fetchLotSections(branch, zone, suiteNo, materialType, priceRange);
    lotFilters.section.setOptions(sections);

    const section = lotFilters.section.getValues();
    const { levels, statuses: levelStatuses } = await fetchLotLevels(branch, zone, suiteNo, section, materialType, priceRange);
    lotFilters.level.setOptions(levels);

    lotFilters.status.setOptions(levelStatuses.length ? levelStatuses : (sectionStatuses.length ? sectionStatuses : suiteStatuses));
  } else {
    const { lotTypes, statuses } = await fetchLotTypes(branch, zone, materialType, priceRange);
    lotFilters.lotType.setOptions(lotTypes);
    lotFilters.status.setOptions(statuses);
  }
}

// Re-fetches Zone (a sibling of Price Range in the cascade — both scoped by branch + material
// type only) and everything below it. Shared by refreshLotCascade (branch/product type change)
// and Price Range's own onChange, so a Price Range change alone still narrows Zone downward.
async function refreshLotZoneAndBelow() {
  const branch = lotFilters.branch.getValues();
  const materialType = lotFilters.materialType.getValues();
  const mode = modeForSelection(materialType);
  if (!mode) return;

  const priceRange = lotFilters.priceRange.getValues();
  const zones = await fetchLotZones(branch, materialType, priceRange);
  lotFilters.zone.setOptions(zones);

  await refreshLotLocationFields();
}

async function refreshLotCascade() {
  const branch = lotFilters.branch.getValues();

  // Product Type is scoped to the selected Branch(es) — re-narrow it (and drop any
  // selected type that's no longer valid for this branch) before deriving mode from it.
  const { materialTypes } = await fetchLotFilters(branch);
  lotFilters.materialType.setOptions(materialTypes);

  const materialType = lotFilters.materialType.getValues();
  const mode = modeForSelection(materialType);
  applyLotModeUI(mode);

  const gated = [lotFilters.priceRange, lotFilters.zone, lotFilters.suiteNo, lotFilters.section, lotFilters.level, lotFilters.lotType, lotFilters.status];

  if (!mode) {
    gated.forEach(f => { f.setOptions([]); f.setDisabled(true, 'Select product type first'); });
    const matrixCard = document.getElementById('lotMatrixCard');
    if (matrixCard) matrixCard.style.display = 'none';
    return;
  }
  gated.forEach(f => f.setDisabled(false));

  // Price Range is scoped by branch + material type only (a sibling of Zone, same
  // dependency depth) — re-narrow it before deriving Zone and everything below.
  const { priceRanges } = await fetchLotFilters(branch, materialType);
  lotFilters.priceRange.setOptions(priceRanges);

  await refreshLotZoneAndBelow();
}

// Populates the "Branch Deep Dive" report dropdown (public/index.html #branchSelect).
function populateBranchReportSelect(branches) {
  const select = document.getElementById('branchSelect');
  if (!select) return;
  select.querySelectorAll('option[value]:not([value=""])').forEach(opt => opt.remove());
  for (const b of branches) {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    select.appendChild(opt);
  }
}

function initLotFilters() {
  renderLotsTableHead('structured');

  lotFilters.branch = new MultiSelect('lotBranch', {
    placeholder: 'All branches',
    onChange: refreshLotCascade,
  });

  lotFilters.materialType = new MultiSelect('lotMaterialType', {
    placeholder: 'Select product type',
    displayFn: stripNVPrefix,
    onChange: refreshLotCascade,
  });

  const disabledGateText = 'Select product type first';

  lotFilters.priceRange = new MultiSelect('lotPriceRange', {
    placeholder: 'All price ranges',
    disabledText: disabledGateText,
    emptyText: 'No price ranges found',
    onChange: refreshLotZoneAndBelow,
  });
  lotFilters.priceRange.setDisabled(true);

  lotFilters.zone = new MultiSelect('lotZone', {
    placeholder: 'All zones',
    disabledText: disabledGateText,
    emptyText: 'No zones found',
    onChange: refreshLotLocationFields,
  });
  lotFilters.zone.setDisabled(true);

  lotFilters.suiteNo = new MultiSelect('lotSuite', {
    placeholder: 'All suites',
    disabledText: disabledGateText,
    emptyText: 'No suite data',
    onChange: refreshLotLocationFields,
  });
  lotFilters.suiteNo.setDisabled(true);

  lotFilters.section = new MultiSelect('lotSection', {
    placeholder: 'All sections',
    disabledText: disabledGateText,
    emptyText: 'No sections found',
    onChange: refreshLotLocationFields,
  });
  lotFilters.section.setDisabled(true);

  lotFilters.level = new MultiSelect('lotLevel', {
    placeholder: 'All levels',
    disabledText: disabledGateText,
    emptyText: 'No levels found',
  });
  lotFilters.level.setDisabled(true);

  lotFilters.lotType = new MultiSelect('lotType', {
    placeholder: 'All lot types',
    disabledText: disabledGateText,
    emptyText: 'No lot types found',
  });
  lotFilters.lotType.setDisabled(true);

  lotFilters.status = new MultiSelect('lotStatus', {
    placeholder: 'All statuses',
    disabledText: disabledGateText,
    emptyText: 'No statuses found',
  });
  lotFilters.status.setDisabled(true);

  applyLotModeUI(null);

  fetchLotFilters().then(({ materialTypes, branches }) => {
    lotFilters.materialType.setOptions(materialTypes);
    lotFilters.branch.setOptions(branches);
    populateBranchReportSelect(branches);
  });
}

// Delegated so re-rendering the header row's innerHTML on every sort/search doesn't lose the listener.
document.getElementById('lotsHeadRow')?.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  onLotSortClick(th.dataset.key);
});

// Instant client-side re-render from cached matrix data — no re-query.
function rerenderCachedMatrix() {
  renderLotMatrix(lastMatrixRows, lastMatrixCtx, lastMatrixMode);
}
document.getElementById('matrixShowAmount')?.addEventListener('change', rerenderCachedMatrix);
document.getElementById('matrixShowPercentage')?.addEventListener('change', rerenderCachedMatrix);

// Delegated (survives matrixHeadRow's innerHTML being rebuilt on every render).
document.getElementById('matrixHeadRow')?.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-matrix-key]');
  if (!th) return;
  const key = th.dataset.matrixKey;
  matrixSortState = matrixSortState.key === key
    ? { key, dir: matrixSortState.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };
  rerenderCachedMatrix();
});

initLotFilters();
initLotResultsEvents();

window.renderLotDrillDown = renderLotDrillDown;
window.exportLotsCSV = exportLotsCSV;
window.exportMatrixExcel = exportMatrixExcel;
window.exportMatrixPDF = exportMatrixPDF;

// ── Pricing Intelligence ──
const PRICING_CATEGORY_META = {
  sweet_spot:         { label: 'Sweet Spot',         color: C.green },
  low_hanging_fruit:  { label: 'Low-Hanging Fruit',  color: C.blue },
  long_ignored_gem:   { label: 'Long-Ignored Gem',   color: C.amber },
  dead_stock:         { label: 'Dead Stock',         color: C.red },
  normal:             { label: 'Normal',             color: C.muted },
};

const PRICING_TABLE_COLUMNS = [
  { key: 'productType',  label: 'Product',        type: 'text',   render: r => stripNVPrefix(r.productType) },
  { key: 'branch',       label: 'Branch',         type: 'text' },
  { key: 'priceRange',   label: 'Price Range',    type: 'text' },
  { key: 'avgPrice',     label: 'Avg Price',      type: 'number', render: r => myr(r.avgPrice) },
  { key: 'sellThrough',  label: 'Sell-through %', type: 'number', render: r => pct(r.sellThrough) },
  { key: 'balanceValue', label: 'Balance Value',  type: 'number', render: r => myr(r.balanceValue) },
];

function daysAndYears(days) {
  return `${fmt(days)} days (${(days / 365).toFixed(1)} years)`;
}

const AGED_INVENTORY_COLUMNS = [
  { key: 'productType',          label: 'Product Type',           type: 'text',   render: r => stripNVPrefix(r.productType) },
  { key: 'priceRange',           label: 'Price Range',            type: 'text' },
  { key: 'avgAgeDays',           label: 'Avg Age',                type: 'number', render: r => daysAndYears(r.avgAgeDays) },
  { key: 'countOver365',         label: 'Count > 365 Days',       type: 'number', render: r => fmt(r.countOver365) },
  { key: 'oldestAgeDays',        label: 'Oldest Lot Age',         type: 'number', render: r => daysAndYears(r.oldestAgeDays) },
  { key: 'balanceValueOver365',  label: 'Balance Value > 365d',   type: 'number', render: r => myr(r.balanceValueOver365) },
];

// ── Overview: Product Type Summary + per-Branch unsold breakdown ──
const PRODUCT_SUMMARY_COLUMNS = [
  { key: 'productType', label: 'Product Type',   type: 'text',   render: r => stripNVPrefix(r.productType) },
  { key: 'totalStock',  label: 'Total Quantity',  type: 'number', render: r => fmt(r.totalStock) },
  { key: 'avgPrice',    label: 'Avg Price',       type: 'number', render: r => myr(r.avgPrice) },
  { key: 'lotCount',    label: 'Lot Count',       type: 'number', render: r => fmt(r.lotCount) },
];

const PRODUCT_BREAKDOWN_COLUMNS = [
  { key: 'branch',              label: 'Branch' },
  { key: 'unsoldUnits',         label: 'Unsold Units',         render: r => fmt(r.unsoldUnits) },
  { key: 'unsoldBalanceValue',  label: 'Unsold Balance Value', render: r => myr(r.unsoldBalanceValue) },
  { key: 'sellThrough',         label: 'Sell-through %',       render: r => pct(r.sellThrough) },
];

// Zone Breakdown (Aged Inventory + the 4 category tables) shares the exact same shape as the
// Overview's Branch breakdown, just grouped by Zone instead of Branch. The 4 category tables
// omit Branch as a column — their own row filter already pins one Branch, so every row here
// would repeat the same value. Aged Inventory rows can span several branches, so it gets
// Branch back as a leading column (see AGED_ZONE_BREAKDOWN_COLUMNS below).
const ZONE_BREAKDOWN_COLUMNS = [
  { key: 'zone',                label: 'Zone' },
  { key: 'unsoldUnits',         label: 'Unsold Units',         render: r => fmt(r.unsoldUnits) },
  { key: 'unsoldBalanceValue',  label: 'Unsold Balance Value', render: r => myr(r.unsoldBalanceValue) },
  { key: 'sellThrough',         label: 'Sell-through %',       render: r => pct(r.sellThrough) },
];
const AGED_ZONE_BREAKDOWN_COLUMNS = [
  { key: 'branch', label: 'Branch' },
  ...ZONE_BREAKDOWN_COLUMNS,
];

// ── Pricing drill-down (Lot Drill-Down reuse) ──
// Compact lot columns shown in the expandable drill-down panels/accordions. "Suite"/"Section"
// are only meaningful for structured product types (Niche/Pedestal/etc.) — flat land types
// (Burial Plot/Seed/etc.) have no such hierarchy, so they get their own, shorter column set.
// Branch and Lot Type are the two grouping levels the drill-down table nests lots under
// (see sortAndGroupDrillRows), so they're rendered as group-header rows rather than repeated
// as a column on every lot row.
const DRILLDOWN_LOT_COLUMNS_STRUCTURED = [
  { key: 'materialNo',          label: 'Material No' },
  { key: 'zone',                label: 'Zone' },
  { key: 'suiteNo',             label: 'Suite' },
  { key: 'section',             label: 'Section' },
  { key: 'level',                label: 'Level' },
  { key: 'status',               label: 'Status', render: r => `<span class="badge ${lotStatusBadgeClass(r.status)}">${r.status}</span>` },
  { key: 'totalBalanceAmount',  label: 'Balance Amount', render: r => myr(r.totalBalanceAmount) },
];
const DRILLDOWN_LOT_COLUMNS_FLAT = [
  { key: 'materialNo',          label: 'Material No' },
  { key: 'status',               label: 'Status', render: r => `<span class="badge ${lotStatusBadgeClass(r.status)}">${r.status}</span>` },
  { key: 'totalBalanceAmount',  label: 'Balance Amount', render: r => myr(r.totalBalanceAmount) },
];

// Fetches the same aggregated lot rows the Lot Drill-Down tab uses (/api/lots), with
// `detail: true` for the finer Suite/Section grain the pricing drill-downs display.
async function fetchLotsDetail(filters) {
  const res = await fetch('/api/lots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...filters, detail: true, bigLotFilter: window.bigLotFilter }),
  });
  if (res.status === 401 || res.redirected || res.url.includes('/login')) {
    throw new Error('SESSION_EXPIRED');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || 'Failed to load lots');
  }
  return res.json();
}

// ── Drill-down lot list: Branch → Lot Type grouping, pagination, Excel export ──
// Every "View Lots" panel (quadrant click, the 4 category tables, Aged Inventory) renders
// through this shared machinery so they behave identically: sorted Branch asc → Lot Type asc
// → Material No asc, with a sub-header row inserted before each Lot Type's lots.
const DRILL_PAGE_SIZES = [10, 25, 50];

function computeDrillTotalQty(rows) {
  return rows.reduce((s, r) => s + (Number(r.totalStock) || 0), 0);
}

// Sorts rows into Branch → Lot Type order, then buckets them into nested Maps (which
// preserve first-insertion order, so the bucketing walk below yields the same order the
// initial sort produced — no separate sort-of-groups step needed).
function sortAndGroupDrillRows(rows) {
  const sorted = [...rows].sort((a, b) =>
    naturalCompare(a.branch, b.branch) ||
    naturalCompare(a.lotType, b.lotType) ||
    naturalCompare(a.materialNo, b.materialNo));

  const branchMap = new Map();
  for (const r of sorted) {
    if (!branchMap.has(r.branch)) branchMap.set(r.branch, new Map());
    const lotTypeMap = branchMap.get(r.branch);
    if (!lotTypeMap.has(r.lotType)) lotTypeMap.set(r.lotType, []);
    lotTypeMap.get(r.lotType).push(r);
  }

  const seq = [];
  for (const [branch, lotTypeMap] of branchMap) {
    let branchCount = 0;
    for (const lotRows of lotTypeMap.values()) branchCount += lotRows.length;
    seq.push({ type: 'branch', branch, count: branchCount });
    for (const [lotType, lotRows] of lotTypeMap) {
      seq.push({ type: 'lotType', lotType, count: lotRows.length });
      for (const row of lotRows) seq.push({ type: 'row', row });
    }
  }
  return seq;
}

// Keeps every group header needed to introduce the lot rows it lets through, and stops
// scanning entirely once `pageSize` lot rows have been emitted (no headers dangle with
// zero rows under them).
function paginateDrillSeq(seq, pageSize) {
  if (pageSize === 'all') return seq;
  const out = [];
  let shown = 0;
  for (const item of seq) {
    out.push(item);
    if (item.type === 'row') {
      shown++;
      if (shown >= pageSize) break;
    }
  }
  return out;
}

function renderDrillGroupedTableHTML(seq, columns) {
  if (!seq.length) return `<div class="drilldown-empty">No OPEN lots match these filters.</div>`;
  const colCount = columns.length;
  const body = seq.map(item => {
    if (item.type === 'branch') {
      return `<tr class="drill-group-row drill-group-branch"><td colspan="${colCount}">Branch: ${escapeHtml(item.branch)} <span class="drill-group-count">(${item.count} lot${item.count === 1 ? '' : 's'})</span></td></tr>`;
    }
    if (item.type === 'lotType') {
      return `<tr class="drill-group-row drill-group-lottype"><td colspan="${colCount}">Lot Type: ${escapeHtml(item.lotType)} <span class="drill-group-count">(${item.count})</span></td></tr>`;
    }
    const r = item.row;
    return `<tr>${columns.map(c => `<td>${c.render ? c.render(r) : (r[c.key] ?? '')}</td>`).join('')}</tr>`;
  }).join('');
  return `<table class="drilldown-table"><thead><tr>${
    columns.map(c => `<th>${c.label}</th>`).join('')
  }</tr></thead><tbody>${body}</tbody></table>`;
}

// Per-panel state (rows, mode, current page size) keyed by a synthetic id stamped onto the
// panel's content element — several accordions can be expanded at once, each with its own
// page size, so this can't live in a single shared variable.
const drillDownState = new Map();
let drillDownIdSeq = 0;

function renderDrillDownPanel(content, { rows, mode, titleLine, filenameBase }) {
  if (!content.dataset.drillId) content.dataset.drillId = `drill${++drillDownIdSeq}`;
  drillDownState.set(content.dataset.drillId, { rows, mode, pageSize: 10, titleLine, filenameBase });
  renderDrillDownFromState(content);
}

function renderDrillDownFromState(content) {
  const state = drillDownState.get(content.dataset.drillId);
  if (!state) return;
  const { rows, mode, pageSize, titleLine } = state;
  const columns = mode === 'flat' ? DRILLDOWN_LOT_COLUMNS_FLAT : DRILLDOWN_LOT_COLUMNS_STRUCTURED;
  const titleHtml = titleLine ? `<div class="drilldown-title-line">${titleLine}</div>` : '';

  if (!rows.length) {
    content.innerHTML = `${titleHtml}<div class="drilldown-empty">No OPEN lots match these filters.</div>`;
    return;
  }

  const seq = sortAndGroupDrillRows(rows);
  const visible = paginateDrillSeq(seq, pageSize);
  const shownLots = pageSize === 'all' ? rows.length : Math.min(pageSize, rows.length);

  const toolbar = `
    <div class="drilldown-toolbar">
      <div class="drilldown-toolbar-count">Showing ${fmt(shownLots)} of ${fmt(rows.length)} lots</div>
      <div class="drilldown-toolbar-actions">
        <div class="drill-page-size">
          ${DRILL_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${pageSize === n ? ' active' : ''}" data-drill-page="${n}">${n}</button>`).join('')}
          <button type="button" class="drill-page-btn${pageSize === 'all' ? ' active' : ''}" data-drill-page="all">Show All</button>
        </div>
        <button type="button" class="btn-view-lots" data-drill-export>Export to Excel</button>
      </div>
    </div>`;

  content.innerHTML = `${titleHtml}${toolbar}${renderDrillGroupedTableHTML(visible, columns)}`;
}

function exportDrillDownExcel(content) {
  const state = drillDownState.get(content.dataset.drillId);
  if (!state || !state.rows.length) { alert('No data to export.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const columns = state.mode === 'flat' ? DRILLDOWN_LOT_COLUMNS_FLAT : DRILLDOWN_LOT_COLUMNS_STRUCTURED;
  // Export the full matching set (not just whatever page is on screen), in the same
  // Branch asc / Lot Type asc / Material No asc order the panel groups and sorts by —
  // Branch/Lot Type become plain columns here since a flat sheet has no group-header rows.
  const rows = sortAndGroupDrillRows(state.rows).filter(i => i.type === 'row').map(i => i.row);

  const header = ['Branch', 'Lot Type', ...columns.map(c => c.label)];
  const aoa = [header, ...rows.map(r => [r.branch, r.lotType, ...columns.map(c => r[c.key] ?? '')])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  const balCol = 2 + columns.findIndex(c => c.key === 'totalBalanceAmount');
  if (balCol >= 2) {
    for (let ri = 1; ri < aoa.length; ri++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: balCol });
      if (ws[ref]) ws[ref].z = '"RM "#,##0';
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lots');
  const base = state.filenameBase || 'drilldown_lots';
  XLSX.writeFile(wb, `${base}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Pagination + export are 100% generic (keyed off drillDownState via the clicked element's
// nearest [data-drill-content] ancestor) — shared by every tab's delegated click listener
// (Pricing's Zone Breakdown / Product Branch Breakdown View Lots, Lot Drill-Down's Lot
// Results View Lots). Returns true if it handled the click, so callers can `if (...) return;`.
function handleDrillDownPaginationOrExport(e) {
  const pageBtn = e.target.closest('button[data-drill-page]');
  if (pageBtn) {
    const content = pageBtn.closest('[data-drill-content]');
    const state = content && drillDownState.get(content.dataset.drillId);
    if (state) {
      const raw = pageBtn.dataset.drillPage;
      state.pageSize = raw === 'all' ? 'all' : Number(raw);
      renderDrillDownFromState(content);
    }
    return true;
  }

  const exportBtn = e.target.closest('button[data-drill-export]');
  if (exportBtn) {
    const content = exportBtn.closest('[data-drill-content]');
    if (content) exportDrillDownExcel(content);
    return true;
  }

  return false;
}

// Generic column-based sorter shared by the category tables and the aged-inventory table.
function sortByKey(rows, sortState) {
  if (!sortState.key) return rows;
  const { key, dir } = sortState;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : naturalCompare(av, bv);
    return cmp * sign;
  });
}

async function fetchPricingJSON(path, body) {
  const res = await fetch(`/api/pricing/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(body || {}), bigLotFilter: window.bigLotFilter }),
  });
  if (res.status === 401 || res.redirected || res.url.includes('/login')) {
    throw new Error('SESSION_EXPIRED');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

let lastPricingQuadrant = [];
let lastPricingAged = [];
let lastPricingByProduct = [];
let pricingFilters = { branch: [], productType: [] };
let pricingLoaded = false;
let productSummarySortState = { key: 'productType', dir: 'asc' };

// Every Pricing Intelligence table defaults to ascending sort by its first meaningful
// column, applied before first render (not just wired to header clicks) — Branch for the
// 4 category tables (matches the View Lots drill-down's own Branch-asc convention), Product
// Type for Aged Inventory. Previously Long-Ignored Gem / Dead Stock / Aged Inventory
// defaulted to a value-descending sort instead — flipped here for consistency across every
// table in the tab.
const pricingCategorySortState = {
  sweet_spot:        { key: 'branch', dir: 'asc' },
  low_hanging_fruit: { key: 'branch', dir: 'asc' },
  long_ignored_gem:  { key: 'branch', dir: 'asc' },
  dead_stock:        { key: 'branch', dir: 'asc' },
};
let agedSortState = { key: 'productType', dir: 'asc' };

const pricingFiltersUI = {};
// Price Range selects for the Overview/Summary KPIs (#1) and Product Type Summary (#2) —
// each independently scopes its own section, both re-narrowed by Branch/Product Type the
// same way Product Type is scoped by Branch, but neither participates in updatePricingGateState.
let pricingOverviewPriceRangeUI = null;
let pricingProductPriceRangeUI = null;

async function refreshPricingCascade() {
  const branch = pricingFiltersUI.branch.getValues();
  try {
    const { productTypes } = await fetchPricingJSON('filters', { branch });
    pricingFiltersUI.productType.setOptions(productTypes || []);
  } catch (e) {
    console.error('[dashboard] refreshPricingCascade failed:', e);
  }
  updatePricingGateState();
  await refreshPricingPriceRangeOptions();
}

// Re-narrows both Price Range selects to whatever's valid for the current Branch + Product
// Type selection — called whenever either of those changes.
async function refreshPricingPriceRangeOptions() {
  const branch = pricingFiltersUI.branch.getValues();
  const productType = pricingFiltersUI.productType.getValues();
  try {
    const { priceRanges } = await fetchPricingJSON('filters', { branch, productType });
    pricingOverviewPriceRangeUI.setOptions(priceRanges || []);
    pricingProductPriceRangeUI.setOptions(priceRanges || []);
  } catch (e) {
    console.error('[dashboard] refreshPricingPriceRangeOptions failed:', e);
  }
}

// Branch + Product Type are required prerequisites for Min Stock + Search (which drive the
// Quadrant Chart, Category Breakdown tables, and Aged Inventory). The Cross-Analysis Pivot
// Builder deliberately has its own separate, non-gated Branch/Product Type filters — see
// pivotFiltersUI — so it is NOT included here.
function updatePricingGateState() {
  const branch = pricingFiltersUI.branch?.getValues() || [];
  const productType = pricingFiltersUI.productType?.getValues() || [];
  const ready = branch.length > 0 && productType.length > 0;

  ['pricingMinStock', 'btnPricingSearch'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !ready;
  });
  document.querySelectorAll('.pricing-gate-message').forEach(el => { el.style.display = ready ? 'none' : ''; });

  return ready;
}

// Resolves once Branch/Product Type have loaded and defaulted to "All" selected — awaited by
// onPricingTabActivated so the first auto-render doesn't race the initial options fetch.
let pricingFiltersReady = null;

function initPricingFilters() {
  pricingFiltersUI.branch = new MultiSelect('pricingBranch', {
    placeholder: 'Select branch(es)',
    onChange: refreshPricingCascade,
  });
  pricingFiltersUI.productType = new MultiSelect('pricingProductType', {
    placeholder: 'Select product type(s)',
    displayFn: stripNVPrefix,
    onChange: () => { updatePricingGateState(); refreshPricingPriceRangeOptions(); },
  });

  // Empty selection == "All" (no filter) — unlike Branch/Product Type above, Price Range
  // isn't a required gate, so it follows the same empty-means-All convention used everywhere
  // else in the app rather than defaulting to every value checked.
  pricingOverviewPriceRangeUI = new MultiSelect('pricingOverviewPriceRange', {
    placeholder: 'All price ranges',
    onChange: refreshPricingOverviewSection,
  });
  pricingProductPriceRangeUI = new MultiSelect('pricingProductPriceRange', {
    placeholder: 'All price ranges',
    onChange: refreshPricingProductSummarySection,
  });

  // Default both to every value selected (not empty) so the tab is immediately useful on
  // open — the prerequisite gate below is satisfied out of the box. setOptions({selectAll})
  // sets state directly rather than going through selectAll()'s onChange, avoiding a redundant
  // cascade re-fetch while both filters are still being populated. Select All / Clear All stay
  // available afterward for narrowing down manually.
  pricingFiltersReady = fetchPricingJSON('filters', {}).then(({ branches, productTypes, priceRanges }) => {
    pricingFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    pricingFiltersUI.productType.setOptions(productTypes || [], { selectAll: true });
    pricingOverviewPriceRangeUI.setOptions(priceRanges || []);
    pricingProductPriceRangeUI.setOptions(priceRanges || []);
  }).catch(e => console.error('[dashboard] initPricingFilters failed:', e));

  updatePricingGateState();
}

function renderPricingOverviewKPIs(overview, quadrantRows) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('kpi-pricingAvgPrice', myr(overview.overall?.avgPrice || 0));

  const dist = overview.priceRangeDistribution || [];
  const totalStock = dist.reduce((s, r) => s + r.stock, 0);
  const totalSold = dist.reduce((s, r) => s + r.sold, 0);
  const totalBalanceValue = dist.reduce((s, r) => s + r.balanceValue, 0);
  set('kpi-pricingSellThrough', pct(totalStock > 0 ? (100 * totalSold) / totalStock : 0));
  set('kpi-pricingBalanceValue', myr(totalBalanceValue));

  const counts = { sweet_spot: 0, low_hanging_fruit: 0, long_ignored_gem: 0, dead_stock: 0 };
  quadrantRows.forEach(r => { if (counts[r.category] !== undefined) counts[r.category]++; });
  set('kpi-pricingSweetSpot', fmt(counts.sweet_spot));
  set('kpi-pricingGems', fmt(counts.long_ignored_gem));
  set('kpi-pricingDeadStock', fmt(counts.dead_stock));
}

// Overview/Summary section (#1) — independent of Product Type Summary's (#2) own Price Range
// filter below, and not gated on Branch/Product Type: both default to "All" already, so this
// is always loadable. Recomputes the category counts via its own Quadrant fetch (scoped by
// this section's Price Range) rather than reusing lastPricingQuadrant, which stays driven by
// the shared Branch/Product Type/Min Stock filter for the Quadrant Chart + Category tables.
async function refreshPricingOverviewSection() {
  const branch = pricingFiltersUI.branch.getValues();
  const productType = pricingFiltersUI.productType.getValues();
  const priceRange = pricingOverviewPriceRangeUI.getValues();
  const minStockInput = document.getElementById('pricingMinStock');
  const minStock = Math.max(0, parseInt(minStockInput?.value, 10) || 100);
  try {
    const [overview, quadrantRes] = await Promise.all([
      fetchPricingJSON('overview', { branch, productType, priceRange }),
      fetchPricingJSON('quadrant', { branch, productType, minStock, priceRange }),
    ]);
    renderPricingOverviewKPIs(overview, quadrantRes.rows || []);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] refreshPricingOverviewSection failed:', err);
  }
}

// Product Type Summary section (#2) — its own independent Price Range filter, scoping both
// the top-level per-product totals here and the "+" branch breakdown (see
// toggleProductBranchBreakdown, which reads pricingProductPriceRangeUI directly).
async function refreshPricingProductSummarySection() {
  const branch = pricingFiltersUI.branch.getValues();
  const productType = pricingFiltersUI.productType.getValues();
  const priceRange = pricingProductPriceRangeUI.getValues();
  const tbody = document.querySelector('#pricingProductSummary tbody');
  if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const overview = await fetchPricingJSON('overview', { branch, productType, priceRange });
    lastPricingByProduct = overview.byProduct || [];
    renderPricingProductSummaryTable(lastPricingByProduct);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] refreshPricingProductSummarySection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

function renderPricingProductSummaryTable(rows) {
  const headRow = document.getElementById('pricingProductSummaryHead');
  const tbody = document.querySelector('#pricingProductSummary tbody');
  if (!headRow || !tbody) return;

  const colCount = PRODUCT_SUMMARY_COLUMNS.length + 1;
  headRow.innerHTML = PRODUCT_SUMMARY_COLUMNS.map(col => {
    const isSorted = productSummarySortState.key === col.key;
    const arrow = isSorted ? `<span class="sort-arrow">${productSummarySortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th${isSorted ? ' sorted' : ''}" data-product-summary-key="${col.key}">${col.label}${arrow}</th>`;
  }).join('') + '<th></th>';

  const sorted = sortByKey(rows, productSummarySortState);
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No data.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(r => {
    const cells = PRODUCT_SUMMARY_COLUMNS.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('');
    const btn = `<button type="button" class="btn-expand" data-action="toggle-product-breakdown"
      data-product="${escapeHtml(r.productType)}" aria-label="Expand branch breakdown">+</button>`;
    return `<tr class="accordion-row">${cells}<td>${btn}</td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-branch-breakdown-content></div></td></tr>`;
  }).join('');
}

// Third level of depth under Product Type Summary: "+" → Branch Breakdown → View Lots per
// branch row → Lot Type filter → actual lots. Mirrors renderZoneBreakdownTableHTML's
// accordion-row + nested accordion-detail structure exactly. Branch is a real single value
// per row (grouped by Branch — see getProductBranchBreakdown), so it's baked into the row's
// data attributes same as Zone Breakdown does; Price Range is NOT pinned per row (the whole
// breakdown is already scoped by the Product Type Summary's own pricingProductPriceRangeUI
// filter, which can hold 0+ values), so it's read live at fetch time instead — see
// loadProductBranchLotsContent — rather than baked into a single-value data attribute.
function renderProductBranchBreakdownHTML(rows, product) {
  if (!rows.length) return `<div class="drilldown-empty">No unsold (OPEN) lots for this product.</div>`;
  const sorted = [...rows].sort((a, b) => b.unsoldUnits - a.unsoldUnits);
  const colCount = PRODUCT_BREAKDOWN_COLUMNS.length + 1;
  const head = PRODUCT_BREAKDOWN_COLUMNS.map(c => `<th>${c.label}</th>`).join('') + '<th></th>';
  const body = sorted.map(r => {
    const cells = PRODUCT_BREAKDOWN_COLUMNS.map(c => `<td>${c.render ? c.render(r) : (r[c.key] ?? '')}</td>`).join('');
    const lotTypeFilter = renderLotTypeFilterHTML({ product, branch: r.branch, priceRange: '' });
    const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-productbranch-lots"
      data-product="${escapeHtml(product)}" data-branch="${escapeHtml(r.branch)}">View Lots</button>`;
    return `<tr class="accordion-row">${cells}<td><div class="row-actions">${lotTypeFilter}${viewLotsBtn}</div></td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>`;
  }).join('');
  return `<table class="drilldown-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function toggleProductBranchBreakdown(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = '+'; btn.setAttribute('aria-label', 'Expand branch breakdown'); return; }

  detailRow.style.display = '';
  btn.textContent = '−';
  btn.setAttribute('aria-label', 'Collapse branch breakdown');
  const content = detailRow.querySelector('[data-branch-breakdown-content]');
  if (content.dataset.loaded === 'true') return;
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const { rows } = await fetchPricingJSON('product-branch-breakdown', { productType: [btn.dataset.product], priceRange: pricingProductPriceRangeUI.getValues() });
    content.innerHTML = renderProductBranchBreakdownHTML(rows || [], btn.dataset.product);
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] toggleProductBranchBreakdown failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

// ── Branch-scoped View Lots (nested inside Product Branch Breakdown) ──
// Same OPEN-only convention as Zone Breakdown's loadZoneLotsDrillDownContent (this whole
// breakdown is inherently about unsold stock) — the one difference is Price Range, read live
// from pricingProductPriceRangeUI rather than a per-row data attribute (see comment above
// renderProductBranchBreakdownHTML).
async function loadProductBranchLotsContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const lotType = lotTypeFilterValues(btn.closest('tr'));
    const filters = {
      materialType: [btn.dataset.product],
      branch: [btn.dataset.branch],
      priceRange: pricingProductPriceRangeUI.getValues(),
      status: ['OPEN'],
      lotType,
    };
    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.product))} (${fmt(totalQty)} units) · ${escapeHtml(btn.dataset.branch)} — Branch Breakdown — Unsold Lots`,
      filenameBase: `pricing_lots_branchbreakdown_${sanitizeForFilename(btn.dataset.product)}_${sanitizeForFilename(btn.dataset.branch)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] loadProductBranchLotsContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

async function toggleProductBranchLots(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = 'View Lots'; return; }

  detailRow.style.display = '';
  btn.textContent = 'Hide Lots';
  const content = detailRow.querySelector('[data-drill-content]');
  if (content.dataset.loaded === 'true') return;
  await loadProductBranchLotsContent(btn, content);
}

// Resolves which View Lots button + loader a given [data-lot-type-filter]'s row uses — #tab-pricing
// now has two: Zone Breakdown rows (toggle-zone-lots) and Product Branch Breakdown rows
// (toggle-productbranch-lots) — so the shared checkbox/select-all/clear-all handlers below
// can't assume just one.
function pricingLotTypeFilterOptionsFor(row) {
  if (row?.querySelector('button[data-action="toggle-productbranch-lots"]')) {
    return { buttonSelector: 'button[data-action="toggle-productbranch-lots"]', loader: loadProductBranchLotsContent };
  }
  return { buttonSelector: 'button[data-action="toggle-zone-lots"]', loader: loadZoneLotsDrillDownContent };
}

// ── Zone Breakdown (Aged Inventory + all 4 category tables) ──
// Each data row renders a single accordion-detail row (Zone Breakdown) immediately after it —
// View Lots no longer lives at this level, it's nested inside each zone row below (see
// renderZoneBreakdownTableHTML), so the toggle always targets the very next sibling.
async function toggleZoneBreakdown(btn, filters) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = '+'; btn.setAttribute('aria-label', 'Zone breakdown'); return; }

  detailRow.style.display = '';
  btn.textContent = '−';
  btn.setAttribute('aria-label', 'Hide zone breakdown');
  const content = detailRow.querySelector('[data-zone-breakdown-content]');
  if (content.dataset.loaded === 'true') return;
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const { rows } = await fetchPricingJSON('zone-breakdown', filters);
    const ctx = {
      product: btn.dataset.product,
      branch: btn.dataset.branch,      // undefined for Aged Inventory rows (no single Branch)
      priceRange: btn.dataset.priceRange,
      category: btn.dataset.category,  // undefined for Aged Inventory rows
      minAgeDays: filters.minAgeDays,  // set (365) only for Aged Inventory rows
    };
    content.innerHTML = renderZoneBreakdownTableHTML(rows || [], ctx);
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] toggleZoneBreakdown failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

// Zone Breakdown is the middle tier of the hierarchy: "+" expands it, and each zone row within
// gets its own "View Lots" + Lot Type filter, scoped to Product Type + Price Range + that exact
// Branch + Zone — narrower than the pre-restructure row-level View Lots, which combined every
// zone for the combo together. The backend now always returns a real `branch` per row (see
// getZoneBreakdown), even for Aged Inventory's multi-branch rows, so every zone row's own View
// Lots is single-branch-scoped regardless of which table it came from.
// isAged (no single Branch on the parent row) decides two things: which column set to show
// (Aged gets a leading Branch column, the 4 category tables don't — their rows already share
// one Branch, so repeating it would be pure noise) and the default sort — Branch ascending
// first for Aged (since Branch grouping matters most there), unsold-units-descending for the
// category tables (unchanged).
function renderZoneBreakdownTableHTML(rows, ctx) {
  if (!rows.length) return `<div class="drilldown-empty">No unsold (OPEN) lots for this combination.</div>`;
  const isAged = ctx.branch === undefined;
  const columns = isAged ? AGED_ZONE_BREAKDOWN_COLUMNS : ZONE_BREAKDOWN_COLUMNS;
  const sorted = isAged
    ? [...rows].sort((a, b) => naturalCompare(a.branch, b.branch) || b.unsoldUnits - a.unsoldUnits)
    : [...rows].sort((a, b) => b.unsoldUnits - a.unsoldUnits);
  const colCount = columns.length + 1;
  const head = columns.map(c => `<th>${c.label}</th>`).join('') + '<th></th>';
  const body = sorted.map(r => {
    const cells = columns.map(c => `<td>${c.render ? c.render(r) : (r[c.key] ?? '')}</td>`).join('');
    const lotTypeFilter = renderLotTypeFilterHTML({ product: ctx.product, branch: r.branch, priceRange: ctx.priceRange, zone: r.zone });
    const categoryAttr = ctx.category !== undefined ? ` data-category="${escapeHtml(ctx.category)}"` : '';
    const minAgeAttr = ctx.minAgeDays !== undefined ? ` data-min-age-days="${escapeHtml(String(ctx.minAgeDays))}"` : '';
    const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-zone-lots"
      data-product="${escapeHtml(ctx.product)}" data-branch="${escapeHtml(r.branch)}" data-price-range="${escapeHtml(ctx.priceRange)}"
      data-zone="${escapeHtml(r.zone)}"${categoryAttr}${minAgeAttr}>View Lots</button>`;
    return `<tr class="accordion-row">${cells}<td><div class="row-actions">${lotTypeFilter}${viewLotsBtn}</div></td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>`;
  }).join('');
  return `<table class="drilldown-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── Lot Type filter (per zone row, narrows that zone's View Lots list only) ──
// Options are scoped to the row's own Product Type + Price Range + Branch + Zone combination
// (or, for Aged Inventory rows which have no single Branch, the tab's current Branch filter)
// so the dropdown never offers a Lot Type that would return zero results for that row. Fetched
// lazily on first open (not eagerly for every row) and cached per-instance afterward.
function renderLotTypeFilterHTML({ product, branch, priceRange, zone }) {
  const branchAttr = branch !== undefined ? ` data-branch="${escapeHtml(branch)}"` : '';
  const zoneAttr = zone !== undefined ? ` data-zone="${escapeHtml(zone)}"` : '';
  return `<details class="lot-type-filter" data-lot-type-filter
    data-product="${escapeHtml(product)}"${branchAttr} data-price-range="${escapeHtml(priceRange)}"${zoneAttr}>
    <summary>Lot Type: All</summary>
    <div class="lot-type-filter-panel" data-lot-type-panel><div class="ms-empty">Loading…</div></div>
  </details>`;
}

function renderLotTypeOptionsHTML(lotTypes) {
  if (!lotTypes.length) return '<div class="ms-empty">No lot types for this combination</div>';
  const opts = lotTypes.map(lt =>
    `<label class="lot-type-option"><input type="checkbox" value="${escapeHtml(lt)}"> ${escapeHtml(lt)}</label>`).join('');
  return `<div class="ms-actions">
      <button type="button" class="ms-select-all" data-lot-type-select-all>Select All</button>
      <button type="button" class="ms-clear-all" data-lot-type-clear-all>Clear All</button>
    </div>
    <div class="lot-type-options">${opts}</div>`;
}

// fallbackBranch lets a second call site (Lot Drill-Down's Lot Results rows, which have no
// single pinned Branch) supply its own live branch selection instead of Pricing's
// pricingFilters.branch — defaults to the original Pricing-tab behavior when omitted.
async function loadLotTypeOptionsForDetails(details, fallbackBranch = pricingFilters.branch) {
  const panel = details.querySelector('[data-lot-type-panel]');
  if (!panel) return;
  const branch = details.dataset.branch !== undefined ? [details.dataset.branch] : fallbackBranch;
  const zone = details.dataset.zone !== undefined ? [details.dataset.zone] : undefined;
  try {
    const qs = buildArrayQuery({ materialType: [details.dataset.product], priceRange: [details.dataset.priceRange], branch, zone });
    const res = await fetch(`/api/lots/lotTypes?${qs}`);
    if (!res.ok) { panel.innerHTML = '<div class="ms-empty">Failed to load</div>'; return; }
    const { lotTypes } = await res.json();
    panel.innerHTML = renderLotTypeOptionsHTML(lotTypes || []);
  } catch (e) {
    console.error('[dashboard] loadLotTypeOptionsForDetails failed:', e);
    panel.innerHTML = '<div class="ms-empty">Failed to load</div>';
  }
}

function lotTypeFilterValues(rowEl) {
  return [...rowEl.querySelectorAll('[data-lot-type-filter] input:checked')].map(cb => cb.value);
}

function updateLotTypeFilterSummary(details) {
  const summary = details.querySelector('summary');
  if (!summary) return;
  const checked = [...details.querySelectorAll('input:checked')].map(cb => cb.value);
  summary.textContent = checked.length === 0 ? 'Lot Type: All'
    : checked.length <= 2 ? `Lot Type: ${checked.join(', ')}`
    : `Lot Type: ${checked.length} selected`;
}

// Checking/unchecking a Lot Type option invalidates the row's View Lots cache; if the panel
// is currently open it's refetched in place (not closed) so the narrowed list appears live.
// buttonSelector/loader let a second call site (Lot Drill-Down's Lot Results rows) plug in
// its own View Lots button + loader — defaults to the original Zone Breakdown behavior.
function onLotTypeFilterChanged(details, { buttonSelector = 'button[data-action="toggle-zone-lots"]', loader = loadZoneLotsDrillDownContent } = {}) {
  updateLotTypeFilterSummary(details);
  const row = details.closest('tr');
  const detailRow = row?.nextElementSibling;
  const content = detailRow?.querySelector('[data-drill-content]');
  if (!content) return;
  content.dataset.loaded = 'false';
  if (detailRow.style.display === 'none') return;
  const viewLotsBtn = row.querySelector(buttonSelector);
  if (!viewLotsBtn) return;
  loader(viewLotsBtn, content);
}

function renderPricingQuadrantChart(rows) {
  destroyChart('pricingQuadrant');
  const ctx = document.getElementById('chartPricingQuadrant');
  if (!ctx) return;

  const maxBalance = Math.max(1, ...rows.map(r => r.balanceValue));
  // Area (not radius) scales with balance value, so bubble size reads as "value at stake"
  // without visually exaggerating the difference between combos.
  const radiusFor = v => 4 + Math.sqrt(Math.max(v, 0) / maxBalance) * 18;
  const totalBalanceShown = sumFinite(rows.map(r => r.balanceValue));

  const byCategory = {};
  for (const r of rows) (byCategory[r.category] ||= []).push(r);

  const datasets = Object.entries(PRICING_CATEGORY_META).map(([key, meta]) => {
    const catRows = byCategory[key] || [];
    return {
      label: meta.label,
      data: catRows.map(r => ({ x: r.avgPrice, y: r.sellThrough, r: radiusFor(r.balanceValue), _row: r })),
      backgroundColor: meta.color + 'B3',
      borderColor: meta.color,
      borderWidth: 1.5,
    };
  }).filter(ds => ds.data.length);

  charts.pricingQuadrant = new Chart(ctx, {
    type: 'bubble',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements, chart) => {
        if (!elements.length) return;
        const { datasetIndex, index } = elements[0];
        const point = chart.data.datasets[datasetIndex]?.data[index];
        if (point && point._row) openQuadrantDrillDown(point._row);
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (item) => {
              const r = item.raw._row;
              return [
                `${stripNVPrefix(r.productType)} · ${r.branch} · ${r.priceRange}`,
                `Avg Price: ${myr(r.avgPrice)}`,
                `Sell-through: ${pct(r.sellThrough)}`,
                `Balance Value: ${myr(r.balanceValue)}${pctOfTotalLabel(r.balanceValue, totalBalanceShown, 'total balance value shown')}`,
                `Category: ${PRICING_CATEGORY_META[r.category]?.label || r.category}`,
                'Click to view underlying lots',
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Avg Price (MYR, log scale)' },
          ticks: { callback: v => myrCompact(v) },
          grid: { color: '#E2E6EE' },
        },
        y: {
          min: 0, max: 100,
          title: { display: true, text: 'Sell-through %' },
          ticks: { callback: v => v + '%' },
          grid: { color: '#E2E6EE' },
        },
      },
    },
  });
}

async function openQuadrantDrillDown(row) {
  const panel = document.getElementById('quadrantDrillDown');
  const title = document.getElementById('quadrantDrillDownTitle');
  const content = document.getElementById('quadrantDrillDownContent');
  if (!panel || !content) return;

  const categoryLabel = PRICING_CATEGORY_META[row.category]?.label || row.category;
  panel.style.display = '';
  title.textContent = `${stripNVPrefix(row.productType)} · ${row.priceRange} · ${row.branch} — ${categoryLabel} — Underlying Lots`;
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const { rows, mode } = await fetchLotsDetail({
      materialType: [row.productType],
      branch: [row.branch],
      priceRange: [row.priceRange],
      status: ['OPEN'],
    });
    const totalQty = computeDrillTotalQty(rows);
    title.textContent = `${stripNVPrefix(row.productType)} (${fmt(totalQty)} units) · ${row.priceRange} · ${row.branch} — ${categoryLabel} — Underlying Lots`;
    renderDrillDownPanel(content, {
      rows, mode,
      filenameBase: `pricing_lots_${sanitizeForFilename(row.category)}_${sanitizeForFilename(row.productType)}_${sanitizeForFilename(row.branch)}`,
    });
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] openQuadrantDrillDown failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

function closeQuadrantDrillDown() {
  const panel = document.getElementById('quadrantDrillDown');
  if (panel) panel.style.display = 'none';
}

function renderPricingCategoryTable(category, rows) {
  const headRow = document.getElementById(`pricingHead_${category}`);
  const tbody = document.querySelector(`#pricingTable_${category} tbody`);
  if (!headRow || !tbody) return;

  const colCount = PRICING_TABLE_COLUMNS.length + 1;
  const sortState = pricingCategorySortState[category];
  headRow.innerHTML = PRICING_TABLE_COLUMNS.map(col => {
    const isSorted = sortState.key === col.key;
    const arrow = isSorted ? `<span class="sort-arrow">${sortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th${isSorted ? ' sorted' : ''}" data-key="${col.key}" data-cat="${category}">${col.label}${arrow}</th>`;
  }).join('') + '<th></th>';

  const sorted = sortByKey(rows, sortState);
  if (!sorted.length) {
    // Low-Hanging Fruit is a genuinely narrow definition (sellThrough >= 70% AND price <=
    // the product's own 25th percentile AND balance stock > 0) that, checked against
    // current inventory, is often empty — not a bug, so say so instead of a bare blank row.
    const emptyMsg = category === 'low_hanging_fruit'
      ? 'No Low-Hanging Fruit combinations found with current filters — try loosening the Min Stock threshold or broadening your Branch/Product Type selection.'
      : 'No combos in this category.';
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">${emptyMsg}</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(r => {
    const cells = PRICING_TABLE_COLUMNS.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('');
    const zoneBtn = `<button type="button" class="btn-expand" data-action="toggle-zone-breakdown"
      data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}" data-price-range="${escapeHtml(r.priceRange)}" data-category="${escapeHtml(category)}" aria-label="Zone breakdown">+</button>`;
    return `<tr class="accordion-row">${cells}<td><div class="row-actions">${zoneBtn}</div></td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-zone-breakdown-content></div></td></tr>`;
  }).join('');
}

function renderPricingCategoryTables(rows) {
  const byCategory = { sweet_spot: [], low_hanging_fruit: [], long_ignored_gem: [], dead_stock: [] };
  rows.forEach(r => { if (byCategory[r.category]) byCategory[r.category].push(r); });
  Object.keys(byCategory).forEach(cat => renderPricingCategoryTable(cat, byCategory[cat]));
}

function renderAgedInventoryTable(rows) {
  const headRow = document.getElementById('agedHeadRow');
  const tbody = document.querySelector('#tableAgedInventory tbody');
  if (!headRow || !tbody) return;

  const colCount = AGED_INVENTORY_COLUMNS.length + 1;
  headRow.innerHTML = AGED_INVENTORY_COLUMNS.map(col => {
    const isSorted = agedSortState.key === col.key;
    const arrow = isSorted ? `<span class="sort-arrow">${agedSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th${isSorted ? ' sorted' : ''}" data-aged-key="${col.key}">${col.label}${arrow}</th>`;
  }).join('') + '<th></th>';

  const sorted = sortByKey(rows, agedSortState);
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No unsold (OPEN) lots match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map(r => {
    const cls = r.avgAgeDays > 730 ? ' class="row-amber"' : '';
    const cells = AGED_INVENTORY_COLUMNS.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('');
    const zoneBtn = `<button type="button" class="btn-expand" data-action="toggle-zone-breakdown"
      data-product="${escapeHtml(r.productType)}" data-price-range="${escapeHtml(r.priceRange)}" aria-label="Zone breakdown">+</button>`;
    return `<tr${cls}>${cells}<td><div class="row-actions">${zoneBtn}</div></td></tr>
      <tr class="accordion-detail"${cls} style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-zone-breakdown-content></div></td></tr>`;
  }).join('');
}

function switchPricingSubtab(cat) {
  document.querySelectorAll('#tab-pricing .subtab[data-subtab]').forEach(btn => btn.classList.toggle('active', btn.dataset.subtab === cat));
  document.querySelectorAll('#tab-pricing .subtab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `subtab-${cat}`));
}

async function renderPricingIntelligence() {
  if (!updatePricingGateState()) return;
  const branch = pricingFiltersUI.branch.getValues();
  const productType = pricingFiltersUI.productType.getValues();
  const minStockInput = document.getElementById('pricingMinStock');
  const minStock = Math.max(0, parseInt(minStockInput?.value, 10) || 100);
  pricingFilters = { branch, productType };

  const categoryTbodies = ['sweet_spot', 'low_hanging_fruit', 'long_ignored_gem', 'dead_stock']
    .map(cat => document.querySelector(`#pricingTable_${cat} tbody`));
  categoryTbodies.forEach(tb => { if (tb) tb.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`; });
  const agedTbody = document.querySelector('#tableAgedInventory tbody');
  if (agedTbody) agedTbody.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;

  // Overview/Summary (#1) and Product Type Summary (#2) each run independently, scoped by
  // their own Price Range filter rather than anything fetched below.
  refreshPricingOverviewSection();
  refreshPricingProductSummarySection();

  try {
    const [quadrantRes, agedRes] = await Promise.all([
      fetchPricingJSON('quadrant', { branch, productType, minStock }),
      fetchPricingJSON('aged-inventory', { branch, productType }),
    ]);
    lastPricingQuadrant = quadrantRes.rows || [];
    lastPricingAged = agedRes.rows || [];

    renderPricingQuadrantChart(lastPricingQuadrant);
    renderPricingCategoryTables(lastPricingQuadrant);
    renderAgedInventoryTable(lastPricingAged);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] renderPricingIntelligence failed:', err);
    const msg = `<tr><td style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
    categoryTbodies.forEach(tb => { if (tb) tb.innerHTML = msg; });
    if (agedTbody) agedTbody.innerHTML = msg;
  }
}

function exportPricingQuadrantExcel() {
  if (!lastPricingQuadrant.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const header = ['Product Type', 'Price Range', 'Branch', 'Avg Price', 'Sell-through %', 'Balance Value', 'Stock Count', 'Category'];
  const aoa = [header, ...lastPricingQuadrant.map(r => [
    stripNVPrefix(r.productType), r.priceRange, r.branch,
    Number(r.avgPrice.toFixed(2)), Number(r.sellThrough.toFixed(1)), r.balanceValue, r.stockCount,
    PRICING_CATEGORY_META[r.category]?.label || r.category,
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 13 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 18 }];
  for (let r = 1; r < aoa.length; r++) {
    const priceRef = XLSX.utils.encode_cell({ r, c: 3 });
    if (ws[priceRef]) ws[priceRef].z = '"RM "#,##0.00';
    const sellRef = XLSX.utils.encode_cell({ r, c: 4 });
    if (ws[sellRef]) ws[sellRef].z = '0.0"%"';
    const balRef = XLSX.utils.encode_cell({ r, c: 5 });
    if (ws[balRef]) ws[balRef].z = '"RM "#,##0';
    const stockRef = XLSX.utils.encode_cell({ r, c: 6 });
    if (ws[stockRef]) ws[stockRef].z = '#,##0';
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pricing Quadrant');
  XLSX.writeFile(wb, `pricing_quadrant_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Zone-scoped View Lots (nested inside Zone Breakdown) ──
// Each zone row (rendered by renderZoneBreakdownTableHTML) is immediately followed by its own
// .accordion-detail row holding the [data-drill-content] placeholder. Loading is split from
// toggling so the Lot Type filter (see onLotTypeFilterChanged) can force a fresh fetch into an
// already-open panel without going through the open/close toggle.
async function loadZoneLotsDrillDownContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const lotType = lotTypeFilterValues(btn.closest('tr'));
    // Every zone row (category or Aged Inventory) now carries its own real Branch — see
    // getZoneBreakdown — so this is always a single-branch lot list; no Branch column needed.
    const filters = {
      materialType: [btn.dataset.product],
      branch: [btn.dataset.branch],
      priceRange: [btn.dataset.priceRange],
      zone: [btn.dataset.zone],
      status: ['OPEN'],
      lotType,
    };
    if (btn.dataset.minAgeDays) filters.minAgeDays = Number(btn.dataset.minAgeDays);
    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    const categoryLabel = btn.dataset.category ? (PRICING_CATEGORY_META[btn.dataset.category]?.label || btn.dataset.category) : null;
    const suffix = categoryLabel ? ` — ${escapeHtml(categoryLabel)}` : (btn.dataset.minAgeDays ? ' — Aged Inventory (&gt;365 days)' : '');
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.product))} (${fmt(totalQty)} units) · ${escapeHtml(btn.dataset.branch)} · Zone ${escapeHtml(btn.dataset.zone)} · ${escapeHtml(btn.dataset.priceRange)}${suffix}`,
      filenameBase: `pricing_lots_${sanitizeForFilename(btn.dataset.category || 'aged')}_${sanitizeForFilename(btn.dataset.product)}_${sanitizeForFilename(btn.dataset.zone)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] loadZoneLotsDrillDownContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

async function toggleZoneLotsDrillDown(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = 'View Lots'; return; }

  detailRow.style.display = '';
  btn.textContent = 'Hide Lots';
  const content = detailRow.querySelector('[data-drill-content]');
  if (content.dataset.loaded === 'true') return;
  await loadZoneLotsDrillDownContent(btn, content);
}

// ── Cross-Analysis Pivot Builder ──
const PIVOT_DIMENSION_OPTIONS = ['Branch', 'Product Type', 'Price Range', 'Eye Level', 'Family Lot', 'Lot Type', 'Status'];
const PIVOT_METRIC_OPTIONS = ['Sell-through %', 'Avg Price', 'Balance Value', 'Unit Count'];

let lastPivotResult = null;
// key: null (unsorted) | 'GROUP' (row label) | a column index (number) | 'TOTAL'
let pivotSortState = { key: null, dir: 'asc' };

// Rows and Columns must never land on the same dimension — rather than letting the user
// hit the "must differ" error on Generate, each select disables whichever option the
// other one currently holds, and picking a value that would collide auto-bumps the other
// select off of it first.
function syncPivotDimensionOptions() {
  const rowsSel = document.getElementById('pivotRows');
  const colsSel = document.getElementById('pivotCols');
  if (!rowsSel || !colsSel) return;
  [...rowsSel.options].forEach(o => { o.disabled = o.value === colsSel.value; });
  [...colsSel.options].forEach(o => { o.disabled = o.value === rowsSel.value; });
}

function firstPivotOptionExcluding(sel, avoidValue) {
  const opt = [...sel.options].find(o => o.value !== avoidValue);
  return opt ? opt.value : sel.value;
}

function onPivotRowsChange() {
  const rowsSel = document.getElementById('pivotRows');
  const colsSel = document.getElementById('pivotCols');
  if (rowsSel.value === colsSel.value) colsSel.value = firstPivotOptionExcluding(colsSel, rowsSel.value);
  syncPivotDimensionOptions();
}

function onPivotColsChange() {
  const rowsSel = document.getElementById('pivotRows');
  const colsSel = document.getElementById('pivotCols');
  if (colsSel.value === rowsSel.value) rowsSel.value = firstPivotOptionExcluding(rowsSel, colsSel.value);
  syncPivotDimensionOptions();
}

// Pivot Builder gets its own independent Branch + Product Type filters — separate from
// pricingFiltersUI (Quadrant/Category/Aged Inventory). These are optional scoping filters,
// never a hard gate: empty means "all branches/products," and Generate Matrix only ever
// depends on Rows/Columns/Metric being selected (always true — they're single-selects with
// defaults, never blank) plus the rowDimension !== colDimension check above.
const pivotFiltersUI = {};

async function refreshPivotCascade() {
  const branch = pivotFiltersUI.branch.getValues();
  try {
    const { productTypes } = await fetchPricingJSON('filters', { branch });
    pivotFiltersUI.productType.setOptions(productTypes || []);
  } catch (e) {
    console.error('[dashboard] refreshPivotCascade failed:', e);
  }
}

function initPricingPivotControls() {
  const rowsSel = document.getElementById('pivotRows');
  const colsSel = document.getElementById('pivotCols');
  const metricSel = document.getElementById('pivotMetric');
  if (!rowsSel || !colsSel || !metricSel) return;
  rowsSel.innerHTML = PIVOT_DIMENSION_OPTIONS.map(d => `<option value="${d}">${d}</option>`).join('');
  colsSel.innerHTML = PIVOT_DIMENSION_OPTIONS.map(d => `<option value="${d}">${d}</option>`).join('');
  metricSel.innerHTML = PIVOT_METRIC_OPTIONS.map(m => `<option value="${m}">${m}</option>`).join('');
  rowsSel.value = 'Eye Level';
  colsSel.value = 'Branch';
  metricSel.value = 'Sell-through %';
  syncPivotDimensionOptions();
  rowsSel.addEventListener('change', onPivotRowsChange);
  colsSel.addEventListener('change', onPivotColsChange);

  pivotFiltersUI.branch = new MultiSelect('pivotBranch', {
    placeholder: 'All branches',
    onChange: refreshPivotCascade,
  });
  pivotFiltersUI.productType = new MultiSelect('pivotProductType', {
    placeholder: 'All products',
    displayFn: stripNVPrefix,
  });
  fetchPricingJSON('filters', {}).then(({ branches, productTypes }) => {
    pivotFiltersUI.branch.setOptions(branches || []);
    pivotFiltersUI.productType.setOptions(productTypes || []);
  }).catch(e => console.error('[dashboard] initPricingPivotControls filters failed:', e));
}

function pivotMetricText(metric, value) {
  if (metric === 'Sell-through %') return pct(value);
  if (metric === 'Avg Price') return myr(value);
  if (metric === 'Balance Value') return myrCompact(value);
  return fmt(value);
}

function pivotSortedRowIndices(result) {
  const { rows, cells, rowTotals } = result;
  const indices = rows.map((_, i) => i);
  const { key, dir } = pivotSortState;
  if (key === null) return indices;
  const sign = dir === 'asc' ? 1 : -1;
  indices.sort((a, b) => {
    const cmp = key === 'GROUP' ? naturalCompare(rows[a], rows[b])
      : key === 'TOTAL' ? rowTotals[a] - rowTotals[b]
      : cells[a][key] - cells[b][key];
    return cmp * sign;
  });
  return indices;
}

function renderPricingPivotTable() {
  const result = lastPivotResult;
  const headerEl = document.getElementById('pivotHeader');
  const headRow = document.getElementById('pivotHeadRow');
  const body = document.getElementById('pivotBody');
  const foot = document.getElementById('pivotFoot');
  if (!headRow || !body) return;

  if (!result || !result.rows.length || !result.columns.length) {
    if (headerEl) headerEl.innerHTML = '';
    headRow.innerHTML = '';
    const msg = result ? 'No data for this combination.' : 'Choose Rows, Columns and a Metric, then click Generate Matrix.';
    body.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">${msg}</td></tr>`;
    if (foot) foot.innerHTML = '';
    return;
  }

  const { rows, columns, cells, rowTotals, colTotals, grandTotal, metric, rowDimension, colDimension } = result;

  if (headerEl) {
    headerEl.innerHTML = `<span><strong>${escapeHtml(rowDimension)}</strong> rows &times; <strong>${escapeHtml(colDimension)}</strong> columns — <strong>${escapeHtml(metric)}</strong></span>`;
  }

  const sortArrow = (key) => pivotSortState.key === key
    ? `<span class="sort-arrow">${pivotSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';

  const groupTh = `<th class="sortable-th${pivotSortState.key === 'GROUP' ? ' sorted' : ''}" data-pivot-key="GROUP">${escapeHtml(rowDimension)}${sortArrow('GROUP')}</th>`;
  const colThs = columns.map((c, i) => `<th class="sortable-th${pivotSortState.key === i ? ' sorted' : ''}" data-pivot-key="${i}">${escapeHtml(stripNVPrefix(c))}${sortArrow(i)}</th>`).join('');
  const totalTh = `<th class="sortable-th${pivotSortState.key === 'TOTAL' ? ' sorted' : ''}" data-pivot-key="TOTAL">TOTAL${sortArrow('TOTAL')}</th>`;
  headRow.innerHTML = groupTh + colThs + totalTh;

  const order = pivotSortedRowIndices(result);
  body.innerHTML = order.map(i => {
    const tds = cells[i].map(v => `<td class="matrix-qty-col">${pivotMetricText(metric, v)}</td>`).join('');
    return `<tr><td><strong>${escapeHtml(stripNVPrefix(rows[i]))}</strong></td>${tds}<td class="matrix-total-cell">${pivotMetricText(metric, rowTotals[i])}</td></tr>`;
  }).join('');

  if (foot) {
    const tds = colTotals.map(v => `<td class="matrix-total-cell">${pivotMetricText(metric, v)}</td>`).join('');
    foot.innerHTML = `<tr class="matrix-total-row"><td>TOTAL</td>${tds}<td class="matrix-total-cell">${pivotMetricText(metric, grandTotal)}</td></tr>`;
  }
}

async function generatePricingPivot() {
  const rowDimension = document.getElementById('pivotRows')?.value;
  const colDimension = document.getElementById('pivotCols')?.value;
  const metric = document.getElementById('pivotMetric')?.value;
  if (!rowDimension || !colDimension || rowDimension === colDimension) {
    alert('Rows and Columns must be two different dimensions.');
    return;
  }

  const body = document.getElementById('pivotBody');
  if (body) body.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;

  try {
    const result = await fetchPricingJSON('pivot', {
      rowDimension, colDimension, metric,
      branch: pivotFiltersUI.branch.getValues(),
      productType: pivotFiltersUI.productType.getValues(),
    });
    // Re-fetching (e.g. just changing the Branch/Product Type scope) shouldn't reset a
    // sort the user already picked — only reset when the Rows/Columns dimensions actually
    // changed, since a sort key from the old dimensions wouldn't make sense against the new ones.
    const dimensionsChanged = !lastPivotResult
      || lastPivotResult.rowDimension !== rowDimension
      || lastPivotResult.colDimension !== colDimension;
    lastPivotResult = result;
    if (dimensionsChanged) pivotSortState = { key: null, dir: 'asc' };
    renderPricingPivotTable();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[dashboard] generatePricingPivot failed:', err);
    if (body) body.innerHTML = `<tr><td style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

function exportPivotExcel() {
  if (!lastPivotResult || !lastPivotResult.rows.length) { alert('No data to export. Generate a matrix first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const { rows, columns, cells, rowTotals, colTotals, grandTotal, metric, rowDimension, colDimension } = lastPivotResult;
  const rawVal = metric === 'Unit Count' ? v => Math.round(v) : v => Number(v.toFixed(2));
  const numFmt = metric === 'Sell-through %' ? '0.0"%"' : (metric === 'Avg Price' || metric === 'Balance Value') ? '"RM "#,##0' : '#,##0';

  const header = [rowDimension, ...columns.map(stripNVPrefix), 'TOTAL'];
  const aoa = [
    [`${rowDimension} x ${colDimension} — ${metric}`],
    [],
    header,
    ...rows.map((r, i) => [stripNVPrefix(r), ...cells[i].map(rawVal), rawVal(rowTotals[i])]),
    ['TOTAL', ...colTotals.map(rawVal), rawVal(grandTotal)],
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, ...columns.map(() => ({ wch: 13 })), { wch: 13 }];
  for (let r = 3; r < aoa.length; r++) {
    for (let c = 1; c < header.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (ws[ref]) ws[ref].z = numFmt;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pivot');
  XLSX.writeFile(wb, `pricing_pivot_${sanitizeForFilename(rowDimension)}_${sanitizeForFilename(colDimension)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Single delegated listener covers sub-tab switching, category/aged/pivot sort-header
// clicks, and the drill-down accordion toggles — all of which rebuild their own innerHTML.
function initPricingTabEvents() {
  const panel = document.getElementById('tab-pricing');
  if (!panel) return;
  panel.addEventListener('click', (e) => {
    const subtabBtn = e.target.closest('.subtab[data-subtab]');
    if (subtabBtn) { switchPricingSubtab(subtabBtn.dataset.subtab); return; }

    const catTh = e.target.closest('th[data-key][data-cat]');
    if (catTh) {
      const { key, cat } = catTh.dataset;
      const st = pricingCategorySortState[cat];
      pricingCategorySortState[cat] = st.key === key ? { key, dir: st.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
      renderPricingCategoryTable(cat, lastPricingQuadrant.filter(r => r.category === cat));
      return;
    }

    const agedTh = e.target.closest('th[data-aged-key]');
    if (agedTh) {
      const key = agedTh.dataset.agedKey;
      agedSortState = agedSortState.key === key ? { key, dir: agedSortState.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
      renderAgedInventoryTable(lastPricingAged);
      return;
    }

    const productSummaryTh = e.target.closest('th[data-product-summary-key]');
    if (productSummaryTh) {
      const key = productSummaryTh.dataset.productSummaryKey;
      productSummarySortState = productSummarySortState.key === key
        ? { key, dir: productSummarySortState.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
      renderPricingProductSummaryTable(lastPricingByProduct);
      return;
    }

    const pivotTh = e.target.closest('th[data-pivot-key]');
    if (pivotTh) {
      const raw = pivotTh.dataset.pivotKey;
      const key = (raw === 'GROUP' || raw === 'TOTAL') ? raw : Number(raw);
      pivotSortState = pivotSortState.key === key ? { key, dir: pivotSortState.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
      renderPricingPivotTable();
      return;
    }

    const zoneLotsBtn = e.target.closest('button[data-action="toggle-zone-lots"]');
    if (zoneLotsBtn) { toggleZoneLotsDrillDown(zoneLotsBtn); return; }

    const productBranchLotsBtn = e.target.closest('button[data-action="toggle-productbranch-lots"]');
    if (productBranchLotsBtn) { toggleProductBranchLots(productBranchLotsBtn); return; }

    const breakdownBtn = e.target.closest('button[data-action="toggle-product-breakdown"]');
    if (breakdownBtn) { toggleProductBranchBreakdown(breakdownBtn); return; }

    const zoneBtn = e.target.closest('button[data-action="toggle-zone-breakdown"]');
    if (zoneBtn) {
      // Category-table rows set data-branch on this button; Aged Inventory rows don't
      // (Aged rows have no single Branch — they fall back to the tab's own Branch filter).
      const filters = zoneBtn.dataset.branch !== undefined
        ? { branch: [zoneBtn.dataset.branch], productType: [zoneBtn.dataset.product], priceRange: [zoneBtn.dataset.priceRange] }
        : { productType: [zoneBtn.dataset.product], priceRange: [zoneBtn.dataset.priceRange], branch: pricingFilters.branch, minAgeDays: 365 };
      toggleZoneBreakdown(zoneBtn, filters);
      return;
    }

    const lotTypeCb = e.target.closest('[data-lot-type-filter] input[type="checkbox"]');
    if (lotTypeCb) {
      const details = lotTypeCb.closest('[data-lot-type-filter]');
      onLotTypeFilterChanged(details, pricingLotTypeFilterOptionsFor(details.closest('tr')));
      return;
    }

    const lotTypeSelectAll = e.target.closest('[data-lot-type-select-all]');
    if (lotTypeSelectAll) {
      const details = lotTypeSelectAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      onLotTypeFilterChanged(details, pricingLotTypeFilterOptionsFor(details.closest('tr')));
      return;
    }

    const lotTypeClearAll = e.target.closest('[data-lot-type-clear-all]');
    if (lotTypeClearAll) {
      const details = lotTypeClearAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      onLotTypeFilterChanged(details, pricingLotTypeFilterOptionsFor(details.closest('tr')));
      return;
    }

    if (handleDrillDownPaginationOrExport(e)) return;
  });

  // Lot Type options are fetched lazily on first open — <details>'s "toggle" event doesn't
  // bubble, so this has to listen in the capture phase to catch it via delegation at all.
  panel.addEventListener('toggle', (e) => {
    const details = e.target.closest && e.target.closest('[data-lot-type-filter]');
    if (details && details.open && details.dataset.loaded !== 'true') {
      details.dataset.loaded = 'true';
      loadLotTypeOptionsForDetails(details);
    }
  }, true);
}

// Branch/Product Type default to "All" selected (see initPricingFilters), so the gate is
// already satisfied once that fetch resolves — awaiting it here means the very first tab
// open renders real data (Quadrant, Category tables, Aged Inventory, Pivot Builder) instead
// of the old empty "select filters first" state.
async function onPricingTabActivated() {
  if (pricingLoaded) return;
  pricingLoaded = true;
  await pricingFiltersReady;
  updatePricingGateState();
  renderPricingIntelligence();
  generatePricingPivot();
}

initPricingFilters();
initPricingPivotControls();
initPricingTabEvents();

window.renderPricingIntelligence = renderPricingIntelligence;
window.exportPricingQuadrantExcel = exportPricingQuadrantExcel;
window.generatePricingPivot = generatePricingPivot;
window.exportPivotExcel = exportPivotExcel;
window.closeQuadrantDrillDown = closeQuadrantDrillDown;
window.onPricingTabActivated = onPricingTabActivated;

// ── Session expiry ──
function showSessionExpired() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <p style="color:#1A2C5B;font-weight:600;">Your session has expired. Please log in again.</p>
    <button id="btnReLogin" style="margin-top:1rem;padding:0.6rem 1.25rem;background:#1A2C5B;color:#fff;border:none;border-radius:7px;cursor:pointer;font-weight:600;font-size:0.9rem;">Log In Again</button>
  `;
  document.getElementById('btnReLogin')?.addEventListener('click', () => {
    window.location.href = '/login';
  });
}

// ── Bootstrap ──
async function initDashboard() {
  try {
    // Not part of the bigLotFilter-scoped /api/data payload — monthly_snapshots has no filters
    // (see its own comments), so this runs independently and doesn't block KPI/chart rendering.
    loadMonthlyTrend();

    const qs = window.bigLotFilter && window.bigLotFilter !== 'all' ? `?bigLotFilter=${window.bigLotFilter}` : '';
    const res = await fetch(`/api/data${qs}`);
    if (res.status === 401 || res.redirected || res.url.includes('/login')) {
      showSessionExpired();
      return;
    }
    if (!res.ok) throw new Error('Failed to load data');
    const d = await res.json();
    console.log(d);

    const call = (name, fn) => {
      try { fn(); }
      catch (e) { console.error(`[dashboard] ${name} threw:`, e, '\ndata:', d); throw e; }
    };

    call('renderYTDBadge',              () => renderYTDBadge());
    call('renderKPIs',                  () => renderKPIs(d.overview));
    call('renderBranchSellthroughChart',() => renderBranchSellthroughChart(d.branches));
    call('renderProductDonut',          () => renderProductDonut(d.products));
    call('renderStatusBar',             () => renderStatusBar(d.statuses));
    call('renderBranchStackedChart',    () => renderBranchStackedChart(d.branches));
    call('renderBranchTable',           () => renderBranchTable(d.branches));
    call('renderProductHBar',           () => renderProductHBar(d.products));
    call('renderProductTable',          () => renderProductTable(d.products));
    call('renderBDSummary',             () => renderBDSummary(d.bdFocus));
    call('renderBDFocusTable',          () => renderBDFocusTable(d.bdFocus));

    document.getElementById('loadingOverlay')?.classList.add('hidden');
  } catch (err) {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.innerHTML = `<p style="color:#E24B4A;font-weight:600;">Failed to load data: ${err.message}</p>
        <p style="color:#6B7280;font-size:0.82rem;margin-top:0.5rem;">Is the Excel file in /data/stock_data.xlsx?</p>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', initDashboard);
