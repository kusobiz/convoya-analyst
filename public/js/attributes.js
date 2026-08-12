/* attributes.js — Product Attributes tab: Zone Tier Analysis, Level Size & Sell-Through
   Analysis, Dimension Consistency Check. Reuses dashboard.js's shared MultiSelect, View Lots
   drill-down machinery (fetchLotsDetail/renderDrillDownPanel), and chart helpers. Each section
   has its own independent filter set — same "own independent filters" pattern as
   routes/pricing.js's Pivot Builder / lifecycle.js's Cohort Table. */

const attrTierFiltersUI = {};
const attrLevelFiltersUI = {};
const attrDimFiltersUI = {};
let attributesLoaded = false;
let attrTierFiltersReady = null;
let attrLevelFiltersReady = null;
let attrDimFiltersReady = null;

async function fetchAttributesJSON(path, body) {
  const res = await fetch(`/api/attributes/${path}`, {
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

// Reuses the existing /api/lots cascade endpoints (branches/materialTypes/zones/lotTypes) —
// same filter data every other tab already draws from, rather than duplicating it here.
// buildArrayQuery (dashboard.js) handles array-valued params (repeated keys, as Express
// expects) and appends the global Big Lot filter — a plain `new URLSearchParams(obj)` would
// silently stringify array values wrong and skip the Big Lot filter entirely.
async function fetchLotFiltersJSON(query) {
  const res = await fetch(`/api/lots/filters?${buildArrayQuery(query)}`);
  if (!res.ok) throw new Error('Failed to load filters');
  return res.json();
}
async function fetchLotZonesJSON(query) {
  const res = await fetch(`/api/lots/zones?${buildArrayQuery(query)}`);
  if (!res.ok) throw new Error('Failed to load zones');
  return res.json();
}
async function fetchLotTypesJSON(query) {
  const res = await fetch(`/api/lots/lotTypes?${buildArrayQuery(query)}`);
  if (!res.ok) throw new Error('Failed to load lot types');
  return res.json();
}
async function fetchLotSuitesJSON(query) {
  const res = await fetch(`/api/lots/suites?${buildArrayQuery(query)}`);
  if (!res.ok) throw new Error('Failed to load suites');
  return res.json();
}

function attrNorm(s) { return String(s ?? '').trim().toUpperCase(); }

// ── Section 1: Zone Tier Analysis ──
let lastAttrTierRows = [];
const ATTR_TIER_PAGE_SIZES = [10, 25, 50];
let attrTierPageSize = 25;

const ATTR_TIER_BADGE_CLASS = { High: 'badge--gold', Mid: 'badge--silver', Low: 'badge--bronze' };

async function refreshAttrTierProductTypeCascade() {
  const branch = attrTierFiltersUI.branch.getValues();
  try {
    const { materialTypes } = await fetchLotFiltersJSON({ branch });
    attrTierFiltersUI.productType.setOptions(materialTypes || []);
    await Promise.all([refreshAttrTierZoneCascade(), refreshAttrTierLotTypeCascade()]);
  } catch (e) {
    console.error('[attributes] refreshAttrTierProductTypeCascade failed:', e);
  }
}

async function refreshAttrTierZoneCascade() {
  const branch = attrTierFiltersUI.branch.getValues();
  const materialType = attrTierFiltersUI.productType.getValues();
  try {
    const { zones } = await fetchLotZonesJSON({ branch, materialType });
    attrTierFiltersUI.zone.setOptions(zones || []);
    await refreshAttrTierSuiteCascade();
  } catch (e) {
    console.error('[attributes] refreshAttrTierZoneCascade failed:', e);
  }
}

// Suite No is only meaningful once a Zone is picked — matches the request text's "matching
// Branch+Zone, and Branch+Zone+Suite when the query is at suite granularity": with no Zone
// selected, expectedTier is always looked up at whole-zone granularity.
async function refreshAttrTierSuiteCascade() {
  const branch = attrTierFiltersUI.branch.getValues();
  const zone = attrTierFiltersUI.zone.getValues();
  if (!zone.length) { attrTierFiltersUI.suite.setOptions([]); return; }
  try {
    const materialType = attrTierFiltersUI.productType.getValues();
    const { suites } = await fetchLotSuitesJSON({ branch, zone, materialType });
    attrTierFiltersUI.suite.setOptions(suites || []);
  } catch (e) {
    console.error('[attributes] refreshAttrTierSuiteCascade failed:', e);
  }
}

async function refreshAttrTierLotTypeCascade() {
  const branch = attrTierFiltersUI.branch.getValues();
  const materialType = attrTierFiltersUI.productType.getValues();
  try {
    const { lotTypes } = await fetchLotTypesJSON({ branch, materialType });
    attrTierFiltersUI.lotType.setOptions(lotTypes || []);
  } catch (e) {
    console.error('[attributes] refreshAttrTierLotTypeCascade failed:', e);
  }
}

function initAttrTierFilters() {
  attrTierFiltersUI.branch = new MultiSelect('attrTierBranch', {
    placeholder: 'All branches',
    onChange: () => { refreshAttrTierProductTypeCascade(); },
  });
  attrTierFiltersUI.productType = new MultiSelect('attrTierProductType', {
    placeholder: 'All product types',
    displayFn: stripNVPrefix,
    onChange: () => { refreshAttrTierZoneCascade(); refreshAttrTierLotTypeCascade(); },
  });
  attrTierFiltersUI.zone = new MultiSelect('attrTierZone', {
    placeholder: 'All zones',
    onChange: () => { refreshAttrTierSuiteCascade(); },
  });
  attrTierFiltersUI.suite = new MultiSelect('attrTierSuite', { placeholder: 'Whole zone' });
  attrTierFiltersUI.lotType = new MultiSelect('attrTierLotType', { placeholder: 'All lot types' });

  attrTierFiltersReady = fetchLotFiltersJSON({}).then(({ branches, materialTypes }) => {
    attrTierFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    // Defaults to NV Niche only — tiering is most meaningful there — rather than "All", but
    // every other product type with Zone data is still selectable.
    attrTierFiltersUI.productType.setOptions(materialTypes || []);
    const defaultType = (materialTypes || []).includes('NV Niche') ? ['NV Niche'] : (materialTypes || []).slice(0, 1);
    attrTierFiltersUI.productType.setSelectedValues(defaultType);
    return Promise.all([refreshAttrTierZoneCascade(), refreshAttrTierLotTypeCascade()]);
  }).catch(e => console.error('[attributes] initAttrTierFilters failed:', e));
}

const ATTR_ALIGNMENT_BADGE_CLASS = {
  'Higher Than Peers': 'badge--blue', 'Lower Than Peers': 'badge--red',
  Aligned: 'badge--green', 'N/A': 'badge--grey',
};
// Flagged (Higher/Lower Than Peers) rows first, then Aligned, then N/A (no expected tier set
// to compare against) last — surfaces the actionable rows without hiding the rest.
const ATTR_ALIGNMENT_SORT_RANK = { 'Higher Than Peers': 0, 'Lower Than Peers': 0, Aligned: 1, 'N/A': 2 };

function renderAttrTierToolbar(totalCount) {
  const el = document.getElementById('attrTierToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const shown = attrTierPageSize === 'all' ? totalCount : Math.min(attrTierPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(shown)} of ${fmt(totalCount)} rows</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${ATTR_TIER_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${attrTierPageSize === n ? ' active' : ''}" data-attr-tier-page="${n}">${n}</button>`).join('')}
        <button type="button" class="drill-page-btn${attrTierPageSize === 'all' ? ' active' : ''}" data-attr-tier-page="all">Show All</button>
      </div>
    </div>`;
}

function renderAttrTierHead() {
  const headRow = document.getElementById('attrTiersHeadRow');
  if (!headRow) return;
  const suiteCol = lastAttrTierRows.some(r => r.suiteNo) ? ['Suite No'] : [];
  headRow.innerHTML = ['Branch', 'Zone', ...suiteCol, 'Actual Price', 'Sell-Through %', 'Balance Value', 'Units',
    'Expected Tier', 'Era', 'Religion', 'Price Alignment', '']
    .map(h => `<th>${h}</th>`).join('');
}

function renderAttrTierBody() {
  const tbody = document.getElementById('attrTiersBody');
  if (!tbody) return;
  const hasSuiteCol = lastAttrTierRows.some(r => r.suiteNo);
  const colCount = hasSuiteCol ? 12 : 11;

  const sorted = [...lastAttrTierRows].sort((a, b) => {
    const ra = ATTR_ALIGNMENT_SORT_RANK[a.priceAlignment] ?? 2, rb = ATTR_ALIGNMENT_SORT_RANK[b.priceAlignment] ?? 2;
    if (ra !== rb) return ra - rb;
    return b.balanceValue - a.balanceValue;
  });

  renderAttrTierToolbar(sorted.length);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No zones match these filters (or none meet the 50-unit minimum).</td></tr>`;
    return;
  }

  const rows = attrTierPageSize === 'all' ? sorted : sorted.slice(0, attrTierPageSize);

  // Only carries a single product type onto the Edit button when the Zone Tier filters are
  // scoped to exactly one — with none/multiple selected there's no unambiguous product type to
  // pre-fill, so the user picks it in the modal instead.
  const tierProductTypes = attrTierFiltersUI.productType.getValues();
  const editProductType = tierProductTypes.length === 1 ? tierProductTypes[0] : '';

  tbody.innerHTML = rows.map(r => {
    const suiteCell = hasSuiteCol ? `<td>${escapeHtml(r.suiteNo || '—')}</td>` : '';
    const editBtn = `<button type="button" class="btn-view-lots" data-action="edit-attr-registry"
      data-branch="${escapeHtml(r.branch)}" data-zone="${escapeHtml(r.zone)}" data-suite="${escapeHtml(r.suiteNo || '')}"
      data-product-type="${escapeHtml(editProductType)}">Edit</button>`;
    return `<tr>
      <td>${escapeHtml(r.branch)}</td>
      <td>${escapeHtml(r.zone)}</td>
      ${suiteCell}
      <td>${myr(r.actualPrice)}</td>
      <td>${pct(r.sellThroughPct)}</td>
      <td>${myr(r.balanceValue)}</td>
      <td>${fmt(r.unitCount)}</td>
      <td>${r.expectedTier ? `<span class="badge ${ATTR_TIER_BADGE_CLASS[r.expectedTier] || 'badge--navy'}">${escapeHtml(r.expectedTier)}</span>` : `<span class="badge badge--lightgrey">Not Set</span>`}</td>
      <td>${escapeHtml(r.era || '—')}</td>
      <td>${escapeHtml(r.religionType || '—')}</td>
      <td><span class="badge ${ATTR_ALIGNMENT_BADGE_CLASS[r.priceAlignment] || 'badge--grey'}"${r.matchNotes ? ` title="${escapeHtml(r.matchNotes)}"` : ''}>${escapeHtml(r.priceAlignment)}</span></td>
      <td>${editBtn}</td>
    </tr>`;
  }).join('');
}

async function renderZoneTierSection() {
  const tbody = document.getElementById('attrTiersBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const filters = {
      branch: attrTierFiltersUI.branch.getValues(),
      productType: attrTierFiltersUI.productType.getValues(),
      zone: attrTierFiltersUI.zone.getValues(),
      suiteNo: attrTierFiltersUI.suite.getValues(),
      lotType: attrTierFiltersUI.lotType.getValues(),
    };
    const { rows } = await fetchAttributesJSON('zone-tiers', filters);
    lastAttrTierRows = rows || [];
    renderAttrTierHead();
    renderAttrTierBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] renderZoneTierSection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

function exportZoneTiersExcel() {
  if (!lastAttrTierRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const sorted = [...lastAttrTierRows].sort((a, b) => {
    const ra = ATTR_ALIGNMENT_SORT_RANK[a.priceAlignment] ?? 2, rb = ATTR_ALIGNMENT_SORT_RANK[b.priceAlignment] ?? 2;
    if (ra !== rb) return ra - rb;
    return b.balanceValue - a.balanceValue;
  });
  const header = ['Branch', 'Zone', 'Suite No', 'Actual Price', 'Sell-Through %', 'Balance Value', 'Units', 'Expected Tier', 'Era', 'Religion', 'Price Alignment'];
  const aoa = [header, ...sorted.map(r => [
    r.branch, r.zone, r.suiteNo || '', Number(r.actualPrice.toFixed(2)), Number(r.sellThroughPct.toFixed(1)),
    Number(r.balanceValue.toFixed(2)), r.unitCount, r.expectedTier || '', r.era || '', r.religionType || '', r.priceAlignment,
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Zone Tiers');
  XLSX.writeFile(wb, `product_attributes_zone_tiers_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Section 2: Level Size & Sell-Through Analysis ──
let lastAttrLevelRows = [];

async function refreshAttrLevelCascade() {
  const branch = attrLevelFiltersUI.branch.getValues();
  try {
    const { materialTypes } = await fetchLotFiltersJSON({ branch });
    const structuredTypes = (materialTypes || []).filter(t => STRUCTURED_MATERIAL_TYPES.includes(t));
    attrLevelFiltersUI.productType.setOptions(structuredTypes);
    await refreshAttrLevelZoneCascade();
  } catch (e) {
    console.error('[attributes] refreshAttrLevelCascade failed:', e);
  }
}

function initAttrLevelFilters() {
  attrLevelFiltersUI.branch = new MultiSelect('attrLevelBranch', {
    placeholder: 'All branches',
    onChange: () => { refreshAttrLevelCascade(); },
  });
  // Structured types only (Niche, Pedestal, Pet Niche, EBL, Baby Paradise) — flat-land product
  // types have no Level No, so they're simply never offered here (same effect as disabling
  // them, without needing separate show/hide UI state).
  attrLevelFiltersUI.productType = new MultiSelect('attrLevelProductType', {
    placeholder: 'All structured types',
    displayFn: stripNVPrefix,
    onChange: () => { refreshAttrLevelZoneCascade(); },
  });
  attrLevelFiltersUI.zone = new MultiSelect('attrLevelZone', { placeholder: 'All zones' });

  attrLevelFiltersReady = fetchLotFiltersJSON({}).then(({ branches, materialTypes }) => {
    attrLevelFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    const structuredTypes = (materialTypes || []).filter(t => STRUCTURED_MATERIAL_TYPES.includes(t));
    attrLevelFiltersUI.productType.setOptions(structuredTypes, { selectAll: true });
    return refreshAttrLevelZoneCascade();
  }).catch(e => console.error('[attributes] initAttrLevelFilters failed:', e));
}

async function refreshAttrLevelZoneCascade() {
  const branch = attrLevelFiltersUI.branch.getValues();
  const productType = attrLevelFiltersUI.productType.getValues();
  try {
    const { zones } = await fetchLotZonesJSON({ branch, materialType: productType });
    attrLevelFiltersUI.zone.setOptions(zones || []);
  } catch (e) {
    console.error('[attributes] refreshAttrLevelZoneCascade failed:', e);
  }
}

const ATTR_LEVEL_COMP_BADGE_CLASS = { Sufficient: 'badge--green', Insufficient: 'badge--red', 'N/A': 'badge--grey' };

function renderAttrLevelBody() {
  const tbody = document.getElementById('attrLevelBody');
  if (!tbody) return;
  if (!lastAttrLevelRows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted)">No levels match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = lastAttrLevelRows.map(r => `<tr>
    <td>${escapeHtml(r.level)}</td>
    <td><span class="badge ${r.sizeCategory === 'Enlarged' ? 'badge--blue' : 'badge--grey'}">${escapeHtml(r.sizeCategory)}</span></td>
    <td>${escapeHtml(r.mostCommonDimension || '—')}</td>
    <td>${myr(r.avgPrice)}</td>
    <td>${pct(r.sellThroughPct)}</td>
    <td><span class="badge ${ATTR_LEVEL_COMP_BADGE_CLASS[r.compensationStatus] || 'badge--grey'}">${escapeHtml(r.compensationStatus)}</span></td>
    <td>${myr(r.balanceValue)}</td>
    <td>${fmt(r.unitCount)}</td>
  </tr>`).join('');
}

function renderAttrLevelChart(standardDimension) {
  destroyChart('attrLevel');
  const ctx = document.getElementById('chartAttrLevel');
  if (!ctx) return;
  if (!lastAttrLevelRows.length) return;

  const labels = lastAttrLevelRows.map(r => r.level);
  const data = lastAttrLevelRows.map(r => r.sellThroughPct);
  const isEnlarged = lastAttrLevelRows.map(r => r.sizeCategory === 'Enlarged');
  const backgroundColor = isEnlarged.map(e => e ? C.blue : '#c7ccd6');
  const borderColor = isEnlarged.map(e => e ? C.navy : '#c7ccd6');
  const borderWidth = isEnlarged.map(e => e ? 3 : 1);
  const attrLevelTotal = sumFinite(data);

  charts.attrLevel = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Sell-Through %', data, backgroundColor, borderColor, borderWidth }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: 'Sell-Through %' }, ticks: { callback: v => v + '%' } },
        x: { title: { display: true, text: 'Level' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const r = lastAttrLevelRows[item.dataIndex];
              return `${pct(item.parsed.y)}${pctOfTotalLabel(item.parsed.y, attrLevelTotal, 'total across all bars shown')} — ${r.sizeCategory}${r.sizeCategory === 'Enlarged' ? ' (' + r.compensationStatus + ')' : ''} — standard dimension: ${standardDimension || 'n/a'}`;
            },
          },
        },
      },
    },
  });
}

async function renderLevelAnalysisSection() {
  const tbody = document.getElementById('attrLevelBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const filters = {
      branch: attrLevelFiltersUI.branch.getValues(),
      productType: attrLevelFiltersUI.productType.getValues(),
      zone: attrLevelFiltersUI.zone.getValues(),
    };
    const { rows, standardDimension } = await fetchAttributesJSON('level-analysis', filters);
    lastAttrLevelRows = rows || [];
    renderAttrLevelBody();
    renderAttrLevelChart(standardDimension);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] renderLevelAnalysisSection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

// ── Section 3: Dimension Consistency Check ──
let lastAttrDimRows = [];
const ATTR_DIM_PAGE_SIZES = [10, 25, 50];
let attrDimPageSize = 10;

async function refreshAttrDimCascade() {
  const branch = attrDimFiltersUI.branch.getValues();
  try {
    const { materialTypes } = await fetchLotFiltersJSON({ branch });
    attrDimFiltersUI.productType.setOptions(materialTypes || []);
    await refreshAttrDimLotTypeCascade();
  } catch (e) {
    console.error('[attributes] refreshAttrDimCascade failed:', e);
  }
}

async function refreshAttrDimLotTypeCascade() {
  const branch = attrDimFiltersUI.branch.getValues();
  const materialType = attrDimFiltersUI.productType.getValues();
  try {
    const { lotTypes } = await fetchLotTypesJSON({ branch, materialType });
    attrDimFiltersUI.lotType.setOptions(lotTypes || []);
  } catch (e) {
    console.error('[attributes] refreshAttrDimLotTypeCascade failed:', e);
  }
}

function initAttrDimFilters() {
  attrDimFiltersUI.branch = new MultiSelect('attrDimBranch', {
    placeholder: 'All branches',
    onChange: () => { refreshAttrDimCascade(); },
  });
  attrDimFiltersUI.productType = new MultiSelect('attrDimProductType', {
    placeholder: 'All product types',
    displayFn: stripNVPrefix,
    onChange: () => { refreshAttrDimLotTypeCascade(); },
  });
  attrDimFiltersUI.lotType = new MultiSelect('attrDimLotType', { placeholder: 'All lot types' });

  attrDimFiltersReady = fetchLotFiltersJSON({}).then(({ branches, materialTypes }) => {
    attrDimFiltersUI.branch.setOptions(branches || [], { selectAll: true });
    attrDimFiltersUI.productType.setOptions(materialTypes || [], { selectAll: true });
    return refreshAttrDimLotTypeCascade();
  }).catch(e => console.error('[attributes] initAttrDimFilters failed:', e));
}

function renderAttrDimToolbar(totalCount) {
  const el = document.getElementById('attrDimToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const shown = attrDimPageSize === 'all' ? totalCount : Math.min(attrDimPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(shown)} of ${fmt(totalCount)} mismatches</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${ATTR_DIM_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${attrDimPageSize === n ? ' active' : ''}" data-attr-dim-page="${n}">${n}</button>`).join('')}
        <button type="button" class="drill-page-btn${attrDimPageSize === 'all' ? ' active' : ''}" data-attr-dim-page="all">Show All</button>
      </div>
    </div>`;
}

function renderAttrDimHead() {
  const headRow = document.getElementById('attrDimHeadRow');
  if (!headRow) return;
  headRow.innerHTML = ['Branch', 'Product Type', 'Lot Type', 'Zone', 'Cohort Period', 'Standard Dimension', 'Actual Dimension', 'Units', 'Sell-Through %', 'Balance Value']
    .map(h => `<th>${h}</th>`).join('') + '<th></th>';
}

function renderAttrDimBody() {
  const tbody = document.getElementById('attrDimBody');
  if (!tbody) return;
  const colCount = 11;
  renderAttrDimToolbar(lastAttrDimRows.length);

  if (!lastAttrDimRows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:var(--muted)">No dimension mismatches found for these filters.</td></tr>`;
    return;
  }

  const rows = attrDimPageSize === 'all' ? lastAttrDimRows : lastAttrDimRows.slice(0, attrDimPageSize);

  tbody.innerHTML = rows.map(r => {
    const viewLotsBtn = `<button type="button" class="btn-view-lots" data-action="toggle-attr-dim-lots"
      data-product="${escapeHtml(r.productType)}" data-branch="${escapeHtml(r.branch)}" data-lot-type="${escapeHtml(r.lotType)}"
      data-zone="${escapeHtml(r.zone)}" data-cohort-period="${escapeHtml(r.cohortPeriod)}" data-dimension="${escapeHtml(r.actualDimension)}">View Lots</button>`;
    return `<tr class="accordion-row">
      <td>${escapeHtml(r.branch)}</td>
      <td>${escapeHtml(stripNVPrefix(r.productType))}</td>
      <td>${escapeHtml(r.lotType)}</td>
      <td>${escapeHtml(r.zone)}</td>
      <td>${escapeHtml(r.cohortPeriod)}</td>
      <td>${escapeHtml(r.standardDimension || '—')}</td>
      <td>${escapeHtml(r.actualDimension || '—')}</td>
      <td>${fmt(r.unitCount)}</td>
      <td>${pct(r.sellThroughPct)}</td>
      <td>${myr(r.balanceValue)}</td>
      <td>${viewLotsBtn}</td>
    </tr>
    <tr class="accordion-detail" style="display:none"><td colspan="${colCount}"><div class="drilldown-inline" data-drill-content></div></td></tr>`;
  }).join('');
}

async function renderDimensionConsistencySection() {
  const tbody = document.getElementById('attrDimBody');
  if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const filters = {
      branch: attrDimFiltersUI.branch.getValues(),
      productType: attrDimFiltersUI.productType.getValues(),
      lotType: attrDimFiltersUI.lotType.getValues(),
    };
    const { rows } = await fetchAttributesJSON('dimension-consistency', filters);
    lastAttrDimRows = rows || [];
    renderAttrDimHead();
    renderAttrDimBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] renderDimensionConsistencySection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

// Reuses /api/lots' cohortPeriod + (newly added) dimension filters to scope straight to the
// exact mismatched-dimension lots for this cohort — no status filter, since the point here is
// inspecting the physical anomaly itself, not just the unsold remainder.
async function loadAttrDimLotsContent(btn, content) {
  content.innerHTML = `<div class="drilldown-empty">Loading…</div>`;
  try {
    const filters = {
      materialType: [btn.dataset.product],
      branch: [btn.dataset.branch],
      lotType: [btn.dataset.lotType],
      zone: [btn.dataset.zone],
      dimension: [btn.dataset.dimension],
      cohortPeriod: btn.dataset.cohortPeriod,
    };
    const { rows, mode } = await fetchLotsDetail(filters);
    const totalQty = computeDrillTotalQty(rows);
    renderDrillDownPanel(content, {
      rows, mode,
      titleLine: `${escapeHtml(stripNVPrefix(btn.dataset.product))} (${fmt(totalQty)} units) · ${escapeHtml(btn.dataset.branch)} · Zone ${escapeHtml(btn.dataset.zone)} · ${escapeHtml(btn.dataset.cohortPeriod)} · Dimension ${escapeHtml(btn.dataset.dimension)}`,
      filenameBase: `attr_dimension_lots_${sanitizeForFilename(btn.dataset.product)}_${sanitizeForFilename(btn.dataset.branch)}_${sanitizeForFilename(btn.dataset.zone)}`,
    });
    content.dataset.loaded = 'true';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] loadAttrDimLotsContent failed:', err);
    content.innerHTML = `<div class="drilldown-empty" style="color:var(--red)">Error: ${err.message}</div>`;
  }
}

async function toggleAttrDimLots(btn) {
  const detailRow = btn.closest('tr')?.nextElementSibling;
  if (!detailRow || !detailRow.classList.contains('accordion-detail')) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; btn.textContent = 'View Lots'; return; }

  detailRow.style.display = '';
  btn.textContent = 'Hide Lots';
  const content = detailRow.querySelector('[data-drill-content]');
  if (content.dataset.loaded === 'true') return;
  await loadAttrDimLotsContent(btn, content);
}

function exportDimensionConsistencyExcel() {
  if (!lastAttrDimRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const header = ['Branch', 'Product Type', 'Lot Type', 'Zone', 'Cohort Period', 'Standard Dimension', 'Actual Dimension', 'Units', 'Sell-Through %', 'Balance Value'];
  const aoa = [header, ...lastAttrDimRows.map(r => [
    r.branch, stripNVPrefix(r.productType), r.lotType, r.zone, r.cohortPeriod, r.standardDimension, r.actualDimension,
    r.unitCount, Number(r.sellThroughPct.toFixed(1)), Number(r.balanceValue.toFixed(2)),
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dimension Mismatches');
  XLSX.writeFile(wb, `product_attributes_dimension_consistency_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Section 1b: Zone/Suite/Lot-Type Attribute Registry ──
let lastAttrRegistryRows = [];
let attrRegistryFiltersReady = null;
const ATTR_REGISTRY_PAGE_SIZES = [10, 25];
let attrRegistryPageSize = 10;
let attrRegistryPage = 1;

function initAttrRegistryFilters() {
  attrRegistryFiltersReady = fetchLotFiltersJSON({}).then(({ branches, materialTypes }) => {
    const opts = ['ALL', ...(branches || [])];
    const branchFilter = document.getElementById('attrRegBranchFilter');
    if (branchFilter) {
      branchFilter.innerHTML = '<option value="">All branches</option>' +
        opts.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    }
    const branchList = document.getElementById('attrRegBranchList');
    if (branchList) branchList.innerHTML = opts.map(b => `<option value="${escapeHtml(b)}">`).join('');

    populateAttrRegProductTypeFilter(materialTypes || []);

    const productTypeList = document.getElementById('attrRegProductTypeList');
    if (productTypeList) productTypeList.innerHTML = (materialTypes || []).map(t => `<option value="${escapeHtml(t)}">`).join('');
  }).catch(e => console.error('[attributes] initAttrRegistryFilters failed:', e));

  // Lot Type has no fixed enumeration in the source data (varies per Branch), so the datalist
  // is seeded from every real Lot Type value plus "Mixed" — a zone-level entry not tied to one
  // specific physical lot type — rather than a hardcoded list.
  fetchLotTypesJSON({}).then(({ lotTypes }) => {
    const lotTypeList = document.getElementById('attrRegLotTypeList');
    if (!lotTypeList) return;
    const opts = [...(lotTypes || []), 'Mixed'];
    lotTypeList.innerHTML = opts.map(t => `<option value="${escapeHtml(t)}">`).join('');
  }).catch(e => console.error('[attributes] attrRegLotTypeList load failed:', e));
}

function populateAttrRegProductTypeFilter(materialTypes, preserveSelection) {
  const productTypeFilter = document.getElementById('attrRegProductTypeFilter');
  if (!productTypeFilter) return;
  const prev = preserveSelection ?? productTypeFilter.value;
  productTypeFilter.innerHTML = '<option value="">All product types</option>' +
    materialTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(stripNVPrefix(t))}</option>`).join('');
  // Keeps the current selection only if it's still valid after narrowing by Branch — otherwise
  // falls back to "All product types" rather than silently keeping an invalid/hidden value.
  if (prev && materialTypes.includes(prev)) productTypeFilter.value = prev;
}

// Product Type options narrow to whatever actually has master_stock inventory for the
// selected Branch — 'ALL' (the special branch value used for universal Lot Type rules) and no
// selection both mean "every branch", so the full 9-product list applies in those cases too.
async function refreshAttrRegProductTypeCascade() {
  const branch = document.getElementById('attrRegBranchFilter')?.value || '';
  try {
    const { materialTypes } = await fetchLotFiltersJSON(branch && branch !== 'ALL' ? { branch } : {});
    populateAttrRegProductTypeFilter(materialTypes || []);
  } catch (e) {
    console.error('[attributes] refreshAttrRegProductTypeCascade failed:', e);
  }
}

async function renderAttrRegistrySection() {
  const tbody = document.getElementById('attrRegistryBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const branch = document.getElementById('attrRegBranchFilter')?.value || '';
    const productType = document.getElementById('attrRegProductTypeFilter')?.value || '';
    const params = new URLSearchParams();
    if (branch) params.set('branch', branch);
    if (productType) params.set('productType', productType);
    const qs = params.toString();
    const res = await fetch(`/api/attributes/zone-attributes${qs ? `?${qs}` : ''}`);
    if (res.status === 401 || res.redirected || res.url.includes('/login')) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { rows } = await res.json();
    lastAttrRegistryRows = rows || [];
    attrRegistryPage = 1;
    renderAttrRegistryBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] renderAttrRegistrySection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="16" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

// Truncates Notes to a short preview with a click-to-expand "...more" link (accordion-style,
// no page navigation) — full text round-trips through data-full/data-short as already-escaped
// HTML so toggleAttrNotesCell can swap it back in verbatim without re-escaping or unescaping.
const ATTR_NOTES_TRUNCATE_LEN = 40;
function renderAttrNotesCell(r) {
  const notes = r.notes || '';
  if (!notes) return '—';
  if (notes.length <= ATTR_NOTES_TRUNCATE_LEN) return escapeHtml(notes);
  const short = escapeHtml(notes.slice(0, ATTR_NOTES_TRUNCATE_LEN));
  const full = escapeHtml(notes);
  return `<span class="attr-notes-cell" data-expanded="false" data-short="${short}" data-full="${full}">${short}<a href="#" class="attr-notes-toggle" data-action="toggle-attr-notes">...more</a></span>`;
}

function toggleAttrNotesCell(link) {
  const cell = link.closest('.attr-notes-cell');
  if (!cell) return;
  const expanded = cell.dataset.expanded === 'true';
  cell.dataset.expanded = expanded ? 'false' : 'true';
  cell.innerHTML = expanded
    ? `${cell.dataset.short}<a href="#" class="attr-notes-toggle" data-action="toggle-attr-notes">...more</a>`
    : `${cell.dataset.full} <a href="#" class="attr-notes-toggle" data-action="toggle-attr-notes">(less)</a>`;
}

function renderAttrRegistryToolbar(totalCount, totalPages) {
  const el = document.getElementById('attrRegistryToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const rangeStart = (attrRegistryPage - 1) * attrRegistryPageSize + 1;
  const rangeEnd = Math.min(attrRegistryPage * attrRegistryPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(rangeStart)}–${fmt(rangeEnd)} of ${fmt(totalCount)} entries</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${ATTR_REGISTRY_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${attrRegistryPageSize === n ? ' active' : ''}" data-attr-registry-page="${n}">${n}</button>`).join('')}
      </div>
      <div class="drill-page-nav">
        <button type="button" class="drill-page-nav-btn" data-attr-registry-nav="prev" ${attrRegistryPage <= 1 ? 'disabled' : ''}>&laquo; Previous</button>
        <span class="drill-page-nav-indicator">Page ${attrRegistryPage} of ${totalPages}</span>
        <button type="button" class="drill-page-nav-btn" data-attr-registry-nav="next" ${attrRegistryPage >= totalPages ? 'disabled' : ''}>Next &raquo;</button>
      </div>
    </div>`;
}

function renderAttrRegistryBody() {
  const tbody = document.getElementById('attrRegistryBody');
  if (!tbody) return;
  const totalCount = lastAttrRegistryRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / attrRegistryPageSize));
  if (attrRegistryPage > totalPages) attrRegistryPage = totalPages;
  if (attrRegistryPage < 1) attrRegistryPage = 1;

  renderAttrRegistryToolbar(totalCount, totalPages);

  if (!totalCount) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;color:var(--muted)">No attribute rows yet — click Add Row to create one.</td></tr>`;
    return;
  }
  const start = (attrRegistryPage - 1) * attrRegistryPageSize;
  const rows = lastAttrRegistryRows.slice(start, start + attrRegistryPageSize);
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${escapeHtml(r.branch)}</td>
    <td>${escapeHtml(r.zone)}</td>
    <td>${escapeHtml(r.suite_no || '—')}</td>
    <td>${escapeHtml(r.lot_type || '—')}</td>
    <td>${r.product_type ? escapeHtml(stripNVPrefix(r.product_type)) : '—'}</td>
    <td>${r.intended_tier ? `<span class="badge ${ATTR_TIER_BADGE_CLASS[r.intended_tier] || 'badge--navy'}">${escapeHtml(r.intended_tier)}</span>` : '—'}</td>
    <td>${escapeHtml(r.era || '—')}</td>
    <td>${escapeHtml(r.religion_type || '—')}</td>
    <td>${escapeHtml(r.walkway_width || '—')}</td>
    <td>${escapeHtml(r.walkway_proximity || '—')}</td>
    <td>${escapeHtml(r.gazebo_proximity || '—')}</td>
    <td>${escapeHtml(r.elevation_tier || '—')}</td>
    <td>${renderAttrNotesCell(r)}</td>
    <td>${escapeHtml((r.updated_at || '').slice(0, 10))}</td>
    <td style="white-space:nowrap;">
      <button type="button" class="btn-view-lots" data-action="edit-attr-registry-row" data-id="${r.id}">Edit</button>
      <button type="button" class="btn-view-lots" data-action="delete-attr-registry-row" data-id="${r.id}">Delete</button>
    </td>
  </tr>`).join('');
}

// Maps each modal input's id to the field name upsertZoneAttribute/the row object use — shared
// by both pre-filling the form (open) and reading it back out (save).
function attrRegistryFieldMap() {
  return {
    branch: 'attrRegBranch', zone: 'attrRegZone', suiteNo: 'attrRegSuite', lotType: 'attrRegLotType',
    productType: 'attrRegProductType',
    intendedTier: 'attrRegTier', era: 'attrRegEra', religionType: 'attrRegReligion',
    walkwayWidth: 'attrRegWalkwayWidth',
    walkwayProximity: 'attrRegWalkwayProximity', gazeboProximity: 'attrRegGazebo',
    elevationTier: 'attrRegElevation', notes: 'attrRegNotes',
  };
}

// Structured types carry Suite No (and never a Lot Type or the 4 plot-specific fields); flat-
// land types are the reverse — see scripts/populate_zone_attributes.js for the same split.
// A blank/unrecognized Product Type (e.g. universal ALL/ALL rows) is ambiguous, so every field
// stays visible rather than guessing which grain applies.
function updateAttrRegFieldVisibility() {
  const productType = document.getElementById('attrRegProductType')?.value.trim() || '';
  const isFlat = FLAT_MATERIAL_TYPES.includes(productType);
  const isStructured = STRUCTURED_MATERIAL_TYPES.includes(productType);
  const showSuite = !isFlat;
  const showFlatFields = !isStructured;

  document.querySelectorAll('[data-attr-field="suite"]').forEach(el => {
    el.style.display = showSuite ? '' : 'none';
    if (!showSuite) { const input = el.querySelector('input'); if (input) input.value = ''; }
  });
  document.querySelectorAll('[data-attr-field="flat"]').forEach(el => {
    el.style.display = showFlatFields ? '' : 'none';
    if (!showFlatFields) {
      el.querySelectorAll('input, select').forEach(field => { field.value = ''; });
    }
  });
}

function openAttrRegistryModal(prefill = {}) {
  document.getElementById('attrRegId').value = prefill.id ?? '';
  const fields = attrRegistryFieldMap();
  for (const [key, id] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = prefill[key] ?? '';
  }
  document.getElementById('attrRegModalTitle').textContent = prefill.id ? 'Edit Attribute Row' : 'Add Attribute Row';
  const warnEl = document.getElementById('attrRegWarning');
  if (warnEl) { warnEl.style.display = 'none'; warnEl.textContent = ''; }
  updateAttrRegFieldVisibility();
  document.getElementById('attrRegistryModal')?.removeAttribute('hidden');
}

function closeAttrRegistryModal() {
  document.getElementById('attrRegistryModal')?.setAttribute('hidden', '');
}

function openAttrRegistryModalForRow(id) {
  const row = lastAttrRegistryRows.find(r => String(r.id) === String(id));
  if (!row) return;
  openAttrRegistryModal({
    id: row.id, branch: row.branch, zone: row.zone, suiteNo: row.suite_no, lotType: row.lot_type,
    productType: row.product_type,
    intendedTier: row.intended_tier, era: row.era, religionType: row.religion_type,
    walkwayWidth: row.walkway_width, walkwayProximity: row.walkway_proximity,
    gazeboProximity: row.gazebo_proximity, elevationTier: row.elevation_tier, notes: row.notes,
  });
}

// Called from the Zone Tier Analysis table's Edit button — opens the matching registry row if
// one already exists for this Branch+Zone(+Suite)+Product Type, otherwise a blank form
// pre-filled with them. productType may be '' (ambiguous — multiple/no types selected in the
// Zone Tier filters), in which case matching falls back to Branch+Zone+Suite alone.
function openAttrRegistryModalForZone(branch, zone, suiteNo, productType) {
  const existing = lastAttrRegistryRows.find(r =>
    attrNorm(r.branch) === attrNorm(branch) && attrNorm(r.zone) === attrNorm(zone) &&
    attrNorm(r.suite_no || '') === attrNorm(suiteNo || '') &&
    (!productType || attrNorm(r.product_type || '') === attrNorm(productType)));
  if (existing) openAttrRegistryModalForRow(existing.id);
  else openAttrRegistryModal({ branch, zone, suiteNo, productType });
}

async function saveAttrRegistryRow() {
  const fields = attrRegistryFieldMap();
  const data = { id: document.getElementById('attrRegId').value || undefined };
  for (const [key, id] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (!el) continue;
    data[key] = el.value;
  }
  if (!data.branch?.trim() || !data.zone?.trim()) { alert('Branch and Zone are required.'); return; }

  const saveBtn = document.getElementById('btnAttrRegSave');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await fetch('/api/attributes/zone-attributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.status === 401 || res.redirected || res.url.includes('/login')) throw new Error('SESSION_EXPIRED');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    if (body.warning) {
      const warnEl = document.getElementById('attrRegWarning');
      if (warnEl) { warnEl.textContent = '⚠ ' + body.warning + ' — saved anyway.'; warnEl.style.display = 'block'; }
      return; // leave the modal open so the warning is visible; user can adjust or close manually
    }
    closeAttrRegistryModal();
    await renderAttrRegistrySection();
    renderZoneTierSection();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] saveAttrRegistryRow failed:', err);
    alert('Failed to save: ' + err.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteAttrRegistryRow(id) {
  if (!confirm('Delete this attribute row?')) return;
  try {
    const res = await fetch(`/api/attributes/zone-attributes/${id}`, { method: 'DELETE' });
    if (res.status === 401 || res.redirected || res.url.includes('/login')) throw new Error('SESSION_EXPIRED');
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `HTTP ${res.status}`); }
    await renderAttrRegistrySection();
    renderZoneTierSection();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] deleteAttrRegistryRow failed:', err);
    alert('Failed to delete: ' + err.message);
  }
}

// ── Section 4: Positional Signals (Beta) ──
const attrSignalFiltersUI = {};
let attrSignalFiltersReady = null;
let lastAttrSignalRows = [];
let lastAttrSignalSummary = null;
const ATTR_SIGNAL_PAGE_SIZES = [10, 25];
let attrSignalPageSize = 10;
let attrSignalPage = 1;

const ATTR_SIGNAL_TYPE_BADGE_CLASS = { 'Wide Walkway': 'badge--blue', 'Gazebo/Center Proximity': 'badge--navy' };
const ATTR_SIGNAL_STATUS_BADGE_CLASS = { Pending: 'badge--grey', Confirmed: 'badge--green', Rejected: 'badge--red' };

// Branch/Zone options are derived from whatever's actually in plot_position_signals (a single
// unfiltered fetch on tab init), rather than from master_stock's full filter cascade — this
// section only ever shows Burial Plot zones that produced a candidate, which is a much smaller,
// more relevant set than "every zone across every product type".
function initAttrSignalFilters() {
  attrSignalFiltersUI.branch = new MultiSelect('attrSignalBranch', { placeholder: 'All branches' });
  attrSignalFiltersUI.zone = new MultiSelect('attrSignalZone', { placeholder: 'All zones' });

  attrSignalFiltersReady = fetchAttributesJSON('plot-signals', {}).then(({ rows }) => {
    const branches = [...new Set((rows || []).map(r => r.branch).filter(Boolean))].sort();
    const zones = [...new Set((rows || []).map(r => r.zone).filter(Boolean))].sort();
    attrSignalFiltersUI.branch.setOptions(branches);
    attrSignalFiltersUI.zone.setOptions(zones);
  }).catch(e => console.error('[attributes] initAttrSignalFilters failed:', e));
}

function renderAttrSignalSummaryCards() {
  const el = document.getElementById('attrSignalSummaryCards');
  if (!el || !lastAttrSignalSummary) return;
  const { byReviewStatus, bySignalType } = lastAttrSignalSummary;
  const statusCards = [
    ['Pending', byReviewStatus.Pending || 0, 'status-flag-card--grey'],
    ['Confirmed', byReviewStatus.Confirmed || 0, 'status-flag-card--green'],
    ['Rejected', byReviewStatus.Rejected || 0, 'status-flag-card--red'],
  ];
  const typeCards = Object.entries(bySignalType || {}).map(([type, count]) => [type, count, 'status-flag-card--blue']);
  el.innerHTML = [...statusCards, ...typeCards].map(([label, count, cls]) => `
    <div class="status-flag-card ${cls}">
      <div class="status-flag-card-count">${fmt(count)}</div>
      <div class="status-flag-card-label">${escapeHtml(label)}</div>
    </div>`).join('');
}

function renderAttrSignalToolbar(totalCount, totalPages) {
  const el = document.getElementById('attrSignalToolbar');
  if (!el) return;
  if (!totalCount) { el.innerHTML = ''; return; }
  const rangeStart = (attrSignalPage - 1) * attrSignalPageSize + 1;
  const rangeEnd = Math.min(attrSignalPage * attrSignalPageSize, totalCount);
  el.innerHTML = `
    <div class="drilldown-toolbar-count">Showing ${fmt(rangeStart)}–${fmt(rangeEnd)} of ${fmt(totalCount)} candidates</div>
    <div class="drilldown-toolbar-actions">
      <div class="drill-page-size">
        ${ATTR_SIGNAL_PAGE_SIZES.map(n => `<button type="button" class="drill-page-btn${attrSignalPageSize === n ? ' active' : ''}" data-attr-signal-page="${n}">${n}</button>`).join('')}
      </div>
      <div class="drill-page-nav">
        <button type="button" class="drill-page-nav-btn" data-attr-signal-nav="prev" ${attrSignalPage <= 1 ? 'disabled' : ''}>&laquo; Previous</button>
        <span class="drill-page-nav-indicator">Page ${attrSignalPage} of ${totalPages}</span>
        <button type="button" class="drill-page-nav-btn" data-attr-signal-nav="next" ${attrSignalPage >= totalPages ? 'disabled' : ''}>Next &raquo;</button>
      </div>
    </div>`;
}

function renderAttrSignalBody() {
  const tbody = document.getElementById('attrSignalBody');
  if (!tbody) return;
  const totalCount = lastAttrSignalRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / attrSignalPageSize));
  if (attrSignalPage > totalPages) attrSignalPage = totalPages;
  if (attrSignalPage < 1) attrSignalPage = 1;

  renderAttrSignalToolbar(totalCount, totalPages);

  if (!totalCount) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--muted)">No candidates match these filters.</td></tr>`;
    return;
  }
  const start = (attrSignalPage - 1) * attrSignalPageSize;
  const rows = lastAttrSignalRows.slice(start, start + attrSignalPageSize);

  tbody.innerHTML = rows.map(r => {
    const isPending = r.review_status === 'Pending';
    const actions = `
      <button type="button" class="btn-view-lots" data-action="confirm-attr-signal" data-id="${r.id}" ${isPending ? '' : 'disabled'}>Confirm</button>
      <button type="button" class="btn-view-lots" data-action="reject-attr-signal" data-id="${r.id}" ${isPending ? '' : 'disabled'}>Reject</button>`;
    return `<tr>
      <td>${escapeHtml(r.material_no)}</td>
      <td>${escapeHtml(r.branch || '—')}</td>
      <td>${escapeHtml(r.zone || '—')}</td>
      <td>${escapeHtml(r.row || '—')}</td>
      <td><span class="badge ${ATTR_SIGNAL_TYPE_BADGE_CLASS[r.signal_type] || 'badge--navy'}">${escapeHtml(r.signal_type)}</span></td>
      <td>${escapeHtml(r.evidence || '—')}</td>
      <td>${myr(r.current_price)}</td>
      <td>${pct(r.current_sell_through_pct)}</td>
      <td><span class="badge ${ATTR_SIGNAL_STATUS_BADGE_CLASS[r.review_status] || 'badge--grey'}">${escapeHtml(r.review_status)}</span></td>
      <td style="white-space:nowrap;">${actions}</td>
    </tr>`;
  }).join('');
}

async function renderPlotSignalsSection() {
  const tbody = document.getElementById('attrSignalBody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
  try {
    const filters = {
      branch: attrSignalFiltersUI.branch.getValues(),
      zone: attrSignalFiltersUI.zone.getValues(),
      signalType: document.getElementById('attrSignalTypeFilter')?.value || null,
      reviewStatus: document.getElementById('attrSignalStatusFilter')?.value || null,
    };
    const { rows, summary } = await fetchAttributesJSON('plot-signals', filters);
    lastAttrSignalRows = rows || [];
    lastAttrSignalSummary = summary || null;
    attrSignalPage = 1;
    renderAttrSignalSummaryCards();
    renderAttrSignalBody();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] renderPlotSignalsSection failed:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--red)">Error: ${err.message}</td></tr>`;
  }
}

async function reviewAttrSignal(id, reviewStatus) {
  try {
    const res = await fetch('/api/attributes/plot-signals/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reviewStatus }),
    });
    if (res.status === 401 || res.redirected || res.url.includes('/login')) throw new Error('SESSION_EXPIRED');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await renderPlotSignalsSection();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[attributes] reviewAttrSignal failed:', err);
    alert('Failed to update review status: ' + err.message);
  }
}

function exportPlotSignalsExcel() {
  if (!lastAttrSignalRows.length) { alert('No data to export. Run a search first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const header = ['Material No', 'Branch', 'Zone', 'Row', 'Signal Type', 'Evidence', 'Current Price', 'Sell-Through %', 'Review Status', 'Notes'];
  const aoa = [header, ...lastAttrSignalRows.map(r => [
    r.material_no, r.branch || '', r.zone || '', r.row || '', r.signal_type, r.evidence || '',
    Number((r.current_price || 0).toFixed(2)), Number((r.current_sell_through_pct || 0).toFixed(1)), r.review_status, r.notes || '',
  ])];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Positional Signals');
  XLSX.writeFile(wb, `product_attributes_positional_signals_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Delegated events ──
function initAttributesTabEvents() {
  const panel = document.getElementById('tab-attributes');
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    if (handleDrillDownPaginationOrExport(e)) return;

    const tierPageBtn = e.target.closest('button[data-attr-tier-page]');
    if (tierPageBtn) {
      const raw = tierPageBtn.dataset.attrTierPage;
      attrTierPageSize = raw === 'all' ? 'all' : Number(raw);
      renderAttrTierBody();
      return;
    }

    const dimPageBtn = e.target.closest('button[data-attr-dim-page]');
    if (dimPageBtn) {
      const raw = dimPageBtn.dataset.attrDimPage;
      attrDimPageSize = raw === 'all' ? 'all' : Number(raw);
      renderAttrDimBody();
      return;
    }

    const registryPageBtn = e.target.closest('button[data-attr-registry-page]');
    if (registryPageBtn) {
      attrRegistryPageSize = Number(registryPageBtn.dataset.attrRegistryPage);
      attrRegistryPage = 1;
      renderAttrRegistryBody();
      return;
    }

    const registryNavBtn = e.target.closest('button[data-attr-registry-nav]');
    if (registryNavBtn) {
      attrRegistryPage += registryNavBtn.dataset.attrRegistryNav === 'prev' ? -1 : 1;
      renderAttrRegistryBody();
      return;
    }

    const notesToggle = e.target.closest('a[data-action="toggle-attr-notes"]');
    if (notesToggle) { e.preventDefault(); toggleAttrNotesCell(notesToggle); return; }

    const viewLotsBtn = e.target.closest('button[data-action="toggle-attr-dim-lots"]');
    if (viewLotsBtn) { toggleAttrDimLots(viewLotsBtn); return; }

    const attrEditBtn = e.target.closest('button[data-action="edit-attr-registry"]');
    if (attrEditBtn) {
      openAttrRegistryModalForZone(attrEditBtn.dataset.branch, attrEditBtn.dataset.zone, attrEditBtn.dataset.suite, attrEditBtn.dataset.productType);
      return;
    }

    const regEditBtn = e.target.closest('button[data-action="edit-attr-registry-row"]');
    if (regEditBtn) { openAttrRegistryModalForRow(regEditBtn.dataset.id); return; }

    const regDeleteBtn = e.target.closest('button[data-action="delete-attr-registry-row"]');
    if (regDeleteBtn) { deleteAttrRegistryRow(regDeleteBtn.dataset.id); return; }

    const signalPageBtn = e.target.closest('button[data-attr-signal-page]');
    if (signalPageBtn) {
      attrSignalPageSize = Number(signalPageBtn.dataset.attrSignalPage);
      attrSignalPage = 1;
      renderAttrSignalBody();
      return;
    }

    const signalNavBtn = e.target.closest('button[data-attr-signal-nav]');
    if (signalNavBtn) {
      attrSignalPage += signalNavBtn.dataset.attrSignalNav === 'prev' ? -1 : 1;
      renderAttrSignalBody();
      return;
    }

    const signalConfirmBtn = e.target.closest('button[data-action="confirm-attr-signal"]');
    if (signalConfirmBtn) { reviewAttrSignal(signalConfirmBtn.dataset.id, 'Confirmed'); return; }

    const signalRejectBtn = e.target.closest('button[data-action="reject-attr-signal"]');
    if (signalRejectBtn) { reviewAttrSignal(signalRejectBtn.dataset.id, 'Rejected'); return; }
  });

  document.getElementById('btnAttrRegCancel')?.addEventListener('click', closeAttrRegistryModal);
  document.getElementById('btnAttrRegSave')?.addEventListener('click', saveAttrRegistryRow);
  document.getElementById('attrRegBranchFilter')?.addEventListener('change', async () => {
    await refreshAttrRegProductTypeCascade();
    renderAttrRegistrySection();
  });
  document.getElementById('attrRegProductTypeFilter')?.addEventListener('change', renderAttrRegistrySection);
  document.getElementById('attrRegProductType')?.addEventListener('input', updateAttrRegFieldVisibility);
  document.getElementById('attrRegProductType')?.addEventListener('change', updateAttrRegFieldVisibility);
  document.getElementById('attrSignalTypeFilter')?.addEventListener('change', renderPlotSignalsSection);
  document.getElementById('attrSignalStatusFilter')?.addEventListener('change', renderPlotSignalsSection);
}

// ── Orchestration ──
async function onAttributesTabActivated() {
  if (attributesLoaded) return;
  attributesLoaded = true;
  initAttrTierFilters();
  initAttrLevelFilters();
  initAttrDimFilters();
  initAttrRegistryFilters();
  initAttrSignalFilters();
  initAttributesTabEvents();
  await Promise.all([attrTierFiltersReady, attrLevelFiltersReady, attrDimFiltersReady, attrRegistryFiltersReady, attrSignalFiltersReady]);
  renderZoneTierSection();
  renderLevelAnalysisSection();
  renderDimensionConsistencySection();
  renderAttrRegistrySection();
  renderPlotSignalsSection();
}

function refreshAttributesForBigLotFilter() {
  if (!attributesLoaded) return;
  renderZoneTierSection();
  renderLevelAnalysisSection();
  renderDimensionConsistencySection();
}

window.onAttributesTabActivated = onAttributesTabActivated;
window.refreshAttributesForBigLotFilter = refreshAttributesForBigLotFilter;
window.renderZoneTierSection = renderZoneTierSection;
window.renderLevelAnalysisSection = renderLevelAnalysisSection;
window.renderDimensionConsistencySection = renderDimensionConsistencySection;
window.exportZoneTiersExcel = exportZoneTiersExcel;
window.exportDimensionConsistencyExcel = exportDimensionConsistencyExcel;
window.renderAttrRegistrySection = renderAttrRegistrySection;
window.openAttrRegistryModal = openAttrRegistryModal;
window.renderPlotSignalsSection = renderPlotSignalsSection;
window.exportPlotSignalsExcel = exportPlotSignalsExcel;
