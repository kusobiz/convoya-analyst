/* lifecycle.js — Product Lifecycle tab: New vs Aging overview, cohort curves, cohort table,
   Agent Focus snapshot. Reuses dashboard.js's shared MultiSelect, View Lots drill-down
   machinery (fetchLotsDetail/renderDrillDownPanel/Lot Type filter), and chart helpers. */

const lifecycleFiltersUI = {};
let lifecycleAgeMonths = 6;
let lifecycleFiltersReady = null;
let lifecycleLoaded = false;
let lastLifecycleCohortRows = [];
let lifecycleCohortSortState = { key: 'balanceValue', dir: 'desc' };

const LIFECYCLE_COHORT_PAGE_SIZES = [10, 25, 50];
let lifecycleCohortPageSize = 10;

let lastLifecycleNewZoneRows = [];
let lifecycleNewZonesSortState = { key: 'totalUnitsLaunched', dir: 'desc' };
let lifecycleNewZonesPageSize = 25;

// The Cohort Table has its own decoupled Branch/Product Type/Status Flag filters — separate
// from lifecycleFiltersUI (which drives Overview/Curve/New Zones/Agent Focus) — same "own
// independent filters" pattern dashboard.js's Pivot Builder (pivotFiltersUI) already uses.
// New / Aging Threshold (lifecycleAgeMonths) is still shared, since Status Flag's "New" bucket
// is defined relative to that same tab-wide age window.
const cohortFiltersUI = {};
let lifecycleCohortFiltersReady = null;
let lastLifecycleStatusFlagSummary = [];
const LIFECYCLE_STATUS_FLAGS = ['New', 'Steady', 'Slowing', 'Stagnant', 'Sold Out'];
const LIFECYCLE_STATUS_FLAG_CARD_CLASS = {
  New: 'status-flag-card--blue', Steady: 'status-flag-card--green', Slowing: 'status-flag-card--amber',
  Stagnant: 'status-flag-card--red', 'Sold Out': 'status-flag-card--grey',
};

// Peer Benchmark (item 3): a second, independent summary/filter dimension alongside Status
// Flag — same card-summary/filter/badge machinery, just its own state and color mapping.
let lastLifecyclePeerComparisonSummary = [];
const LIFECYCLE_PEER_COMPARISONS = ['Above Peers', 'On Par', 'Below Peers', 'Insufficient Data'];
const LIFECYCLE_PEER_COMPARISON_CARD_CLASS = {
  'Above Peers': 'status-flag-card--green', 'On Par': 'status-flag-card--grey',
  'Below Peers': 'status-flag-card--red', 'Insufficient Data': 'status-flag-card--lightgrey',
};
const LIFECYCLE_PEER_COMPARISON_BADGE_CLASS = {
  'Above Peers': 'badge--green', 'On Par': 'badge--grey',
  'Below Peers': 'badge--red', 'Insufficient Data': 'badge--lightgrey',
};

// Suite No is meaningfully populated (>50%) for only NV Niche (68.3%) and NV Baby Paradise
// (100%) — routes/lifecycle.js's SUITE_GROUPED_TYPES promotes those into the cohort key itself
// (each row already IS a Zone+Suite combination), so their "+" skips straight to Level
// Breakdown. NV Pedestal (32.2%) and NV Pet Niche (19.3%) stay Zone-only cohorts but still
// offer Suite Breakdown as a drill-down step; NV EBL (~0%) gets neither.
const LIFECYCLE_SUITE_GROUPED_TYPES = ['NV Niche', 'NV Baby Paradise'];
const LIFECYCLE_SUITE_BREAKDOWN_TYPES = ['NV Pedestal', 'NV Pet Niche'];

