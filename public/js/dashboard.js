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

function lotTableColumnCount(mode) {
  return mode === 'flat' ? 8 : 10;
}

function renderLotsTableHead(mode) {
  const headRow = document.getElementById('lotsHeadRow');
  if (!headRow) return;
  const cols = mode === 'flat'
    ? ['Product Type', 'Lot Type', 'Status', 'Lots', 'Total Stock', 'Sold', 'Balance', 'Balance Value']
    : ['Product Type', 'Zone', 'Level', 'Lot Type', 'Status', 'Lots', 'Total Stock', 'Sold', 'Balance', 'Balance Value'];
  headRow.innerHTML = cols.map(c => `<th>${c}</th>`).join('');
}

async function renderLotDrillDown() {
  const tbody = document.querySelector('#tableLots tbody');
  const tfoot = document.querySelector('#tableLots tfoot');
  if (!tbody) return;

  const materialType = document.getElementById('lotMaterialType')?.value.trim();
  const mode = materialTypeMode(materialType);

  if (!materialType || !mode) {
    renderLotsTableHead('structured');
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--muted)">Please select a Product Type to begin.</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    renderLotMatrix([], {}, 'structured');
    return;
  }

  const body = {
    materialType,
    branch: document.getElementById('lotBranch')?.value.trim(),
    zone:   document.getElementById('lotZone')?.value.trim(),
    status: document.getElementById('lotStatus')?.value.trim(),
  };
  if (mode === 'structured') {
    body.suiteNo = document.getElementById('lotSuite')?.value.trim();
    body.section = document.getElementById('lotSection')?.value.trim();
    body.level   = document.getElementById('lotLevel')?.value.trim();
  } else {
    body.lotType = document.getElementById('lotType')?.value.trim();
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
    const matrixCtx = { branch: body.branch, materialType, zone: body.zone, suite: body.suiteNo };

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No lots match these filters.</td></tr>`;
      renderLotMatrix([], matrixCtx, resolvedMode);
      return;
    }

    tbody.innerHTML = rows.map(r => resolvedMode === 'flat' ? `<tr>
      <td>${stripNVPrefix(r.materialType)}</td>
      <td>${r.lotType}</td>
      <td><span class="badge ${lotStatusBadgeClass(r.status)}">${r.status}</span></td>
      <td>${fmt(r.lotCount)}</td>
      <td>${fmt(r.totalStock)}</td>
      <td>${fmt(r.totalSold)}</td>
      <td>${fmt(r.totalBalance)}</td>
      <td>${myr(r.totalBalanceAmount)}</td>
    </tr>` : `<tr>
      <td>${stripNVPrefix(r.materialType)}</td>
      <td>${r.zone}</td>
      <td>${r.level}</td>
      <td>${r.lotType}</td>
      <td><span class="badge ${lotStatusBadgeClass(r.status)}">${r.status}</span></td>
      <td>${fmt(r.lotCount)}</td>
      <td>${fmt(r.totalStock)}</td>
      <td>${fmt(r.totalSold)}</td>
      <td>${fmt(r.totalBalance)}</td>
      <td>${myr(r.totalBalanceAmount)}</td>
    </tr>`).join('');

    const t = sumLotRows(rows);
    const labelColspan = resolvedMode === 'flat' ? 3 : 5;
    if (tfoot) {
      tfoot.innerHTML = `<tr class="totals-row">
        <td colspan="${labelColspan}">Totals</td>
        <td>${fmt(t.lotCount)}</td>
        <td>${fmt(t.totalStock)}</td>
        <td>${fmt(t.totalSold)}</td>
        <td>${fmt(t.totalBalance)}</td>
        <td>${myr(t.totalBalanceAmount)}</td>
      </tr>`;
    }

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

function matrixCellHtml(units, amount) {
  return `<div class="matrix-cell-units">${fmt(units)} units</div><div class="matrix-cell-amount">${myrCompact(amount)}</div>`;
}

function renderLotMatrix(rows, ctx, mode = 'structured') {
  const card = document.getElementById('lotMatrixCard');
  const titleEl = document.getElementById('lotMatrixTitle');
  if (!card) return;

  if (!rows.length) {
    card.style.display = 'none';
    return;
  }

  const groupKey = mode === 'flat' ? 'lotType' : 'level';
  const groupLabel = mode === 'flat' ? 'Lot Type' : 'Level';
  const groups = Array.from(new Set(rows.map(r => r[groupKey]))).sort(naturalCompare);

  if (titleEl) titleEl.textContent = mode === 'flat' ? 'Lot Type Summary Matrix' : 'Zone Summary Matrix';

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

  const headerEl = document.getElementById('matrixHeader');
  if (headerEl) {
    const productLabel = stripNVPrefix(ctx.materialType);
    headerEl.innerHTML = mode === 'flat'
      ? `<span><strong>${ctx.branch || 'All Branches'}</strong> — <strong>${productLabel}</strong> — Lot Type Summary</span>`
      : `<span><strong>${ctx.branch || 'All Branches'}</strong> — <strong>${productLabel}</strong> — Zone <strong>${ctx.zone || 'All'}</strong> — Suite <strong>${ctx.suite || 'All'}</strong></span>`;
  }

  const headRow = document.getElementById('matrixHeadRow');
  if (headRow) {
    headRow.innerHTML = `<th>${groupLabel}</th>` +
      MATRIX_STATUS_ORDER.map(s => `<th${s === 'OPEN' ? ' class="matrix-open-col"' : ''}>${s}</th>`).join('') +
      `<th>TOTAL</th>`;
  }

  const colTotals = {};
  MATRIX_STATUS_ORDER.forEach(s => { colTotals[s] = { units: 0, amount: 0 }; });
  let grandUnits = 0;
  let grandAmount = 0;

  const body = document.getElementById('matrixBody');
  if (body) {
    body.innerHTML = groups.map(group => {
      let rowUnits = 0;
      let rowAmount = 0;
      const tds = MATRIX_STATUS_ORDER.map(status => {
        const c = cells[status][group];
        rowUnits += c.units;
        rowAmount += c.amount;
        colTotals[status].units += c.units;
        colTotals[status].amount += c.amount;
        const cellClass = status === 'OPEN' ? ' class="matrix-open-col"' : '';
        return `<td${cellClass}>${matrixCellHtml(c.units, c.amount)}</td>`;
      }).join('');
      grandUnits += rowUnits;
      grandAmount += rowAmount;
      return `<tr>
        <td><strong>${group}</strong></td>
        ${tds}
        <td class="matrix-total-cell">${matrixCellHtml(rowUnits, rowAmount)}</td>
      </tr>`;
    }).join('');
  }

  const foot = document.getElementById('matrixFoot');
  if (foot) {
    const tds = MATRIX_STATUS_ORDER.map(status => {
      const cellClass = status === 'OPEN' ? ' class="matrix-open-col"' : '';
      return `<td${cellClass}>${matrixCellHtml(colTotals[status].units, colTotals[status].amount)}</td>`;
    }).join('');
    foot.innerHTML = `<tr class="matrix-total-row">
      <td>TOTAL</td>
      ${tds}
      <td>${matrixCellHtml(grandUnits, grandAmount)}</td>
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

// ── Cascading filters: Material Type → Branch → [Zone → Suite No → Section → Level] | [Lot Type] ──
function resetSelect(id, placeholder, disabled) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  select.disabled = disabled;
}

