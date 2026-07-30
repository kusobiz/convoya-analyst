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
          callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%` },
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
  charts.productDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: top6.map(p => p.product.replace('NV ', '')),
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
          callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)} units` },
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
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)} lots` },
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
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` },
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
  charts.productBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(p => p.product.replace('NV ', '')),
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
          callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%` },
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
      <td>${p.product}</td>
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

// Display-only: the DB's "Material Type Desc." values are all prefixed "NV ";
// queries always use the full value, only rendering strips it.
function stripNVPrefix(materialType) {
  return String(materialType || '').replace(/^NV\s+/i, '');
}

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

function lotTableColumnCount(mode) {
  return lotColumnsFor(mode).length;
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
  }).join('');
}

function renderLotResultsBody(mode) {
  const tbody = document.querySelector('#tableLots tbody');
  const tfoot = document.querySelector('#tableLots tfoot');
  if (!tbody) return;

  const columns = lotColumnsFor(mode);
  const colCount = columns.length;
  const rows = sortLotRows(lastLotRows, lotSortState);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No lots match these filters.</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = rows.map(r => `<tr>${
    columns.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('')
  }</tr>`).join('');

  const t = sumLotRows(lastLotRows);
  const textColCount = columns.filter(c => c.type === 'text').length;
  const numericCells = columns.filter(c => c.type === 'number')
    .map(col => `<td>${col.key === 'totalBalanceAmount' ? myr(t[col.key]) : fmt(t[col.key])}</td>`).join('');
  if (tfoot) {
    tfoot.innerHTML = `<tr class="totals-row"><td colspan="${textColCount}">Totals</td>${numericCells}</tr>`;
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
    matrixSortState = { key: null, dir: 'asc' };
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
    matrixSortState = { key: null, dir: 'asc' };
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
  setOptions(values, { preserveSelection = true } = {}) {
    this.options = values;
    this.selected = preserveSelection ? new Set([...this.selected].filter(v => values.includes(v))) : new Set();
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
  return qs.toString();
}

async function fetchLotFilters() {
  try {
    const res = await fetch('/api/lots/filters');
    if (!res.ok) return { materialTypes: [], branches: [] };
    const { materialTypes, branches } = await res.json();
    return { materialTypes: materialTypes || [], branches: branches || [] };
  } catch (e) {
    console.error('[dashboard] fetchLotFilters failed:', e);
    return { materialTypes: [], branches: [] };
  }
}

async function fetchLotZones(branch, materialType) {
  try {
    const res = await fetch(`/api/lots/zones?${buildArrayQuery({ branch, materialType })}`);
    if (!res.ok) return [];
    const { zones } = await res.json();
    return zones;
  } catch (e) {
    console.error('[dashboard] fetchLotZones failed:', e);
    return [];
  }
}

async function fetchLotSuites(branch, zone, materialType) {
  try {
    const res = await fetch(`/api/lots/suites?${buildArrayQuery({ branch, zone, materialType })}`);
    if (!res.ok) return { suites: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotSuites failed:', e);
    return { suites: [], statuses: [] };
  }
}

async function fetchLotSections(branch, zone, suiteNo, materialType) {
  try {
    const res = await fetch(`/api/lots/sections?${buildArrayQuery({ branch, zone, suiteNo, materialType })}`);
    if (!res.ok) return { sections: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotSections failed:', e);
    return { sections: [], statuses: [] };
  }
}

async function fetchLotLevels(branch, zone, suiteNo, section, materialType) {
  try {
    const res = await fetch(`/api/lots/levels?${buildArrayQuery({ branch, zone, suiteNo, section, materialType })}`);
    if (!res.ok) return { levels: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotLevels failed:', e);
    return { levels: [], statuses: [] };
  }
}

async function fetchLotTypes(branch, zone, materialType) {
  try {
    const res = await fetch(`/api/lots/lotTypes?${buildArrayQuery({ branch, zone, materialType })}`);
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

  if (mode === 'structured') {
    const { suites, statuses: suiteStatuses } = await fetchLotSuites(branch, zone, materialType);
    lotFilters.suiteNo.setOptions(suites);

    const suiteNo = lotFilters.suiteNo.getValues();
    const { sections, statuses: sectionStatuses } = await fetchLotSections(branch, zone, suiteNo, materialType);
    lotFilters.section.setOptions(sections);

    const section = lotFilters.section.getValues();
    const { levels, statuses: levelStatuses } = await fetchLotLevels(branch, zone, suiteNo, section, materialType);
    lotFilters.level.setOptions(levels);

    lotFilters.status.setOptions(levelStatuses.length ? levelStatuses : (sectionStatuses.length ? sectionStatuses : suiteStatuses));
  } else {
    const { lotTypes, statuses } = await fetchLotTypes(branch, zone, materialType);
    lotFilters.lotType.setOptions(lotTypes);
    lotFilters.status.setOptions(statuses);
  }
}

async function refreshLotCascade() {
  const materialType = lotFilters.materialType.getValues();
  const mode = modeForSelection(materialType);
  applyLotModeUI(mode);

  const gated = [lotFilters.zone, lotFilters.suiteNo, lotFilters.section, lotFilters.level, lotFilters.lotType, lotFilters.status];

  if (!mode) {
    gated.forEach(f => { f.setOptions([]); f.setDisabled(true, 'Select product type first'); });
    const matrixCard = document.getElementById('lotMatrixCard');
    if (matrixCard) matrixCard.style.display = 'none';
    return;
  }
  gated.forEach(f => f.setDisabled(false));

  const branch = lotFilters.branch.getValues();
  const zones = await fetchLotZones(branch, materialType);
  lotFilters.zone.setOptions(zones);

  await refreshLotLocationFields();
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

window.renderLotDrillDown = renderLotDrillDown;
window.exportLotsCSV = exportLotsCSV;
window.exportMatrixExcel = exportMatrixExcel;
window.exportMatrixPDF = exportMatrixPDF;

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
    const res = await fetch('/api/data');
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