async function fetchLifecycleJSON(path, body) {
  const res = await fetch(`/api/lifecycle/${path}`, {
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

function getLifecycleFilterValues() {
  return {
    branch:      lifecycleFiltersUI.branch.getValues(),
    productType: lifecycleFiltersUI.productType.getValues(),
    ageMonths:   lifecycleAgeMonths,
  };
}

// A flat 2-field cascade (Branch -> Product Type), both defaulting to "All" selected on load
// (see initLifecycleFilters), consistent with Pricing Intelligence's own default-to-All. Level
// used to be a third field here, but it's now purely a drill-down detail (Level Breakdown / a
// Cohort Table row's own Suite No column — see item 2 of the restructuring), never a top-level
// filter — keeping one here would be stale and misleading now that cohorts group by Zone (or
// Zone+Suite), not Level.
async function refreshLifecycleCascade() {
  const filters = getLifecycleFilterValues();
  try {
    const result = await fetchLifecycleJSON('filters', filters);
    lifecycleFiltersUI.branch.setOptions(result.branches || []);
    lifecycleFiltersUI.productType.setOptions(result.productTypes || []);
  } catch (e) {
    console.error('[lifecycle] refreshLifecycleCascade failed:', e);
  }
}

function initLifecycleFilters() {
  lifecycleFiltersUI.branch = new MultiSelect('lifecycleBranch', {
    placeholder: 'All branches',
    onChange: refreshLifecycleCascade,
  });
  lifecycleFiltersUI.productType = new MultiSelect('lifecycleProductType', {
    placeholder: 'All product types',
    displayFn: stripNVPrefix,
    onChange: refreshLifecycleCascade,
  });

  const ageToggle = document.getElementById('lifecycleAgeToggle');
  ageToggle?.addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab[data-age-months]');
    if (!btn || btn.classList.contains('active')) return;
    ageToggle.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    lifecycleAgeMonths = Number(btn.dataset.ageMonths);
  });

  // Default every value selected (not empty) so the tab is immediately useful on open —
  // matches Pricing Intelligence's initPricingFilters() exactly.
  lifecycleFiltersReady = fetchLifecycleJSON('filters', {}).then(({ branches, productTypes }) => {
    lifecycleFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    lifecycleFiltersUI.productType.setOptions(productTypes || [], { selectAll: true });
  }).catch(e => console.error('[lifecycle] initLifecycleFilters failed:', e));
}

// Branch changing narrows which Product Types are offered (same cascade shape as the tab-wide
// filters above), then immediately re-renders the Cohort Table section with the new scope.
async function refreshLifecycleCohortProductTypeCascade() {
  const branch = cohortFiltersUI.branch.getValues();
  try {
    const { productTypes } = await fetchLifecycleJSON('filters', { branch });
    cohortFiltersUI.productType.setOptions(productTypes || [], { selectAll: true });
  } catch (e) {
    console.error('[lifecycle] refreshLifecycleCohortProductTypeCascade failed:', e);
  }
}

function initLifecycleCohortFilters() {
  cohortFiltersUI.branch = new MultiSelect('cohortBranch', {
    placeholder: 'All branches',
    onChange: () => { refreshLifecycleCohortProductTypeCascade().then(renderLifecycleCohortSection); },
  });
  cohortFiltersUI.productType = new MultiSelect('cohortProductType', {
    placeholder: 'All product types',
    displayFn: stripNVPrefix,
    onChange: renderLifecycleCohortSection,
  });
  cohortFiltersUI.statusFlag = new MultiSelect('cohortStatusFlag', {
    placeholder: 'All status flags',
    onChange: renderLifecycleCohortSection,
  });
  // Status Flag and Peer Comparison are both fixed enums, not DB-driven — set once, no
  // fetch/cascade needed.
  cohortFiltersUI.statusFlag.setOptions(LIFECYCLE_STATUS_FLAGS, { selectAll: true });

  cohortFiltersUI.peerComparison = new MultiSelect('cohortPeerComparison', {
    placeholder: 'All peer comparisons',
    onChange: renderLifecycleCohortSection,
  });
  cohortFiltersUI.peerComparison.setOptions(LIFECYCLE_PEER_COMPARISONS, { selectAll: true });

  lifecycleCohortFiltersReady = fetchLifecycleJSON('filters', {}).then(({ branches, productTypes }) => {
    cohortFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    cohortFiltersUI.productType.setOptions(productTypes || [], { selectAll: true });
  }).catch(e => console.error('[lifecycle] initLifecycleCohortFilters failed:', e));
}

// ── Section 1: New vs Aging Overview ──
async function renderLifecycleOverview(filters) {
  try {
    const d = await fetchLifecycleJSON('overview', filters);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpi-lifecycleAgingBalanceValue', myr(d.agingBalanceValue));
    set('kpi-lifecycleAgingUnits', fmt(d.agingUnits));
    set('kpi-lifecyclePctAging', pct(d.pctOfTotalBalanceThatIsAging));
    set('kpi-lifecycleNewBalanceValue', myr(d.newBalanceValue));
    set('kpi-lifecycleNewUnits', fmt(d.newUnits));
    set('kpi-lifecycleNewSellThrough', pct(d.newSellThroughPct));
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] renderLifecycleOverview failed:', err);
  }
}

// ── Section 1b: Newly Launched Zones ──
const LIFECYCLE_NEW_ZONES_COLUMNS = [
  { key: 'branch',             label: 'Branch',                  type: 'text' },
  { key: 'productType',        label: 'Product Type',            type: 'text',   render: r => stripNVPrefix(r.productType) },
  { key: 'zone',                label: 'Zone',                    type: 'text' },
  { key: 'totalUnitsLaunched', label: 'Total Units Launched',    type: 'number', render: r => fmt(r.totalUnitsLaunched) },
  { key: 'ageMonths',          label: 'Age (months)',            type: 'number', render: r => fmt(r.ageMonths) },
  { key: 'balanceUnits',       label: 'Balance Units',           type: 'number', render: r => fmt(r.balanceUnits) },
  { key: 'balanceValue',       label: 'Balance Value',           type: 'number', render: r => myr(r.balanceValue) },
  { key: 'sellThroughPct',     label: 'Sell-Through % So Far',   type: 'number', render: r => pct(r.sellThroughPct) },
];

function renderLifecycleNewZonesHead() {
  const headRow = document.getElementById('lifecycleNewZonesHeadRow');
  if (!headRow) return;
  headRow.innerHTML = LIFECYCLE_NEW_ZONES_COLUMNS.map(col => {
    const isSorted = lifecycleNewZonesSortState.key === col.key;
    const arrow = isSorted ? `<span class="sort-arrow">${lifecycleNewZonesSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th${isSorted ? ' sorted' : ''}" data-lifecycle-newzone-key="${col.key}">${col.label}${arrow}</th>`;
  }).join('') + '<th></th>';
}

