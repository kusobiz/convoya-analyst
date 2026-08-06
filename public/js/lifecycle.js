/* lifecycle.js — Product Lifecycle tab: New vs Aging overview, cohort curves, cohort table,
   Agent Focus snapshot. Reuses dashboard.js's shared MultiSelect, View Lots drill-down
   machinery (fetchLotsDetail/renderDrillDownPanel/Lot Type filter), and chart helpers. */

const lifecycleFiltersUI = {};
let lifecycleAgeMonths = 6;
let lifecycleFiltersReady = null;
let lifecycleLoaded = false;
let lastLifecycleCohortRows = [];
let lifecycleCohortSortState = { key: 'balanceValue', dir: 'desc' };

// Cohort rows are denser/more important per row than a raw lot listing (each one already
// summarizes a whole Branch+Product Type+Level+launch-quarter group), so this defaults to 25
// rather than the 10 used for lot lists (see DRILL_PAGE_SIZES in dashboard.js).
const LIFECYCLE_COHORT_PAGE_SIZES = [10, 25, 50];
let lifecycleCohortPageSize = 25;

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
    level:       lifecycleFiltersUI.level.getValues(),
    ageMonths:   lifecycleAgeMonths,
  };
}

// Level is scoped by Branch + Product Type only (no Zone/Suite/Section in this tab's filter
// set) — a flat 3-field cascade, all three defaulting to "All" selected on load (see
// initLifecycleFilters), consistent with Pricing Intelligence's own default-to-All.
async function refreshLifecycleCascade() {
  const filters = getLifecycleFilterValues();
  try {
    const result = await fetchLifecycleJSON('filters', filters);
    lifecycleFiltersUI.branch.setOptions(result.branches || []);
    lifecycleFiltersUI.productType.setOptions(result.productTypes || []);
    lifecycleFiltersUI.level.setOptions(result.levels || []);
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
  lifecycleFiltersUI.level = new MultiSelect('lifecycleLevel', {
    placeholder: 'All levels',
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
  lifecycleFiltersReady = fetchLifecycleJSON('filters', {}).then(({ branches, productTypes, levels }) => {
    lifecycleFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    lifecycleFiltersUI.productType.setOptions(productTypes || [], { selectAll: true });
    lifecycleFiltersUI.level.setOptions(levels || [], { selectAll: true });
  }).catch(e => console.error('[lifecycle] initLifecycleFilters failed:', e));
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
  { key: 'level',                 label: 'Level',           type: 'text' },
  { key: 'cohortPeriod',          label: 'Cohort Period',   type: 'text' },
  { key: 'ageMonthsNow',          label: 'Age (months)',    type: 'number', render: r => fmt(r.ageMonthsNow) },
  { key: 'totalUnits',            label: 'Total Units',     type: 'number', render: r => fmt(r.totalUnits) },
  { key: 'balanceUnits',          label: 'Balance Units',   type: 'number', render: r => fmt(r.balanceUnits) },
  { key: 'balanceValue',          label: 'Balance Value',   type: 'number', render: r => myr(r.balanceValue) },
  { key: 'avgPrice',              label: 'Avg Price',       type: 'number', render: r => myr(r.avgPrice) },
  { key: 'overallSellThroughPct', label: 'Sell-Through %',  type: 'number', render: r => pct(r.overallSellThroughPct) },
  { key: 'statusFlag',            label: 'Status Flag',     type: 'text',   render: r => `<span class="badge ${lifecycleStatusBadgeClass(r.statusFlag)}">${r.statusFlag}</span>` },
];

function lifecycleStatusBadgeClass(flag) {
  return {
    New: 'badge--blue', Steady: 'badge--green', Slowing: 'badge--amber',
    Stagnant: 'badge--red', 'Sold Out': 'badge--grey',
  }[flag] || 'badge--navy';
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
    const lotTypeFilter = renderLotTypeFilterHTML({ product: r.productType, branch: r.branch, priceRange: '' });
    const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-lifecycle-lots"
      data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}"
      data-level="${escapeHtml(r.level)}" data-cohort-period="${escapeHtml(r.cohortPeriod)}">View Lots</button>`;
    return `<tr class="accordion-row">${cells}<td><div class="row-actions">${lotTypeFilter}${viewLotsBtn}</div></td></tr>
      <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>`;
  }).join('');
}

async function renderLifecycleCohortTableSection(filters) {
  const tbody = document.getElementById('lifecycleCohortsBody');
  if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const { rows } = await fetchLifecycleJSON('cohort-table', filters);
    lastLifecycleCohortRows = rows || [];
    renderLifecycleCohortsHead();
    renderLifecycleCohortsBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] renderLifecycleCohortTableSection failed:', err);
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
// branch/product/level regardless of which quarter launched it.
async function loadLifecycleCohortLotsContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const lotType = lotTypeFilterValues(btn.closest('tr'));
    const filters = {
      materialType: [btn.dataset.product],
      branch: [btn.dataset.branch],
      level: [btn.dataset.level],
      cohortPeriod: btn.dataset.cohortPeriod,
      status: ['OPEN'],
      lotType,
    };
    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.product))} (${fmt(totalQty)} units) · ${escapeHtml(btn.dataset.branch)} · Level ${escapeHtml(btn.dataset.level)} · ${escapeHtml(btn.dataset.cohortPeriod)} — Unsold Lots`,
      filenameBase: `lifecycle_lots_${sanitizeForFilename(btn.dataset.product)}_${sanitizeForFilename(btn.dataset.branch)}_${sanitizeForFilename(btn.dataset.cohortPeriod)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[lifecycle] loadLifecycleCohortLotsContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
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

  const header = LIFECYCLE_COHORT_COLUMNS.map(c => c.label);
  const sorted = sortByKey(lastLifecycleCohortRows, lifecycleCohortSortState);
  const aoa = [header, ...sorted.map(r => [
    r.branch, stripNVPrefix(r.productType), r.level, r.cohortPeriod, r.ageMonthsNow,
    r.totalUnits, r.balanceUnits, Number(r.balanceValue.toFixed(2)), Number(r.avgPrice.toFixed(2)),
    Number(r.overallSellThroughPct.toFixed(1)), r.statusFlag,
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cohorts');
  XLSX.writeFile(wb, `product_lifecycle_cohorts_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Delegated listener for the Cohort Table's sort/View Lots/Lot Type filter/pagination/export
// interactions — mirrors initLotResultsEvents()'s equivalent block for Lot Drill-Down.
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

    const th = e.target.closest('th[data-lifecycle-key]');
    if (th) { onLifecycleCohortSortClick(th.dataset.lifecycleKey); return; }

    const viewLotsBtn = e.target.closest('button[data-action="toggle-lifecycle-lots"]');
    if (viewLotsBtn) { toggleLifecycleCohortLots(viewLotsBtn); return; }

    const lotTypeCb = e.target.closest('[data-lot-type-filter] input[type="checkbox"]');
    if (lotTypeCb) {
      onLotTypeFilterChanged(lotTypeCb.closest('[data-lot-type-filter]'), {
        buttonSelector: 'button[data-action="toggle-lifecycle-lots"]',
        loader: loadLifecycleCohortLotsContent,
      });
      return;
    }

    const lotTypeSelectAll = e.target.closest('[data-lot-type-select-all]');
    if (lotTypeSelectAll) {
      const details = lotTypeSelectAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
      onLotTypeFilterChanged(details, {
        buttonSelector: 'button[data-action="toggle-lifecycle-lots"]',
        loader: loadLifecycleCohortLotsContent,
      });
      return;
    }

    const lotTypeClearAll = e.target.closest('[data-lot-type-clear-all]');
    if (lotTypeClearAll) {
      const details = lotTypeClearAll.closest('[data-lot-type-filter]');
      details.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      onLotTypeFilterChanged(details, {
        buttonSelector: 'button[data-action="toggle-lifecycle-lots"]',
        loader: loadLifecycleCohortLotsContent,
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
async function renderProductLifecycle() {
  const filters = getLifecycleFilterValues();
  await Promise.all([
    renderLifecycleOverview(filters),
    renderLifecycleCurveChart(filters),
    renderLifecycleCohortTableSection(filters),
    renderLifecycleAgentFocus(filters),
  ]);
}

// Branch/Product Type/Level default to "All" selected (see initLifecycleFilters), so the very
// first tab open can render everything immediately instead of an empty state.
async function onLifecycleTabActivated() {
  if (lifecycleLoaded) return;
  lifecycleLoaded = true;
  await lifecycleFiltersReady;
  renderProductLifecycle();
}

// Called by dashboard.js's global header control on every Lot Size change.
function refreshLifecycleForBigLotFilter() {
  if (lifecycleLoaded) renderProductLifecycle();
}

initLifecycleFilters();
initLifecycleTabEvents();

window.renderProductLifecycle = renderProductLifecycle;
window.exportLifecycleCohortsExcel = exportLifecycleCohortsExcel;
window.onLifecycleTabActivated = onLifecycleTabActivated;
window.refreshLifecycleForBigLotFilter = refreshLifecycleForBigLotFilter;