function populateSelect(id, values, placeholder, disabled = false) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${v}">${v}</option>`).join('');
  select.disabled = disabled;
}

function applyLotModeUI(mode) {
  document.querySelectorAll('.structured-only').forEach(el => { el.style.display = mode === 'structured' ? '' : 'none'; });
  document.querySelectorAll('.flat-only').forEach(el => { el.style.display = mode === 'flat' ? '' : 'none'; });
}

function populateProductTypeSelect(values) {
  const select = document.getElementById('lotMaterialType');
  if (!select) return;
  select.innerHTML = `<option value="">Select product type</option>` +
    values.map(v => `<option value="${v}">${stripNVPrefix(v)}</option>`).join('');
}

async function fetchLotMaterialTypes() {
  try {
    const res = await fetch('/api/lots/filters');
    if (!res.ok) return [];
    const { materialTypes } = await res.json();
    return materialTypes || [];
  } catch (e) {
    console.error('[dashboard] fetchLotMaterialTypes failed:', e);
    return [];
  }
}

async function fetchLotZones(branch, materialType) {
  try {
    const res = await fetch(`/api/lots/zones?branch=${encodeURIComponent(branch)}&materialType=${encodeURIComponent(materialType)}`);
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
    const res = await fetch(`/api/lots/suites?branch=${encodeURIComponent(branch)}&zone=${encodeURIComponent(zone)}&materialType=${encodeURIComponent(materialType)}`);
    if (!res.ok) return { suites: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotSuites failed:', e);
    return { suites: [], statuses: [] };
  }
}

async function fetchLotSections(branch, zone, suiteNo, materialType) {
  try {
    const res = await fetch(`/api/lots/sections?branch=${encodeURIComponent(branch)}&zone=${encodeURIComponent(zone)}&suiteNo=${encodeURIComponent(suiteNo)}&materialType=${encodeURIComponent(materialType)}`);
    if (!res.ok) return { sections: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotSections failed:', e);
    return { sections: [], statuses: [] };
  }
}

async function fetchLotLevels(branch, zone, suiteNo, section, materialType) {
  try {
    const res = await fetch(`/api/lots/levels?branch=${encodeURIComponent(branch)}&zone=${encodeURIComponent(zone)}&suiteNo=${encodeURIComponent(suiteNo)}&section=${encodeURIComponent(section)}&materialType=${encodeURIComponent(materialType)}`);
    if (!res.ok) return { levels: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotLevels failed:', e);
    return { levels: [], statuses: [] };
  }
}

async function fetchLotTypes(branch, zone, materialType) {
  try {
    const res = await fetch(`/api/lots/lotTypes?branch=${encodeURIComponent(branch)}&zone=${encodeURIComponent(zone)}&materialType=${encodeURIComponent(materialType)}`);
    if (!res.ok) return { lotTypes: [], statuses: [] };
    return await res.json();
  } catch (e) {
    console.error('[dashboard] fetchLotTypes failed:', e);
    return { lotTypes: [], statuses: [] };
  }
}

// Zone is a standard filter for every product type; everything past it (Suite/Section/Level
// for structured types, Lot Type for flat land) resets whenever Branch or Product Type changes.
function resetLotZoneDownstream(zonePlaceholder) {
  resetSelect('lotZone',    zonePlaceholder, true);
  resetSelect('lotSuite',   'Select zone first', true);
  resetSelect('lotSection', 'Select suite first', true);
  resetSelect('lotLevel',   'Select section first', true);
  resetSelect('lotType',    'Select zone first', true);
  resetSelect('lotStatus',  'All statuses', false);
}

async function onLotMaterialTypeChange() {
  const materialType = document.getElementById('lotMaterialType')?.value.trim();
  const branch = document.getElementById('lotBranch')?.value.trim();
  const mode = materialTypeMode(materialType);

  applyLotModeUI(mode);
  resetLotZoneDownstream(mode ? 'Select zone' : 'Select product type first');
  const matrixCard = document.getElementById('lotMatrixCard');
  if (matrixCard) matrixCard.style.display = 'none';

  if (!mode) return;
  const zones = await fetchLotZones(branch, materialType);
  populateSelect('lotZone', zones, 'Select zone', false);
}

async function onLotBranchChange() {
  const branch = document.getElementById('lotBranch')?.value.trim();
  const materialType = document.getElementById('lotMaterialType')?.value.trim();
  const mode = materialTypeMode(materialType);

  resetLotZoneDownstream(mode ? 'Select zone' : 'Select product type first');

  if (!mode) return;
  const zones = await fetchLotZones(branch, materialType);
  populateSelect('lotZone', zones, 'Select zone', false);
}

async function onLotZoneChange() {
  const branch = document.getElementById('lotBranch')?.value.trim();
  const zone   = document.getElementById('lotZone')?.value.trim();
  const materialType = document.getElementById('lotMaterialType')?.value.trim();
  const mode = materialTypeMode(materialType);

  resetSelect('lotSection', 'Select suite first', true);
  resetSelect('lotLevel',   'Select section first', true);
  resetSelect('lotSuite',   zone ? 'Select suite' : 'Select zone first', true);
  resetSelect('lotType',    zone ? 'Select lot type' : 'Select zone first', true);

  if (!zone || !mode) return;

  if (mode === 'structured') {
    const { suites, statuses } = await fetchLotSuites(branch, zone, materialType);
    populateSelect('lotStatus', statuses, 'All statuses', false);

    if (!suites.length) {
      // Some structured types have 0% Suite No coverage for this zone/branch — skip
      // straight to Section rather than permanently blocking the cascade.
      resetSelect('lotSuite', 'No suite data', true);
      const { sections, statuses: sectionStatuses } = await fetchLotSections(branch, zone, '', materialType);
      populateSelect('lotSection', sections, 'Select section', false);
      populateSelect('lotStatus',  sectionStatuses, 'All statuses', false);
    } else {
      populateSelect('lotSuite', suites, 'Select suite', false);
    }
  } else {
    const { lotTypes, statuses } = await fetchLotTypes(branch, zone, materialType);
    populateSelect('lotType', lotTypes, 'Select lot type', false);
    populateSelect('lotStatus', statuses, 'All statuses', false);
  }
}

async function onLotSuiteChange() {
  const branch  = document.getElementById('lotBranch')?.value.trim();
  const zone    = document.getElementById('lotZone')?.value.trim();
  const suiteNo = document.getElementById('lotSuite')?.value.trim();
  const materialType = document.getElementById('lotMaterialType')?.value.trim();

  resetSelect('lotSection', suiteNo ? 'Select section' : 'Select suite first', !suiteNo);
  resetSelect('lotLevel',   'Select section first', true);

  if (!suiteNo) return;

  const { sections, statuses } = await fetchLotSections(branch, zone, suiteNo, materialType);
  populateSelect('lotSection', sections, 'Select section', false);
  populateSelect('lotStatus',  statuses, 'All statuses', false);
}

async function onLotSectionChange() {
  const branch  = document.getElementById('lotBranch')?.value.trim();
  const zone    = document.getElementById('lotZone')?.value.trim();
  const suiteNo = document.getElementById('lotSuite')?.value.trim();
  const section = document.getElementById('lotSection')?.value.trim();
  const materialType = document.getElementById('lotMaterialType')?.value.trim();

  resetSelect('lotLevel', section ? 'Select level' : 'Select section first', !section);

  if (!section) return;

  const { levels, statuses } = await fetchLotLevels(branch, zone, suiteNo, section, materialType);
  populateSelect('lotLevel',  levels,   'Select level', false);
  populateSelect('lotStatus', statuses, 'All statuses', false);
}

async function initLotMaterialTypeFilter() {
  renderLotsTableHead('structured');
  const materialTypes = await fetchLotMaterialTypes();
  populateProductTypeSelect(materialTypes);
  applyLotModeUI(null);
}

document.getElementById('lotMaterialType')?.addEventListener('change', onLotMaterialTypeChange);
document.getElementById('lotBranch')?.addEventListener('change', onLotBranchChange);
document.getElementById('lotZone')?.addEventListener('change', onLotZoneChange);
document.getElementById('lotSuite')?.addEventListener('change', onLotSuiteChange);
document.getElementById('lotSection')?.addEventListener('change', onLotSectionChange);

initLotMaterialTypeFilter();

window.renderLotDrillDown = renderLotDrillDown;
window.exportLotsCSV = exportLotsCSV;

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