function renderLifecycleNewZonesToolbar(totalCount) {
  const el = document.getElementById('lifecycleNewZonesToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const shown = lifecycleNewZonesPageSize === 'all' ? totalCount : Math.min(lifecycleNewZonesPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(shown)} of ${fmt(totalCount)} zones</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${LIFECYCLE_COHORT_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${lifecycleNewZonesPageSize === n ? ' active' : ''}" data-lifecycle-newzone-page="${n}">${n}</button>`).join('')}
        <button type="button" class="drill-page-btn${lifecycleNewZonesPageSize === 'all' ? ' active' : ''}" data-lifecycle-newzone-page="all">Show All</button>
      </div>
    </div>`;
}

// Each row is Branch+ProductType+Zone-pinned, so its own View Lots + Lot Type filter narrows
// straight to that exact zone's OPEN lots — same reasoning as the Cohort Table's rows.
function renderLifecycleNewZonesBody() {
  const tbody = document.getElementById('lifecycleNewZonesBody');
  if (!tbody) return;
  const sorted = sortByKey(lastLifecycleNewZoneRows, lifecycleNewZonesSortState);
  const colCount = LIFECYCLE_NEW_ZONES_COLUMNS.length + 1;

  renderLifecycleNewZonesToolbar(sorted.length);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No newly launched zones match these filters.</td></tr>`;
    return;
  }

  const rows = lifecycleNewZonesPageSize === 'all' ? sorted : sorted.slice(0, lifecycleNewZonesPageSize);

  tbody.innerHTML = rows.map(r => {
    const cells = LIFECYCLE_NEW_ZONES_COLUMNS.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('');
    const lotTypeFilter = renderLotTypeFilterHTML({ product: r.productType, branch: r.branch, priceRange: '', zone: r.zone });
    const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-lifecycle-newzone-lots"
      data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}"
      data-zone="${escapeHtml(r.zone)}">View Lots</button>`;
    return `<tr class="accordion-row">${cells}<td><div class="row-actions">${lotTypeFilter}${viewLotsBtn}</div></td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>`;
  }).join('');
}

async function renderLifecycleNewZonesSection(filters) {
  const tbody = document.getElementById('lifecycleNewZonesBody');
  if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const { rows } = await fetchLifecycleJSON('new-zones', filters);
    lastLifecycleNewZoneRows = rows || [];
    renderLifecycleNewZonesHead();
    renderLifecycleNewZonesBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] renderLifecycleNewZonesSection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

function onLifecycleNewZonesSortClick(key) {
  lifecycleNewZonesSortState = lifecycleNewZonesSortState.key === key
    ? { key, dir: lifecycleNewZonesSortState.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };
  renderLifecycleNewZonesHead();
  renderLifecycleNewZonesBody();
}

async function loadLifecycleNewZoneLotsContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const lotType = lotTypeFilterValues(btn.closest('tr'));
    const filters = {
      materialType: [btn.dataset.product],
      branch: [btn.dataset.branch],
      zone: [btn.dataset.zone],
      status: ['OPEN'],
      lotType,
    };
    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.product))} (${fmt(totalQty)} units) · ${escapeHtml(btn.dataset.branch)} · Zone ${escapeHtml(btn.dataset.zone)} — Unsold Lots`,
      filenameBase: `lifecycle_newzone_lots_${sanitizeForFilename(btn.dataset.product)}_${sanitizeForFilename(btn.dataset.branch)}_${sanitizeForFilename(btn.dataset.zone)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] loadLifecycleNewZoneLotsContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

async function toggleLifecycleNewZoneLots(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = 'View Lots'; return; }

  detailRow.style.display = '';
  btn.textContent = 'Hide Lots';
  const content = detailRow.querySelector('[data-drill-content]');
  if (content.dataset.loaded === 'true') return;
  await loadLifecycleNewZoneLotsContent(btn, content);
}

function exportLifecycleNewZonesExcel() {
  if (!lastLifecycleNewZoneRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const header = LIFECYCLE_NEW_ZONES_COLUMNS.map(c => c.label);
  const sorted = sortByKey(lastLifecycleNewZoneRows, lifecycleNewZonesSortState);
  const aoa = [header, ...sorted.map(r => [
    r.branch, stripNVPrefix(r.productType), r.zone, r.totalUnitsLaunched, r.ageMonths,
    r.balanceUnits, Number(r.balanceValue.toFixed(2)), Number(r.sellThroughPct.toFixed(1)),
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'New Zones');
  XLSX.writeFile(wb, `product_lifecycle_new_zones_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Section 2: Lifecycle Curve ──
async function renderLifecycleCurveChart(filters) {
  const emptyEl = document.getElementById('lifecycleCurveEmpty');
  try {
    const { cohorts } = await fetchLifecycleJSON('curve', filters);
    destroyChart('lifecycleCurve');
    const ctx = document.getElementById('chartLifecycleCurve');
    if (!ctx) return;

    if (!cohorts.length) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const datasets = cohorts.map((c, i) => ({
      label: c.cohortLabel,
      data: c.points.map(p => ({ x: p.monthsSinceLaunch, y: p.cumulativeSellThroughPct })),
      borderColor: veloColor(i),
      backgroundColor: veloColor(i),
      borderWidth: 2,
      pointRadius: 2,
      tension: 0.15,
      fill: false,
    }));

    charts.lifecycleCurve = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: { type: 'linear', min: 0, max: 36, title: { display: true, text: 'Months Since Launch' } },
          y: { min: 0, max: 100, title: { display: true, text: 'Cumulative Sell-Through %' }, ticks: { callback: v => v + '%' } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)}% at month ${item.parsed.x}`,
            },
          },
        },
      },
    });
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] renderLifecycleCurveChart failed:', err);
  }
}

// ── Section 3: Cohort Table ──
const LIFECYCLE_COHORT_COLUMNS = [
  { key: 'branch',                label: 'Branch',         type: 'text' },
  { key: 'productType',           label: 'Product Type',   type: 'text',   render: r => stripNVPrefix(r.productType) },
  { key: 'zone',                  label: 'Zone',            type: 'text' },
  { key: 'suiteNo',               label: 'Suite No',        type: 'text',   render: r => r.suiteNo || '—' },
  { key: 'cohortPeriod',          label: 'Cohort Period',   type: 'text' },
  { key: 'ageMonthsNow',          label: 'Age (months)',    type: 'number', render: r => fmt(r.ageMonthsNow) },
  { key: 'totalUnits',            label: 'Total Units',     type: 'number', render: r => fmt(r.totalUnits) },
  { key: 'balanceUnits',          label: 'Balance Units',   type: 'number', render: r => fmt(r.balanceUnits) },
  { key: 'balanceValue',          label: 'Balance Value',   type: 'number', render: r => myr(r.balanceValue) },
  { key: 'avgPrice',              label: 'Avg Price',       type: 'number', render: r => myr(r.avgPrice) },
  { key: 'overallSellThroughPct', label: 'Sell-Through %',  type: 'number', render: r => pct(r.overallSellThroughPct) },
  { key: 'statusFlag',            label: 'Status Flag',     type: 'text',   render: r => `<span class="badge ${lifecycleStatusBadgeClass(r.statusFlag)}">${r.statusFlag}</span>` },
  { key: 'peerComparison',        label: 'Peer Benchmark',  type: 'text',   render: r => `<span class="badge ${lifecyclePeerComparisonBadgeClass(r.peerComparison)}" title="${r.peerBenchmarkPct !== null ? `Peers: ${pct(r.peerBenchmarkPct)}` : 'Fewer than 3 comparable peer cohorts'}">${r.peerComparison}</span>` },
];

function lifecycleStatusBadgeClass(flag) {
  return {
    New: 'badge--blue', Steady: 'badge--green', Slowing: 'badge--amber',
    Stagnant: 'badge--red', 'Sold Out': 'badge--grey',
  }[flag] || 'badge--navy';
}

function lifecyclePeerComparisonBadgeClass(peerComparison) {
  return LIFECYCLE_PEER_COMPARISON_BADGE_CLASS[peerComparison] || 'badge--navy';
}

function renderLifecycleCohortsHead() {
  const headRow = document.getElementById('lifecycleCohortsHeadRow');
  if (!headRow) return;
  headRow.innerHTML = LIFECYCLE_COHORT_COLUMNS.map(col => {
    const isSorted = lifecycleCohortSortState.key === col.key;
    const arrow = isSorted ? `<span class="sort-arrow">${lifecycleCohortSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th class="sortable-th${isSorted ? ' sorted' : ''}" data-lifecycle-key="${col.key}">${col.label}${arrow}</th>`;
  }).join('') + '<th></th>';
}

// Each row is already Branch+ProductType+Level+CohortPeriod-pinned, so its own View Lots +
// Lot Type filter narrows straight to that exact cohort's OPEN lots — no intermediate
// breakdown step, same reasoning as Lot Drill-Down's Lot Results rows. Branch here IS a real
// single value per row, so it's baked into the Lot Type filter's data attribute (same as
// Pricing's Zone Breakdown), unlike Lot Results where a row could span several branches.
function renderLifecycleCohortsToolbar(totalCount) {
  const el = document.getElementById('lifecycleCohortsToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const shown = lifecycleCohortPageSize === 'all' ? totalCount : Math.min(lifecycleCohortPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(shown)} of ${fmt(totalCount)} cohorts</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${LIFECYCLE_COHORT_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${lifecycleCohortPageSize === n ? ' active' : ''}" data-lifecycle-page="${n}">${n}</button>`).join('')}
        <button type="button" class="drill-page-btn${lifecycleCohortPageSize === 'all' ? ' active' : ''}" data-lifecycle-page="all">Show All</button>
      </div>
    </div>`;
}

function renderLifecycleCohortsBody() {
  const tbody = document.getElementById('lifecycleCohortsBody');
  if (!tbody) return;
  const sorted = sortByKey(lastLifecycleCohortRows, lifecycleCohortSortState);
  const colCount = LIFECYCLE_COHORT_COLUMNS.length + 1;

  renderLifecycleCohortsToolbar(sorted.length);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No cohorts match these filters.</td></tr>`;
    return;
  }

  const rows = lifecycleCohortPageSize === 'all' ? sorted : sorted.slice(0, lifecycleCohortPageSize);

  tbody.innerHTML = rows.map(r => {
    const cells = LIFECYCLE_COHORT_COLUMNS.map(col => `<td>${col.render ? col.render(r) : (r[col.key] ?? '')}</td>`).join('');
    const lotTypeFilter = renderLotTypeFilterHTML({ product: r.productType, branch: r.branch, priceRange: '', zone: r.zone });

    // r.suiteGrouped rows (NV Niche / NV Baby Paradise) already have Suite No baked into their
    // own identity (see LIFECYCLE_SUITE_GROUPED_TYPES / routes/lifecycle.js's
    // buildCohortsFromRows) — both View Lots and the "+" expand scope straight to that exact
    // Zone+Suite (r.suiteNo may be '', the "no Suite No data" bucket — still a real, precise
    // scope, just an empty-string sentinel routes/lifecycle.js and routes/lots.js both
    // special-case as "blank Suite No" rather than "no Suite No filter at all").
    const suiteNoAttr = r.suiteGrouped ? ` data-suite-no="${escapeHtml(r.suiteNo ?? '')}"` : '';
    const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-lifecycle-lots"
      data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}"
      data-zone="${escapeHtml(r.zone)}" data-cohort-period="${escapeHtml(r.cohortPeriod)}"${suiteNoAttr}>View Lots</button>`;

    // Level/Suite breakdowns are only meaningful for structured product types (flat land has no
    // Level No/Suite No values to break down) — matches STRUCTURED_MATERIAL_TYPES (dashboard.js),
    // the same list the rest of the app uses to classify a Material Type as structured vs. flat.
    // Three shapes: (1) r.suiteGrouped rows skip straight to Level Breakdown, scoped to their
    // own Zone+Suite (no separate Suite Breakdown step — Suite No is already the row's own
    // identity); (2) LIFECYCLE_SUITE_BREAKDOWN_TYPES (Pedestal/Pet Niche) get Suite Breakdown as
    // the first "+" step, with Level Breakdown nested one level deeper inside each suite row
    // (see renderLifecycleSuiteBreakdownHTML); (3) NV EBL (~0% Suite No) and any other
    // structured type go straight to an unscoped, whole-zone Level Breakdown.
    const isStructured = STRUCTURED_MATERIAL_TYPES.includes(r.productType);
    let expandBtn = '';
    let expandDetailRow = '';
    if (r.suiteGrouped) {
      expandBtn = `<button type="button" class="btn-expand" data-action="toggle-lifecycle-level-breakdown"
        data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}"
        data-zone="${escapeHtml(r.zone)}" data-cohort-period="${escapeHtml(r.cohortPeriod)}"${suiteNoAttr} aria-label="Level breakdown">+</button>`;
      expandDetailRow = `<tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-level-breakdown-content></div></td></tr>`;
    } else if (LIFECYCLE_SUITE_BREAKDOWN_TYPES.includes(r.productType)) {
      expandBtn = `<button type="button" class="btn-expand" data-action="toggle-lifecycle-suite-breakdown"
        data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}"
        data-zone="${escapeHtml(r.zone)}" data-cohort-period="${escapeHtml(r.cohortPeriod)}" aria-label="Suite breakdown">+</button>`;
      expandDetailRow = `<tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-suite-breakdown-content></div></td></tr>`;
    } else if (isStructured) {
      expandBtn = `<button type="button" class="btn-expand" data-action="toggle-lifecycle-level-breakdown"
        data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}"
        data-zone="${escapeHtml(r.zone)}" data-cohort-period="${escapeHtml(r.cohortPeriod)}" aria-label="Level breakdown">+</button>`;
      expandDetailRow = `<tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-level-breakdown-content></div></td></tr>`;
    }

    return `<tr class="accordion-row">${cells}<td><div class="row-actions">${lotTypeFilter}${viewLotsBtn}${expandBtn}</div></td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>
      ${expandDetailRow}`;
  }).join('');
}

// Status Flag summary cards — one per flag, count + Balance Value under the current
// Branch/Product Type scope (server-computed ignoring the Status Flag filter itself, see
// getLifecycleCohortTable, so all 5 cards always show real numbers). Clicking a card jumps the
// Status Flag filter straight to that one value; a currently-active single-flag selection gets
// a highlighted card. The "Clear" tile resets back to all 5 flags (i.e. no filter).
function renderLifecycleStatusFlagCards() {
  const el = document.getElementById('lifecycleStatusFlagCards');
  if (!el || !cohortFiltersUI.statusFlag) return;
  const activeValues = cohortFiltersUI.statusFlag.getValues();
  const activeFlag = activeValues.length === 1 ? activeValues[0] : null;

  const cards = LIFECYCLE_STATUS_FLAGS.map(flag => {
    const stat = lastLifecycleStatusFlagSummary.find(s => s.flag === flag) || { count: 0, balanceValue: 0 };
    const colorCls = LIFECYCLE_STATUS_FLAG_CARD_CLASS[flag];
    const activeCls = activeFlag === flag ? ' status-flag-card--active' : '';
    return `<button type="button" class="status-flag-card ${colorCls}${activeCls}" data-status-flag-card="${escapeHtml(flag)}">
      <div class="status-flag-card-count">${fmt(stat.count)}</div>
      <div class="status-flag-card-label">${escapeHtml(flag)}</div>
      <div class="status-flag-card-value">${myr(stat.balanceValue)}</div>
    </button>`;
  }).join('');

  const isCleared = activeValues.length === 0 || activeValues.length === LIFECYCLE_STATUS_FLAGS.length;
  const clearBtn = `<button type="button" class="status-flag-clear-btn${isCleared ? ' status-flag-clear-btn--active' : ''}" data-status-flag-clear>
    Clear<span class="status-flag-clear-sub">Show All</span></button>`;

  el.innerHTML = cards + clearBtn;
}

// Peer Comparison summary cards — same shape as the Status Flag ones (item 3's "4th dimension"
// ask), computed by the backend from whatever the Status Flag filter has already narrowed to
// (so the two summary rows read as a consistent pair) but before the Peer Comparison filter
// itself, so all 4 cards always show real numbers regardless of which value is selected.
function renderLifecyclePeerComparisonCards() {
  const el = document.getElementById('lifecyclePeerComparisonCards');
  if (!el || !cohortFiltersUI.peerComparison) return;
  const activeValues = cohortFiltersUI.peerComparison.getValues();
  const activeValue = activeValues.length === 1 ? activeValues[0] : null;

  const cards = LIFECYCLE_PEER_COMPARISONS.map(pc => {
    const stat = lastLifecyclePeerComparisonSummary.find(s => s.peerComparison === pc) || { count: 0, balanceValue: 0 };
    const colorCls = LIFECYCLE_PEER_COMPARISON_CARD_CLASS[pc];
    const activeCls = activeValue === pc ? ' status-flag-card--active' : '';
    return `<button type="button" class="status-flag-card ${colorCls}${activeCls}" data-peer-comparison-card="${escapeHtml(pc)}">
      <div class="status-flag-card-count">${fmt(stat.count)}</div>
      <div class="status-flag-card-label">${escapeHtml(pc)}</div>
      <div class="status-flag-card-value">${myr(stat.balanceValue)}</div>
    </button>`;
  }).join('');

  const isCleared = activeValues.length === 0 || activeValues.length === LIFECYCLE_PEER_COMPARISONS.length;
  const clearBtn = `<button type="button" class="status-flag-clear-btn${isCleared ? ' status-flag-clear-btn--active' : ''}" data-peer-comparison-clear>
    Clear<span class="status-flag-clear-sub">Show All</span></button>`;

  el.innerHTML = cards + clearBtn;
}

async function renderLifecycleCohortSection() {
  const filters = {
    branch: cohortFiltersUI.branch.getValues(),
    productType: cohortFiltersUI.productType.getValues(),
    statusFlag: cohortFiltersUI.statusFlag.getValues(),
    peerComparison: cohortFiltersUI.peerComparison.getValues(),
    ageMonths: lifecycleAgeMonths,
  };
  const tbody = document.getElementById('lifecycleCohortsBody');
  if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const { rows, statusFlagSummary, peerComparisonSummary } = await fetchLifecycleJSON('cohort-table', filters);
    lastLifecycleCohortRows = rows || [];
    lastLifecycleStatusFlagSummary = statusFlagSummary || [];
    lastLifecyclePeerComparisonSummary = peerComparisonSummary || [];
    renderLifecycleStatusFlagCards();
    renderLifecyclePeerComparisonCards();
    renderLifecycleCohortsHead();
    renderLifecycleCohortsBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] renderLifecycleCohortSection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

function onLifecycleCohortSortClick(key) {
  lifecycleCohortSortState = lifecycleCohortSortState.key === key
    ? { key, dir: lifecycleCohortSortState.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };
  renderLifecycleCohortsHead();
  renderLifecycleCohortsBody();
}

// routes/lots.js's queryLotsDetail accepts an optional cohortPeriod ("YYYY-Qn") filter added
// specifically for this — resolves to that quarter's exact date range on Lot Create On, so
// this reuses the real /api/lots infrastructure rather than showing every OPEN lot for the
// branch/product/zone regardless of which quarter launched it.
async function loadLifecycleCohortLotsContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const lotType = lotTypeFilterValues(btn.closest('tr'));
    const filters = {
      materialType: [btn.dataset.product],
      branch: [btn.dataset.branch],
      zone: [btn.dataset.zone],
      cohortPeriod: btn.dataset.cohortPeriod,
      status: ['OPEN'],
      lotType,
    };
    // Present (possibly '') only for suiteGrouped cohorts — see renderLifecycleCohortsBody —
    // so this stays exactly the row's own scope rather than the whole zone across every suite.
    if (btn.dataset.suiteNo !== undefined) filters.suiteNo = [btn.dataset.suiteNo];
    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    const suiteLabel = btn.dataset.suiteNo !== undefined ? ` · Suite ${escapeHtml(btn.dataset.suiteNo || '(none)')}` : '';
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.product))} (${fmt(totalQty)} units) · ${escapeHtml(btn.dataset.branch)} · Zone ${escapeHtml(btn.dataset.zone)}${suiteLabel} · ${escapeHtml(btn.dataset.cohortPeriod)} — Unsold Lots`,
      filenameBase: `lifecycle_lots_${sanitizeForFilename(btn.dataset.product)}_${sanitizeForFilename(btn.dataset.branch)}_${sanitizeForFilename(btn.dataset.cohortPeriod)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] loadLifecycleCohortLotsContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

// Level Breakdown — reached either directly from a Cohort Table row's "+" (NV EBL, which has
// no Suite No data — see hasSuiteBreakdown above) or nested one level deeper inside a Suite
// Breakdown row (every other structured type). Scoped to the exact Branch+ProductType+Zone+
// CohortPeriod, same grain View Lots drills into, plus an optional Suite No when reached via a
// suite row rather than the whole zone — just aggregated by Level instead of listing lots.
const LIFECYCLE_LEVEL_BREAKDOWN_COLUMNS = [
  { key: 'level',         label: 'Level',          render: r => r.level },
  { key: 'totalUnits',    label: 'Units',          render: r => fmt(r.totalUnits) },
  { key: 'balanceUnits',  label: 'Balance Units',  render: r => fmt(r.balanceUnits) },
  { key: 'balanceValue',  label: 'Balance Value',  render: r => myr(r.balanceValue) },
  { key: 'sellThroughPct', label: 'Sell-Through %', render: r => pct(r.sellThroughPct) },
];

function renderLifecycleLevelBreakdownHTML(rows) {
  if (!rows.length) return `<div class="drilldown-empty">No level data for this zone-cohort.</div>`;
  const head = LIFECYCLE_LEVEL_BREAKDOWN_COLUMNS.map(c => `<th>${c.label}</th>`).join('');
  const body = rows.map(r =>
    `<tr>${LIFECYCLE_LEVEL_BREAKDOWN_COLUMNS.map(c => `<td>${c.render(r)}</td>`).join('')}</tr>`).join('');
  return `<table class="drilldown-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// btn.dataset.suiteNo is only present when this was reached via a Suite Breakdown row's own "+"
// (see renderLifecycleSuiteBreakdownHTML) — absent for the direct EBL "+" and for the "whole
// zone" fallback button, both of which want the unscoped, all-suites level breakdown.
async function loadLifecycleLevelBreakdownContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const filters = {
      branch: [btn.dataset.branch],
      productType: [btn.dataset.product],
      zone: [btn.dataset.zone],
      cohortPeriod: btn.dataset.cohortPeriod,
    };
    if (btn.dataset.suiteNo !== undefined) filters.suiteNo = [btn.dataset.suiteNo];
    const { rows } = await fetchLifecycleJSON('level-breakdown', filters);
    content.innerHTML = renderLifecycleLevelBreakdownHTML(rows || []);
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] loadLifecycleLevelBreakdownContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

// The Level Breakdown detail row is always the SECOND accordion-detail sibling after the main
// row (View Lots' detail row is always the first — see renderLifecycleCohortsBody), so this
// hops one sibling further than toggleLifecycleCohortLots. Only reachable via the "+" button,
// which only renders directly on the Cohort Table row for NV EBL (no Suite Breakdown step).
async function toggleLifecycleLevelBreakdown(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = '+'; btn.setAttribute('aria-label', 'Level breakdown'); return; }

  detailRow.style.display = '';
  btn.textContent = '−';
  btn.setAttribute('aria-label', 'Hide level breakdown');
  const content = detailRow.querySelector('[data-level-breakdown-content]');
  if (content.dataset.loaded === 'true') return;
  await loadLifecycleLevelBreakdownContent(btn, content);
}

// Suite Breakdown — the Cohort Table row's "+" expand for structured types other than NV EBL
// (see hasSuiteBreakdown). Each suite row gets its own nested "+" leading to a Level Breakdown
// scoped to that exact Zone+Suite combination — same nested-accordion-within-a-rendered-
// subtable shape as dashboard.js's Zone Breakdown -> View Lots nesting.
const LIFECYCLE_SUITE_BREAKDOWN_COLUMNS = [
  { key: 'suiteNo',       label: 'Suite No',       render: r => r.suiteNo },
  { key: 'totalUnits',    label: 'Units',          render: r => fmt(r.totalUnits) },
  { key: 'balanceUnits',  label: 'Balance Units',  render: r => fmt(r.balanceUnits) },
  { key: 'balanceValue',  label: 'Balance Value',  render: r => myr(r.balanceValue) },
  { key: 'sellThroughPct', label: 'Sell-Through %', render: r => pct(r.sellThroughPct) },
];

// Some zone-cohorts of a partially-populated structured type (Pedestal/Pet Niche especially)
// have zero populated Suite No rows even though the product type as a whole has some — the
// fallback button lets the user still reach a (whole-zone, unscoped) Level Breakdown instead of
// dead-ending here.
function renderLifecycleSuiteBreakdownHTML(rows, ctx) {
  if (!rows.length) {
    return `<div class="drilldown-empty">No Suite No data for this zone-cohort.
      <button type="button" class="btn-view-lots" data-action="toggle-lifecycle-suite-fallback-levels"
        data-product="${escapeHtml(ctx.product)}" data-branch="${escapeHtml(ctx.branch)}"
        data-zone="${escapeHtml(ctx.zone)}" data-cohort-period="${escapeHtml(ctx.cohortPeriod)}">Show Level Breakdown for whole zone</button>
    </div>`;
  }
  const colCount = LIFECYCLE_SUITE_BREAKDOWN_COLUMNS.length + 1;
  const head = LIFECYCLE_SUITE_BREAKDOWN_COLUMNS.map(c => `<th>${c.label}</th>`).join('') + '<th></th>';
  const body = rows.map(r => {
    const cells = LIFECYCLE_SUITE_BREAKDOWN_COLUMNS.map(c => `<td>${c.render(r)}</td>`).join('');
    const levelBtn = `<button type="button" class="btn-expand" data-action="toggle-lifecycle-suite-level-breakdown"
      data-product="${escapeHtml(ctx.product)}" data-branch="${escapeHtml(ctx.branch)}"
      data-zone="${escapeHtml(ctx.zone)}" data-cohort-period="${escapeHtml(ctx.cohortPeriod)}"
      data-suite-no="${escapeHtml(r.suiteNo)}" aria-label="Level breakdown">+</button>`;
    return `<tr class="accordion-row">${cells}<td>${levelBtn}</td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-level-breakdown-content></div></td></tr>`;
  }).join('');
  return `<table class="drilldown-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function loadLifecycleSuiteBreakdownContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const { rows } = await fetchLifecycleJSON('suite-breakdown', {
      branch: [btn.dataset.branch],
      productType: [btn.dataset.product],
      zone: [btn.dataset.zone],
      cohortPeriod: btn.dataset.cohortPeriod,
    });
    const ctx = { product: btn.dataset.product, branch: btn.dataset.branch, zone: btn.dataset.zone, cohortPeriod: btn.dataset.cohortPeriod };
    content.innerHTML = renderLifecycleSuiteBreakdownHTML(rows || [], ctx);
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] loadLifecycleSuiteBreakdownContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

// Top-level Cohort Table "+" for Suite Breakdown — same double-hop-sibling shape as
// toggleLifecycleLevelBreakdown (it occupies the same second-detail-row slot, just for the
// product types that get a Suite step instead of going straight to Level).
async function toggleLifecycleSuiteBreakdown(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = '+'; btn.setAttribute('aria-label', 'Suite breakdown'); return; }

  detailRow.style.display = '';
  btn.textContent = '−';
  btn.setAttribute('aria-label', 'Hide suite breakdown');
  const content = detailRow.querySelector('[data-suite-breakdown-content]');
  if (content.dataset.loaded === 'true') return;
  await loadLifecycleSuiteBreakdownContent(btn, content);
}

// Nested inside a rendered Suite Breakdown row — a plain single-sibling toggle since it's
// freshly-rendered local content, same as Zone Breakdown's nested View Lots toggle.
async function toggleLifecycleSuiteLevelBreakdown(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = '+'; btn.setAttribute('aria-label', 'Level breakdown'); return; }

  detailRow.style.display = '';
  btn.textContent = '−';
  btn.setAttribute('aria-label', 'Hide level breakdown');
  const content = detailRow.querySelector('[data-level-breakdown-content]');
  if (content.dataset.loaded === 'true') return;
  await loadLifecycleLevelBreakdownContent(btn, content);
}

// The "Show Level Breakdown for whole zone" fallback (empty Suite Breakdown case) replaces the
// Suite Breakdown panel's own content in place with the unscoped Level Breakdown — no extra
// accordion nesting needed since the panel is already open.
async function showLifecycleWholeZoneLevelBreakdown(btn) {
  const content = btn.closest('[data-suite-breakdown-content]');
  if (!content) return;
  await loadLifecycleLevelBreakdownContent(btn, content);
}

async function toggleLifecycleCohortLots(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = 'View Lots'; return; }

  detailRow.style.display = '';
  btn.textContent = 'Hide Lots';
  const content = detailRow.querySelector('[data-drill-content]');
  if (content.dataset.loaded === 'true') return;
  await loadLifecycleCohortLotsContent(btn, content);
}

function exportLifecycleCohortsExcel() {
  if (!lastLifecycleCohortRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const header = [...LIFECYCLE_COHORT_COLUMNS.map(c => c.label), 'Peer Benchmark %'];
  const sorted = sortByKey(lastLifecycleCohortRows, lifecycleCohortSortState);
  const aoa = [header, ...sorted.map(r => [
    r.branch, stripNVPrefix(r.productType), r.zone, r.suiteNo || '', r.cohortPeriod, r.ageMonthsNow,
    r.totalUnits, r.balanceUnits, Number(r.balanceValue.toFixed(2)), Number(r.avgPrice.toFixed(2)),
    Number(r.overallSellThroughPct.toFixed(1)), r.statusFlag, r.peerComparison,
    r.peerBenchmarkPct !== null ? Number(r.peerBenchmarkPct.toFixed(1)) : '',
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cohorts');
  XLSX.writeFile(wb, `product_lifecycle_cohorts_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Two tables share the Lot Type filter markup in this tab (Cohort Table + Newly Launched
// Zones) — resolves which row's View Lots button/loader a given filter instance belongs to,
// same pattern as dashboard.js's pricingLotTypeFilterOptionsFor.
function lifecycleLotTypeFilterOptionsFor(row) {
  if (row?.querySelector('button[data-action="toggle-lifecycle-newzone-lots"]')) {
    return { buttonSelector: 'button[data-action="toggle-lifecycle-newzone-lots"]', loader: loadLifecycleNewZoneLotsContent };
  }
  return { buttonSelector: 'button[data-action="toggle-lifecycle-lots"]', loader: loadLifecycleCohortLotsContent };
}

// Delegated listener for the Cohort Table's and Newly Launched Zones' sort/View Lots/Level
// Breakdown/Lot Type filter/pagination/export interactions — mirrors initLotResultsEvents()'s
// equivalent block for Lot Drill-Down.
function initLifecycleTabEvents() {
  const panel = document.getElementById('tab-lifecycle');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    if (handleDrillDownPaginationOrExport(e)) return;

    const cohortPageBtn = e.target.closest('button[data-lifecycle-page]');
    if (cohortPageBtn) {
      const raw = cohortPageBtn.dataset.lifecyclePage;
      lifecycleCohortPageSize = raw === 'all' ? 'all' : Number(raw);
      renderLifecycleCohortsBody();
      return;
    }

    const newZonePageBtn = e.target.closest('button[data-lifecycle-newzone-page]');
    if (newZonePageBtn) {
      const raw = newZonePageBtn.dataset.lifecycleNewzonePage;
      lifecycleNewZonesPageSize = raw === 'all' ? 'all' : Number(raw);
      renderLifecycleNewZonesBody();
      return;
    }

    const th = e.target.closest('th[data-lifecycle-key]');
    if (th) { onLifecycleCohortSortClick(th.dataset.lifecycleKey); return; }

    const newZoneTh = e.target.closest('th[data-lifecycle-newzone-key]');
    if (newZoneTh) { onLifecycleNewZonesSortClick(newZoneTh.dataset.lifecycleNewzoneKey); return; }

    const viewLotsBtn = e.target.closest('button[data-action="toggle-lifecycle-lots"]');
    if (viewLotsBtn) { toggleLifecycleCohortLots(viewLotsBtn); return; }

    const newZoneViewLotsBtn = e.target.closest('button[data-action="toggle-lifecycle-newzone-lots"]');
    if (newZoneViewLotsBtn) { toggleLifecycleNewZoneLots(newZoneViewLotsBtn); return; }

    const levelBreakdownBtn = e.target.closest('button[data-action="toggle-lifecycle-level-breakdown"]');
    if (levelBreakdownBtn) { toggleLifecycleLevelBreakdown(levelBreakdownBtn); return; }

    const suiteBreakdownBtn = e.target.closest('button[data-action="toggle-lifecycle-suite-breakdown"]');
    if (suiteBreakdownBtn) { toggleLifecycleSuiteBreakdown(suiteBreakdownBtn); return; }

    const suiteLevelBreakdownBtn = e.target.closest('button[data-action="toggle-lifecycle-suite-level-breakdown"]');
    if (suiteLevelBreakdownBtn) { toggleLifecycleSuiteLevelBreakdown(suiteLevelBreakdownBtn); return; }

    const suiteFallbackLevelsBtn = e.target.closest('button[data-action="toggle-lifecycle-suite-fallback-levels"]');
    if (suiteFallbackLevelsBtn) { showLifecycleWholeZoneLevelBreakdown(suiteFallbackLevelsBtn); return; }

    const statusFlagCardBtn = e.target.closest('button[data-status-flag-card]');
    if (statusFlagCardBtn) {
      cohortFiltersUI.statusFlag.setSelectedValues([statusFlagCardBtn.dataset.statusFlagCard]);
      renderLifecycleStatusFlagCards();
      renderLifecycleCohortSection();
      return;
    }

    const statusFlagClearBtn = e.target.closest('button[data-status-flag-clear]');
    if (statusFlagClearBtn) {
      cohortFiltersUI.statusFlag.setSelectedValues(LIFECYCLE_STATUS_FLAGS);
      renderLifecycleStatusFlagCards();
      renderLifecycleCohortSection();
      return;
    }

    const peerComparisonCardBtn = e.target.closest('button[data-peer-comparison-card]');
    if (peerComparisonCardBtn) {
      cohortFiltersUI.peerComparison.setSelectedValues([peerComparisonCardBtn.dataset.peerComparisonCard]);
      renderLifecyclePeerComparisonCards();
      renderLifecycleCohortSection();
      return;
    }

    const peerComparisonClearBtn = e.target.closest('button[data-peer-comparison-clear]');
    if (peerComparisonClearBtn) {
      cohortFiltersUI.peerComparison.setSelectedValues(LIFECYCLE_PEER_COMPARISONS);
      renderLifecyclePeerComparisonCards();
      renderLifecycleCohortSection();
      return;
    }

    const lotTypeCb = e.target.closest('[data-lot-type-filter] input[type="checkbox"]');
    if (lotTypeCb) {
      const details = lotTypeCb.closest('[data-lot-type-filter]');
      onLotTypeFilterChanged(details, lifecycleLotTypeFilterOptionsFor(details.closest('tr')));
      return;
    }

    const lotTypeSelectAll = e.target.closest('[data-lot-type-select-all]');
    if (lotTypeSelectAll) {
      const details = lotTypeSelectAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      onLotTypeFilterChanged(details, lifecycleLotTypeFilterOptionsFor(details.closest('tr')));
      return;
    }

    const lotTypeClearAll = e.target.closest('[data-lot-type-clear-all]');
    if (lotTypeClearAll) {
      const details = lotTypeClearAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      onLotTypeFilterChanged(details, lifecycleLotTypeFilterOptionsFor(details.closest('tr')));
      return;
    }
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

// ── Section 4: Agent Focus Snapshot ──
async function renderLifecycleAgentFocus(filters) {
  try {
    const d = await fetchLifecycleJSON('agent-focus', filters);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpi-lifecycleNewComboCount', fmt(d.newActiveComboCount));
    set('kpi-lifecycleNewComboSellThrough', pct(d.newAvgSellThroughPct));
    set('kpi-lifecycleAgingComboCount', fmt(d.agingActiveComboCount));
    set('kpi-lifecycleAgingComboSellThrough', pct(d.agingAvgSellThroughPct));
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] renderLifecycleAgentFocus failed:', err);
  }
}

// ── Orchestration ──
// renderLifecycleCohortSection() takes no filters arg — the Cohort Table reads its own
// decoupled cohortFiltersUI (see initLifecycleCohortFilters), not the tab-wide filters used by
// the other four sections here.
async function renderProductLifecycle() {
  const filters = getLifecycleFilterValues();
  await Promise.all([
    renderLifecycleOverview(filters),
    renderLifecycleNewZonesSection(filters),
    renderLifecycleCurveChart(filters),
    renderLifecycleCohortSection(),
    renderLifecycleAgentFocus(filters),
  ]);
}

// Branch/Product Type/Level default to "All" selected (see initLifecycleFilters), so the very
// first tab open can render everything immediately instead of an empty state.
async function onLifecycleTabActivated() {
  if (lifecycleLoaded) return;
  lifecycleLoaded = true;
  await Promise.all([lifecycleFiltersReady, lifecycleCohortFiltersReady]);
  renderProductLifecycle();
}

// Called by dashboard.js's global header control on every Lot Size change.
function refreshLifecycleForBigLotFilter() {
  if (lifecycleLoaded) renderProductLifecycle();
}

initLifecycleFilters();
initLifecycleCohortFilters();
initLifecycleTabEvents();

window.renderProductLifecycle = renderProductLifecycle;
window.exportLifecycleCohortsExcel = exportLifecycleCohortsExcel;
window.exportLifecycleNewZonesExcel = exportLifecycleNewZonesExcel;
window.onLifecycleTabActivated = onLifecycleTabActivated;
window.refreshLifecycleForBigLotFilter = refreshLifecycleForBigLotFilter;
