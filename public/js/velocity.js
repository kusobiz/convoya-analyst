/* velocity.js — Sales Velocity tab: cascading filters, trend chart, trend table */

const SPLIT_BY_OPTIONS = [
  { value: 'none',        label: 'None' },
  { value: 'branch',      label: 'Branch' },
  { value: 'productType', label: 'Product Type' },
  { value: 'zone',        label: 'Zone' },
  { value: 'level',       label: 'Level' },
  { value: 'eyeLevel',    label: 'Eye Level/Non-Eye Level' },
  { value: 'lotType',     label: 'Lot Type' },
];

const VELO_PALETTE = [C.navy, C.blue, C.green, C.amber, C.red, C.gold, '#8B5CF6', '#14B8A6', '#EC4899', '#6B7280'];
function veloColor(i) { return VELO_PALETTE[i % VELO_PALETTE.length]; }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function veloFormatMonth(ym) {
  const y = ym.slice(0, 4);
  const m = parseInt(ym.slice(4, 6), 10);
  return `${MONTH_ABBR[m - 1] || ym.slice(4, 6)} ${y}`;
}

const veloFiltersUI = {};
// lastResult is the time-period-trimmed view actually rendered; rawResult is the untrimmed
// fetch — kept around so switching periods just re-slices client-side instead of re-querying,
// and so MoM/YoY % lookups can reach outside the visible window for their prior-period value.
const veloState = { metric: 'units', lastResult: null, rawResult: null };
let veloSortState = { key: 'month', dir: 'asc' };
let veloTableView = 'values'; // 'values' | 'pct'
let veloFiltersReady = null;
let veloDateRange = { min: null, max: null };
let veloPeriodState = { mode: 'preset', preset: '24m', customFrom: null, customTo: null };
// Once the user has run a search, every subsequent filter/Split By change re-runs it
// automatically — before that first search, changes only refresh the cascading dropdowns.
let veloHasSearched = false;

// 'simple' = the original single-query Split By behavior; 'custom' = the independent
// multi-series builder below, where each series carries its own location filters.
let veloCompareMode = 'simple';
// Tracks structured-vs-flat product type mode (from the last cascade fetch) so it can be
// combined with veloCompareMode in one visibility pass — see veloUpdateFieldVisibility().
let veloMaterialMode = null;

const csFiltersUI = {}; // MultiSelects inside the "Add Comparison Series" modal
const MAX_CUSTOM_SERIES = 6;
let veloCustomSeries = []; // [{ filters: {branch,zone,suiteNo,section,level,eyeLevel,lotType}, label }]

let veloChartType = 'line'; // 'line' | 'stacked-area' | 'grouped-bar'

// Eye Level/Non Eye Level is essentially always blank (0% populated) for these flat-land
// product types, vs 94-100% populated for every other product — so the filter is noise here.
const NO_EYE_LEVEL_PRODUCTS = ['NV Burial Plot', 'NV Pet Burial Plot', 'NV Seed', 'NV Urn Burial Plot'];

// Hide only when every selected Product Type is one of the flat-land types — no selection
// ("All") or any mix that includes an Eye-Level-bearing type keeps the filter visible.
function veloEyeLevelVisible() {
  const selected = veloFiltersUI.productType.getValues();
  if (!selected.length) return true;
  return selected.some(pt => !NO_EYE_LEVEL_PRODUCTS.includes(pt));
}

async function fetchVeloJSON(path, body) {
  const res = await fetch(`/api/velocity/${path}`, {
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

function getVeloFilterValues() {
  return {
    branch:      veloFiltersUI.branch.getValues(),
    productType: veloFiltersUI.productType.getValues(),
    zone:        veloFiltersUI.zone.getValues(),
    suiteNo:     veloFiltersUI.suiteNo.getValues(),
    section:     veloFiltersUI.section.getValues(),
    level:       veloFiltersUI.level.getValues(),
    eyeLevel:    veloFiltersUI.eyeLevel.getValues(),
    lotType:     veloFiltersUI.lotType.getValues(),
  };
}

// ── Simple Split filter-context summary ──
// Simple Split's lines all share one underlying filter set (only Split By varies between
// them), so the active selections are worth surfacing in one place — above the chart, and
// echoed into the tooltip — rather than making the user re-check eight dropdowns to know what
// they're looking at. Only dimensions actually narrowed from "All" are included.
function veloBuildFilterSummaryParts() {
  const f = getVeloFilterValues();
  const parts = [];
  if (f.branch.length) parts.push(`Branch ${f.branch.join('/')}`);
  if (f.productType.length) parts.push(f.productType.map(stripNVPrefix).join('/'));
  if (f.zone.length) parts.push(`Zone ${f.zone.join('/')}`);
  if (f.suiteNo.length) parts.push(`Suite ${f.suiteNo.join('/')}`);
  if (f.section.length) parts.push(`Section ${f.section.join('/')}`);
  if (f.level.length) parts.push(`Level ${f.level.join('/')}`);
  if (f.eyeLevel.length) parts.push(f.eyeLevel.join('/'));
  if (f.lotType.length) parts.push(f.lotType.join('/'));
  return parts;
}

function veloBuildFilterSummaryLine() {
  const parts = veloBuildFilterSummaryParts();
  const splitBy = document.getElementById('veloSplitBy')?.value || 'none';
  const splitLabel = SPLIT_BY_OPTIONS.find(o => o.value === splitBy)?.label;
  if (splitBy !== 'none' && splitLabel) parts.push(`Split by: ${splitLabel}`);
  return parts.length ? `Showing: ${parts.join(' • ')}` : 'Showing: All data (no filters applied)';
}

function renderVeloFilterSummary() {
  const el = document.getElementById('veloFilterSummary');
  if (el) el.textContent = veloBuildFilterSummaryLine();
}

// Scoped to #tab-velocity so this doesn't collide with Lot Drill-Down's own
// applyLotModeUI(), which toggles every .structured-only/.flat-only element document-wide.
// An element can be gated by structured/flat material mode, simple-vs-custom compare mode,
// or both (e.g. the main filter row's Zone field) — recomputing every flag in one pass avoids
// two independent toggles fighting over the same element's inline style.
function veloUpdateFieldVisibility() {
  const eyeLevelOk = veloEyeLevelVisible();
  document.querySelectorAll('#tab-velocity .velo-structured-only, #tab-velocity .velo-simple-only, #tab-velocity .velo-custom-only, #tab-velocity .velo-eyelevel-only')
    .forEach(el => {
      let visible = true;
      if (el.classList.contains('velo-structured-only') && veloMaterialMode !== 'structured') visible = false;
      if (el.classList.contains('velo-simple-only') && veloCompareMode !== 'simple') visible = false;
      if (el.classList.contains('velo-custom-only') && veloCompareMode !== 'custom') visible = false;
      if (el.classList.contains('velo-eyelevel-only') && !eyeLevelOk) visible = false;
      el.style.display = visible ? '' : 'none';
    });
}

// selectAllTopLevel is only ever passed true from initVelocityFilters()'s one-time initial
// call — every subsequent cascade refresh (any filter's onChange) must leave it false, or a
// narrowed Branch/Product Type selection would get silently reset back to "every value" the
// next time any other filter changes.
async function refreshVelocityCascade({ selectAllTopLevel = false } = {}) {
  const filters = getVeloFilterValues();
  try {
    const result = await fetchVeloJSON('filters', filters);
    veloFiltersUI.branch.setOptions(result.branches || [], selectAllTopLevel ? { selectAll: true } : undefined);
    veloFiltersUI.productType.setOptions(result.productTypes || [], selectAllTopLevel ? { selectAll: true } : undefined);
    veloFiltersUI.zone.setOptions(result.zones || []);
    veloFiltersUI.suiteNo.setOptions(result.suiteNos || []);
    veloFiltersUI.section.setOptions(result.sections || []);
    veloFiltersUI.level.setOptions(result.levels || []);
    veloFiltersUI.eyeLevel.setOptions(result.eyeLevels || []);
    veloFiltersUI.lotType.setOptions(result.lotTypes || []);
    veloMaterialMode = result.mode;
    veloUpdateFieldVisibility();
    if (result.dateRange) populateVeloPeriodDropdowns(result.dateRange);
    renderVeloFilterSummary();
  } catch (e) {
    console.error('[velocity] refreshVelocityCascade failed:', e);
  }
}

// Wired as every filter MultiSelect's onChange: re-derives the cascade (which may drop a
// selection that's no longer valid, e.g. a Zone that doesn't exist for a newly-narrowed
// Product Type), then — once a search has already run once — re-fetches the trend against
// the corrected, current filter state so the chart/table actually reflect the narrowed query.
async function onVelocityFilterChanged() {
  await refreshVelocityCascade();
  if (veloHasSearched) generateVelocityTrend();
}

function initVelocityFilters() {
  veloFiltersUI.branch = new MultiSelect('veloBranch', {
    placeholder: 'All branches',
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.productType = new MultiSelect('veloProductType', {
    placeholder: 'All product types',
    displayFn: stripNVPrefix,
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.zone = new MultiSelect('veloZone', {
    placeholder: 'All zones',
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.suiteNo = new MultiSelect('veloSuite', {
    placeholder: 'All suites',
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.section = new MultiSelect('veloSection', {
    placeholder: 'All sections',
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.level = new MultiSelect('veloLevel', {
    placeholder: 'All levels',
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.eyeLevel = new MultiSelect('veloEyeLevel', {
    placeholder: 'All',
    onChange: onVelocityFilterChanged,
  });
  veloFiltersUI.lotType = new MultiSelect('veloLotType', {
    placeholder: 'All lot types',
    onChange: onVelocityFilterChanged,
  });

  veloMaterialMode = null;
  veloUpdateFieldVisibility();

  const splitSel = document.getElementById('veloSplitBy');
  if (splitSel) {
    splitSel.innerHTML = SPLIT_BY_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    splitSel.value = 'none';
    splitSel.addEventListener('change', () => {
      renderVeloFilterSummary();
      if (veloHasSearched) generateVelocityTrend();
    });
  }

  veloFiltersReady = refreshVelocityCascade({ selectAllTopLevel: true });
}

// Branch/Product Type default to "All" selected (see initVelocityFilters), consistent with
// Pricing Intelligence's own default-to-All — so the very first tab open can render a full
// aggregate trend immediately instead of the empty "Select filters and click Generate Trend"
// state. Guarded so a later revisit doesn't stomp on filters the user has since changed.
let veloLoaded = false;
async function onVelocityTabActivated() {
  if (veloLoaded) return;
  veloLoaded = true;
  await veloFiltersReady;
  generateVelocityTrend();
}
window.onVelocityTabActivated = onVelocityTabActivated;

// Quick action: sets up the standard "which branches are moving this product" view — Split
// By Branch with every branch visible (no Branch pick narrowing the set), leaving every other
// filter (Zone/Suite No/Section/Level/Eye Level/Lot Type) exactly as the user already has them.
async function compareBranches() {
  veloFiltersUI.branch.clearAllSilent();
  const splitSel = document.getElementById('veloSplitBy');
  if (splitSel) splitSel.value = 'branch';
  await refreshVelocityCascade();
  generateVelocityTrend();
}

// ── Simple Split / Custom Comparison mode toggle ──
function initVelocityCompareModeToggle() {
  const bar = document.getElementById('veloCompareModeToggle');
  bar?.addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab[data-compare-mode]');
    if (!btn || btn.classList.contains('active')) return;
    bar.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    veloCompareMode = btn.dataset.compareMode;
    veloUpdateFieldVisibility();
    renderVeloFilterSummary();
    // Switching modes changes what a "result" even means (one query vs several independent
    // series) — clear whatever's on screen rather than show a stale chart from the other mode.
    veloHasSearched = false;
    veloState.rawResult = null;
    veloState.lastResult = null;
    showVelocityEmpty(veloCompareMode === 'custom'
      ? 'Add series and click Generate Comparison.'
      : 'Select filters and click Generate Trend.');
  });
}

// ── Custom Comparison: independent multi-series builder ──
// Each series in veloCustomSeries carries its own Branch/Zone/Suite No/Section/Level/Eye
// Level/Lot Type — configured via the "Add Comparison Series" modal — while Product Type,
// metric, and the time period selector stay global so every series lands on one shared chart.
function getCustomSeriesModalFilterValues() {
  return {
    branch:   csFiltersUI.branch.getValues(),
    zone:     csFiltersUI.zone.getValues(),
    suiteNo:  csFiltersUI.suiteNo.getValues(),
    section:  csFiltersUI.section.getValues(),
    level:    csFiltersUI.level.getValues(),
    eyeLevel: csFiltersUI.eyeLevel.getValues(),
    lotType:  csFiltersUI.lotType.getValues(),
  };
}

// Cascades the modal's own fields, scoped by the shared/global Product Type plus whatever
// the modal itself has selected so far — independent of the main filter row's Branch/Zone/etc.
async function refreshCustomSeriesCascade() {
  const filters = { productType: veloFiltersUI.productType.getValues(), ...getCustomSeriesModalFilterValues() };
  try {
    const result = await fetchVeloJSON('filters', filters);
    csFiltersUI.branch.setOptions(result.branches || []);
    csFiltersUI.zone.setOptions(result.zones || []);
    csFiltersUI.suiteNo.setOptions(result.suiteNos || []);
    csFiltersUI.section.setOptions(result.sections || []);
    csFiltersUI.level.setOptions(result.levels || []);
    csFiltersUI.eyeLevel.setOptions(result.eyeLevels || []);
    csFiltersUI.lotType.setOptions(result.lotTypes || []);
    veloMaterialMode = result.mode;
    veloUpdateFieldVisibility();
  } catch (e) {
    console.error('[velocity] refreshCustomSeriesCascade failed:', e);
  }
}

function openAddSeriesModal() {
  if (veloCustomSeries.length >= MAX_CUSTOM_SERIES) {
    alert(`You can compare up to ${MAX_CUSTOM_SERIES} series at once — remove one before adding another.`);
    return;
  }
  Object.values(csFiltersUI).forEach(ms => ms.clearAllSilent());
  refreshCustomSeriesCascade();
  document.getElementById('veloSeriesModal')?.removeAttribute('hidden');
}

function closeAddSeriesModal() {
  document.getElementById('veloSeriesModal')?.setAttribute('hidden', '');
}

// Auto-label from whatever the series actually narrows down — dimensions left at "All" are
// skipped entirely (e.g. Branch KL + Eye Level with everything else All -> "KL - Eye Level").
function buildCustomSeriesLabel(filters) {
  const order = ['branch', 'zone', 'suiteNo', 'section', 'level', 'eyeLevel', 'lotType'];
  const parts = order
    .map(k => (filters[k] || []).length ? filters[k].join('/') : null)
    .filter(Boolean);
  return parts.length ? parts.join(' - ') : `Series ${veloCustomSeries.length + 1}`;
}

function confirmAddSeries() {
  if (veloCustomSeries.length >= MAX_CUSTOM_SERIES) {
    alert(`You can compare up to ${MAX_CUSTOM_SERIES} series at once — remove one before adding another.`);
    return;
  }
  const filters = getCustomSeriesModalFilterValues();
  veloCustomSeries.push({ filters, label: buildCustomSeriesLabel(filters) });
  renderCustomSeriesList();
  closeAddSeriesModal();
}

function renderCustomSeriesList() {
  const el = document.getElementById('veloCustomSeriesList');
  if (!el) return;
  if (!veloCustomSeries.length) {
    el.innerHTML = `<div class="velo-custom-empty">No series added yet — click "Add Series" to build a comparison.</div>`;
    return;
  }
  el.innerHTML = veloCustomSeries.map((s, i) => `
    <div class="velo-custom-series-chip">
      <span class="velo-custom-series-color" style="background:${veloColor(i)}"></span>
      <span class="velo-custom-series-label" data-idx="${i}" title="Click to rename">${escapeHtml(s.label)}</span>
      <button type="button" class="velo-custom-series-remove" data-idx="${i}" aria-label="Remove series">&times;</button>
    </div>
  `).join('');
}

// Renaming after results are already on screen relabels the matching series in place — the
// underlying data hasn't changed, so there's no need to re-fetch just to update a legend label.
function renameCustomSeries(idx, newLabel) {
  veloCustomSeries[idx].label = newLabel;
  renderCustomSeriesList();
  if (veloState.rawResult?.series[idx]) {
    veloState.rawResult.series[idx].splitValue = newLabel;
    if (veloState.lastResult?.series[idx]) veloState.lastResult.series[idx].splitValue = newLabel;
    renderVelocityChart();
    renderVelocityTable();
  }
}

function startRenameSeries(labelEl, idx) {
  const series = veloCustomSeries[idx];
  if (!series) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'velo-custom-series-label-input';
  input.value = series.label;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener('blur', () => renameCustomSeries(idx, input.value.trim() || series.label));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = series.label; input.blur(); }
  });
}

function onCustomSeriesListClick(e) {
  const removeBtn = e.target.closest('.velo-custom-series-remove');
  if (removeBtn) {
    veloCustomSeries.splice(Number(removeBtn.dataset.idx), 1);
    renderCustomSeriesList();
    return;
  }
  const label = e.target.closest('.velo-custom-series-label');
  if (label) startRenameSeries(label, Number(label.dataset.idx));
}

// Fetches each series independently (its own location filters) against the shared Product
// Type, with splitBy 'none' so each call collapses to one aggregate trend — then stitches the
// results into the same {series:[{splitValue,points}]} shape Simple Split produces, so the
// existing chart/table/export renderers need no special-casing for Custom Comparison mode.
async function generateVelocityComparison() {
  if (!veloCustomSeries.length) { alert('Add at least one series first.'); return; }
  veloHasSearched = true;
  showVelocityLoading();
  const productType = veloFiltersUI.productType.getValues();
  try {
    const results = await Promise.all(
      veloCustomSeries.map(cs => fetchVeloJSON('sales', { ...cs.filters, productType, splitBy: 'none' }))
    );
    const combined = {
      series: veloCustomSeries.map((cs, i) => ({
        splitValue: cs.label,
        points: results[i].series[0]?.points || [],
      })),
    };
    veloState.rawResult = combined;
    veloState.lastResult = veloApplyPeriodFilter(combined);
    const hasData = combined.series.some(s => s.points.length > 0);
    if (!hasData) {
      showVelocityEmpty('No sold lots match these series filters.');
      return;
    }
    const hasDataInPeriod = veloState.lastResult.series.some(s => s.points.length > 0);
    if (!hasDataInPeriod) {
      showVelocityEmpty('No sold lots in this period.');
      return;
    }
    renderVelocityChart();
    renderVelocityTable();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[velocity] generateVelocityComparison failed:', err);
    showVelocityEmpty('Error: ' + err.message);
  }
}

function initCustomSeriesModal() {
  csFiltersUI.branch = new MultiSelect('csBranch', { placeholder: 'All branches', onChange: refreshCustomSeriesCascade });
  csFiltersUI.zone = new MultiSelect('csZone', { placeholder: 'All zones', onChange: refreshCustomSeriesCascade });
  csFiltersUI.suiteNo = new MultiSelect('csSuite', { placeholder: 'All suites', onChange: refreshCustomSeriesCascade });
  csFiltersUI.section = new MultiSelect('csSection', { placeholder: 'All sections', onChange: refreshCustomSeriesCascade });
  csFiltersUI.level = new MultiSelect('csLevel', { placeholder: 'All levels', onChange: refreshCustomSeriesCascade });
  csFiltersUI.eyeLevel = new MultiSelect('csEyeLevel', { placeholder: 'All', onChange: refreshCustomSeriesCascade });
  csFiltersUI.lotType = new MultiSelect('csLotType', { placeholder: 'All lot types', onChange: refreshCustomSeriesCascade });

  document.getElementById('btnAddSeries')?.addEventListener('click', openAddSeriesModal);
  document.getElementById('btnCancelSeries')?.addEventListener('click', closeAddSeriesModal);
  document.getElementById('btnConfirmSeries')?.addEventListener('click', confirmAddSeries);
  document.getElementById('btnGenerateComparison')?.addEventListener('click', generateVelocityComparison);
  document.getElementById('veloCustomSeriesList')?.addEventListener('click', onCustomSeriesListClick);

  renderCustomSeriesList();
}

// ── Time period selector ──
// yearMonth strings are plain YYYYMM; add/subtract by decomposing to (year, month) rather
// than treating them as numbers, since month arithmetic needs to carry across year boundaries.
function veloYmAddMonths(ym, delta) {
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(4, 6), 10) + delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

function veloBuildMonthRange(minYm, maxYm) {
  const out = [];
  for (let cur = minYm; cur <= maxYm; cur = veloYmAddMonths(cur, 1)) out.push(cur);
  return out;
}

// Options only need to be built once — dateRange is the full dataset's span, independent of
// the active filters, so it doesn't change as the user tweaks Branch/Product Type/etc. Skips
// re-populating (which would blow away a user's custom From/To pick) once already filled.
function populateVeloPeriodDropdowns(dateRange) {
  const { min, max } = dateRange;
  if (!min || !max || (veloDateRange.min === min && veloDateRange.max === max)) return;
  veloDateRange = { min, max };
  const fromSel = document.getElementById('veloPeriodFrom');
  const toSel = document.getElementById('veloPeriodTo');
  if (!fromSel || !toSel) return;
  const optsHtml = veloBuildMonthRange(min, max).map(ym => `<option value="${ym}">${veloFormatMonth(ym)}</option>`).join('');
  fromSel.innerHTML = optsHtml;
  toSel.innerHTML = optsHtml;
  fromSel.value = min;
  toSel.value = max;
}

// Resolves the active preset/custom selection to a concrete [from, to] YYYYMM window.
// Presets anchor to the dataset's actual max month (veloDateRange.max), not today's calendar
// date, since sold-lot data may lag or the dataset may not cover the current month at all.
function veloGetPeriodBounds() {
  if (veloPeriodState.mode === 'custom') {
    return { from: veloPeriodState.customFrom, to: veloPeriodState.customTo };
  }
  const maxYm = veloDateRange.max;
  const monthsBack = { '12m': 11, '24m': 23, '3y': 35 }[veloPeriodState.preset];
  if (!maxYm || monthsBack === undefined) return { from: null, to: null }; // 'all' or no data yet
  return { from: veloYmAddMonths(maxYm, -monthsBack), to: maxYm };
}

function veloApplyPeriodFilter(rawResult) {
  if (!rawResult) return rawResult;
  const { from, to } = veloGetPeriodBounds();
  if (!from && !to) return rawResult;
  return {
    series: rawResult.series.map(s => ({
      splitValue: s.splitValue,
      points: s.points.filter(p => (!from || p.yearMonth >= from) && (!to || p.yearMonth <= to)),
    })),
  };
}

function applyVeloPeriodAndRender() {
  if (!veloState.rawResult) return;
  veloState.lastResult = veloApplyPeriodFilter(veloState.rawResult);
  const hasData = veloState.lastResult.series.some(s => s.points.length > 0);
  if (!hasData) {
    showVelocityEmpty('No sold lots in this period.');
    return;
  }
  renderVelocityChart();
  renderVelocityTable();
}

function initVelocityPeriodControls() {
  const presetBar = document.getElementById('veloPeriodPresets');
  presetBar?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-period]');
    if (!btn) return;
    presetBar.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    veloPeriodState = { mode: 'preset', preset: btn.dataset.period };
    applyVeloPeriodAndRender();
  });

  const fromSel = document.getElementById('veloPeriodFrom');
  const toSel = document.getElementById('veloPeriodTo');
  const onCustomChange = () => {
    if (!fromSel.value || !toSel.value) return;
    let from = fromSel.value, to = toSel.value;
    if (from > to) { to = from; toSel.value = to; } // From can't sit after To — snap To up to match
    veloPeriodState = { mode: 'custom', customFrom: from, customTo: to };
    presetBar?.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    applyVeloPeriodAndRender();
  };
  fromSel?.addEventListener('change', onCustomChange);
  toSel?.addEventListener('change', onCustomChange);
}

function initVelocityMetricToggle() {
  document.getElementById('veloMetricToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab[data-metric]');
    if (!btn) return;
    document.querySelectorAll('#veloMetricToggle .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    veloState.metric = btn.dataset.metric;
    if (veloState.lastResult) { renderVelocityChart(); renderVelocityTable(); }
  });
}

// Chart type only changes how the already-fetched series render, so this never re-queries —
// it just rebuilds the Chart.js config from veloState.lastResult, same as the metric toggle.
function initVelocityChartTypeToggle() {
  document.getElementById('veloChartTypeToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab[data-chart-type]');
    if (!btn) return;
    document.querySelectorAll('#veloChartTypeToggle .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    veloChartType = btn.dataset.chartType;
    if (veloState.lastResult) renderVelocityChart();
  });
}

function initVelocityTableViewToggle() {
  document.getElementById('veloTableViewToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab[data-view]');
    if (!btn) return;
    document.querySelectorAll('#veloTableViewToggle .subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    veloTableView = btn.dataset.view;
    // Values view sorts per-series columns by index; that key is meaningless once the
    // table reshapes into MoM/YoY columns (and vice versa), so reset to month asc on switch.
    veloSortState = { key: 'month', dir: 'asc' };
    if (veloState.lastResult) renderVelocityTable();
  });
}

function setVelocityChartVisible(visible, message) {
  const wrap = document.getElementById('velocityChartWrap');
  const empty = document.getElementById('velocityChartEmpty');
  if (wrap) wrap.style.display = visible ? '' : 'none';
  if (empty) {
    empty.style.display = visible ? 'none' : '';
    if (message) empty.textContent = message;
  }
}

function showVelocityLoading() {
  setVelocityChartVisible(false, 'Loading…');
  const head = document.getElementById('velocityHeadRow');
  const body = document.getElementById('velocityBody');
  if (head) head.innerHTML = '';
  if (body) body.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">Loading…</td></tr>`;
}

function showVelocityEmpty(message) {
  setVelocityChartVisible(false, message);
  const head = document.getElementById('velocityHeadRow');
  const body = document.getElementById('velocityBody');
  if (head) head.innerHTML = '';
  if (body) body.innerHTML = `<tr><td style="text-align:center;color:var(--muted)">${escapeHtml(message)}</td></tr>`;
}

function veloMonthUnion(series) {
  const set = new Set();
  series.forEach(s => s.points.forEach(p => set.add(p.yearMonth)));
  return Array.from(set).sort();
}

// Per-chart-type dataset styling — same underlying {label, data, rawPoints} for every type,
// only the visual encoding (fill/line vs solid bars) changes. Stacked Area needs fill:true
// plus scales.y.stacked (set by the caller); Grouped Bar relies on Chart.js's default
// (non-stacked) bar clustering, so it needs no stacking config at all.
function veloDatasetStyle(chartType, color) {
  if (chartType === 'grouped-bar') {
    return { backgroundColor: color, borderColor: color, borderWidth: 1 };
  }
  if (chartType === 'stacked-area') {
    return { borderColor: color, backgroundColor: color + '55', fill: true, spanGaps: true, tension: 0.25, pointRadius: 1 };
  }
  return { borderColor: color, backgroundColor: color + '33', fill: false, spanGaps: true, tension: 0.25, pointRadius: 2 };
}

function renderVelocityChart() {
  destroyChart('velocity');
  const result = veloState.lastResult;
  const ctx = document.getElementById('chartVelocity');
  if (!ctx || !result) return;
  setVelocityChartVisible(true);

  const months = veloMonthUnion(result.series);
  const metric = veloState.metric;
  const chartType = veloChartType;
  const isBar = chartType === 'grouped-bar';
  const isStackedArea = chartType === 'stacked-area';

  const datasets = result.series.map((s, i) => {
    const byMonth = new Map(s.points.map(p => [p.yearMonth, p]));
    const rawPoints = months.map(m => byMonth.get(m) || null);
    return {
      label: s.splitValue,
      data: rawPoints.map(p => p ? p[metric] : null),
      rawPoints,
      ...veloDatasetStyle(chartType, veloColor(i)),
    };
  });

  // Every Simple Split line shares one filter set — surface it in the tooltip footer too, so
  // the context is visible on hover without looking back up at the summary line. Custom
  // Comparison series each carry their own filters instead, so this doesn't apply there.
  const tooltipFooterParts = veloCompareMode === 'simple' ? veloBuildFilterSummaryParts() : [];
  const tooltipFooter = tooltipFooterParts.length ? tooltipFooterParts.join(' • ') : null;

  charts.velocity = new Chart(ctx, {
    type: isBar ? 'bar' : 'line',
    data: { labels: months.map(veloFormatMonth), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (tCtx) => {
              const p = tCtx.dataset.rawPoints[tCtx.dataIndex];
              if (!p) return ` ${tCtx.dataset.label}: no sales`;
              // "at this point" = across every series sharing this same month (x-index) — not
              // a running/grand total — same formula whether rendered as line, stacked area,
              // or grouped bar, since all three share this one tooltip callback.
              const pointTotal = sumFinite(tCtx.chart.data.datasets.map(ds => ds.data[tCtx.dataIndex]));
              return ` ${tCtx.dataset.label}: ${fmt(p.units)} units · ${myr(p.value)}${pctOfTotalLabel(tCtx.parsed.y, pointTotal, 'total across all series at this point')}`;
            },
            footer: tooltipFooter ? () => tooltipFooter : undefined,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          stacked: isStackedArea,
          ticks: { callback: v => metric === 'value' ? myrCompact(v) : fmt(v) },
          grid: { color: '#E2E6EE' },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function buildVelocityRows() {
  const result = veloState.lastResult;
  const months = veloMonthUnion(result.series);
  const maps = result.series.map(s => new Map(s.points.map(p => [p.yearMonth, p])));
  return months.map(m => ({ month: m, values: maps.map(mp => mp.get(m) || null) }));
}

function sortVelocityRows(rows) {
  const { key, dir } = veloSortState;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'month') return a.month.localeCompare(b.month) * sign;
    const idx = Number(key);
    const av = a.values[idx] ? a.values[idx][veloState.metric] : 0;
    const bv = b.values[idx] ? b.values[idx][veloState.metric] : 0;
    return (av - bv) * sign;
  });
}

// ── MoM % / YoY % ──
function veloPrevMonth(ym) {
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(4, 6), 10) - 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}${String(m).padStart(2, '0')}`;
}

function veloYearAgoMonth(ym) {
  const y = parseInt(ym.slice(0, 4), 10) - 1;
  return `${y}${ym.slice(4, 6)}`;
}

// null (blank/dash) when either side is missing or the prior period is zero — a % change
// against zero (or against a month with no sold lots at all) isn't a meaningful ratio.
function veloPctChange(curr, prev) {
  if (curr === null || curr === undefined || prev === null || prev === undefined || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function buildVelocityPctRows() {
  const result = veloState.lastResult;
  const months = veloMonthUnion(result.series);
  // Prior/year-ago lookups reach into the untrimmed fetch, not the period-trimmed view — e.g.
  // a "Last 12 Months" window's first row still needs the month just before it for MoM %.
  const maps = (veloState.rawResult || result).series.map(s => new Map(s.points.map(p => [p.yearMonth, p])));
  const metric = veloState.metric;
  return months.map(m => {
    const prevYm = veloPrevMonth(m);
    const yoyYm = veloYearAgoMonth(m);
    const cells = maps.map(mp => {
      const currVal = mp.get(m)?.[metric] ?? null;
      const prevVal = mp.get(prevYm)?.[metric] ?? null;
      const yoyVal = mp.get(yoyYm)?.[metric] ?? null;
      return {
        mom: veloPctChange(currVal, prevVal),
        yoy: veloPctChange(currVal, yoyVal),
      };
    });
    return { month: m, cells };
  });
}

function renderPctCell(pct) {
  if (pct === null || pct === undefined || !isFinite(pct)) return `<td class="pct-none">—</td>`;
  const cls = pct > 0 ? 'pct-up' : pct < 0 ? 'pct-down' : 'pct-none';
  const sign = pct > 0 ? '+' : '';
  return `<td class="${cls}">${sign}${pct.toFixed(1)}%</td>`;
}

function renderVelocityValuesTable(result, head, body) {
  const sortArrow = (key) => veloSortState.key === key
    ? `<span class="sort-arrow">${veloSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';

  head.innerHTML = `<th class="sortable-th${veloSortState.key === 'month' ? ' sorted' : ''}" data-velo-key="month">Month${sortArrow('month')}</th>` +
    result.series.map((s, i) => `<th class="sortable-th${veloSortState.key === String(i) ? ' sorted' : ''}" data-velo-key="${i}">${escapeHtml(s.splitValue)}${sortArrow(String(i))}</th>`).join('');

  const rows = sortVelocityRows(buildVelocityRows());
  const metric = veloState.metric;
  body.innerHTML = rows.map(r => {
    const cells = r.values.map(v => `<td>${v ? (metric === 'value' ? myr(v.value) : fmt(v.units)) : '—'}</td>`).join('');
    return `<tr><td>${veloFormatMonth(r.month)}</td>${cells}</tr>`;
  }).join('');
}

function renderVelocityPctTable(result, head, body) {
  const sortArrow = (key) => veloSortState.key === key
    ? `<span class="sort-arrow">${veloSortState.dir === 'asc' ? '▲' : '▼'}</span>` : '';

  head.innerHTML = `<th class="sortable-th${veloSortState.key === 'month' ? ' sorted' : ''}" data-velo-key="month">Month${sortArrow('month')}</th>` +
    result.series.map(s => `<th>${escapeHtml(s.splitValue)} MoM %</th><th>${escapeHtml(s.splitValue)} YoY %</th>`).join('');

  const sign = veloSortState.dir === 'asc' ? 1 : -1;
  const rows = [...buildVelocityPctRows()].sort((a, b) => a.month.localeCompare(b.month) * sign);

  body.innerHTML = rows.map(r => {
    const cells = r.cells.map(c => renderPctCell(c.mom) + renderPctCell(c.yoy)).join('');
    return `<tr><td>${veloFormatMonth(r.month)}</td>${cells}</tr>`;
  }).join('');
}

function renderVelocityTable() {
  const result = veloState.lastResult;
  const head = document.getElementById('velocityHeadRow');
  const body = document.getElementById('velocityBody');
  if (!result || !head || !body) return;

  if (veloTableView === 'pct') renderVelocityPctTable(result, head, body);
  else renderVelocityValuesTable(result, head, body);
}

document.getElementById('velocityHeadRow')?.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-velo-key]');
  if (!th) return;
  const key = th.dataset.veloKey;
  veloSortState = veloSortState.key === key ? { key, dir: veloSortState.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
  renderVelocityTable();
});

// Split By Product Type returns the raw "NV "-prefixed Material Type Desc. value — the query
// itself must use the full value, but nothing downstream should render it. Stripping it once
// here means the chart legend/tooltip, table headers, and Excel/PDF export (all of which just
// treat splitValue as an opaque label) automatically show "Niche" instead of "NV Niche".
function veloStripProductTypeSplitLabels(result, splitBy) {
  if (splitBy !== 'productType') return result;
  return { series: result.series.map(s => ({ ...s, splitValue: stripNVPrefix(s.splitValue) })) };
}

async function generateVelocityTrend() {
  veloHasSearched = true;
  const filters = getVeloFilterValues();
  const splitBy = document.getElementById('veloSplitBy')?.value || 'none';
  const body = { ...filters, splitBy };
  console.log('[velocity] /api/velocity/sales request body:', body);
  showVelocityLoading();
  try {
    const result = veloStripProductTypeSplitLabels(await fetchVeloJSON('sales', body), splitBy);
    veloState.rawResult = result;
    veloState.lastResult = veloApplyPeriodFilter(result);
    const hasData = result.series.some(s => s.points.length > 0);
    if (!hasData) {
      showVelocityEmpty('No sold lots match these filters.');
      return;
    }
    const hasDataInPeriod = veloState.lastResult.series.some(s => s.points.length > 0);
    if (!hasDataInPeriod) {
      showVelocityEmpty('No sold lots in this period.');
      return;
    }
    renderVelocityChart();
    renderVelocityTable();
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') { showSessionExpired(); return; }
    console.error('[velocity] generateVelocityTrend failed:', err);
    showVelocityEmpty('Error: ' + err.message);
  }
}

function exportVelocityExcel() {
  const result = veloState.lastResult;
  if (!result || !result.series.length) { alert('No data to export. Generate a trend first.'); return; }
  if (typeof XLSX === 'undefined') { alert('Excel export library failed to load — check your connection and try again.'); return; }

  const metric = veloState.metric;
  const metricLabel = metric === 'value' ? 'Sales Value (MYR)' : 'Units Sold';
  const header = ['Month', ...result.series.map(s => s.splitValue)];
  const rows = buildVelocityRows(); // chronological ascending — canonical export order, independent of on-screen sort

  const aoa = [
    [`Sales Velocity — ${metricLabel}`],
    [],
    header,
    ...rows.map(r => [veloFormatMonth(r.month), ...r.values.map(v => v ? (metric === 'value' ? v.value : v.units) : 0)]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(() => ({ wch: 16 }));
  if (metric === 'value') {
    for (let r = 3; r < aoa.length; r++) {
      for (let c = 1; c < header.length; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].z = '"RM "#,##0';
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Velocity');
  XLSX.writeFile(wb, `sales_velocity_${metric}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Same jsPDF + jspdf-autotable pattern as the Zone Summary Matrix's PDF export (see
// exportMatrixPDF in dashboard.js): landscape A4, title/timestamp header, autoTable body,
// "Confidential" footer stamped on every page. The chart itself is captured via Chart.js's
// own toBase64Image() and embedded above the data table — always the Values view (not
// whatever MoM/YoY toggle is active on screen), matching the Excel export's convention.
function exportVelocityPDF() {
  const result = veloState.lastResult;
  if (!result || !result.series.length) { alert('No data to export. Generate a trend first.'); return; }
  if (typeof window.jspdf === 'undefined') { alert('PDF export library failed to load — check your connection and try again.'); return; }
  if (!charts.velocity) { alert('No chart to export. Generate a trend first.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  const contextLine = veloCompareMode === 'simple'
    ? veloBuildFilterSummaryLine().replace(/^Showing:\s*/, '')
    : `Custom Comparison — ${result.series.length} series`;
  const titleText = `Sales Velocity — ${contextLine}`;

  doc.setFontSize(14);
  doc.setTextColor(26, 44, 91);
  doc.text(titleText, margin, 36);
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 52);

  const canvasEl = document.getElementById('chartVelocity');
  const imgData = charts.velocity.toBase64Image();
  const imgWidth = pageWidth - margin * 2;
  const aspectRatio = canvasEl?.width && canvasEl?.height ? canvasEl.width / canvasEl.height : (imgWidth / 260);
  const imgHeight = imgWidth / aspectRatio;
  doc.addImage(imgData, 'PNG', margin, 66, imgWidth, imgHeight);

  const metric = veloState.metric;
  const header = ['Month', ...result.series.map(s => s.splitValue)];
  const rows = buildVelocityRows(); // chronological ascending, same as the Excel export

  doc.autoTable({
    startY: 66 + imgHeight + 20,
    head: [header],
    body: rows.map(r => [veloFormatMonth(r.month), ...r.values.map(v => v ? (metric === 'value' ? myr(v.value) : fmt(v.units)) : '—')]),
    styles: { fontSize: 8, cellPadding: 4, valign: 'middle', halign: 'center' },
    headStyles: { fillColor: [26, 44, 91], textColor: [255, 255, 255] },
    columnStyles: { 0: { fontStyle: 'bold' } },
    didDrawPage() {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text('Confidential — Nirvana Asia Group Central Region', margin, pageHeight - 18);
    },
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  doc.save(`Sales_Velocity_${timestamp}.pdf`);
}

initVelocityFilters();
initVelocityMetricToggle();
initVelocityChartTypeToggle();
initVelocityTableViewToggle();
initVelocityPeriodControls();
initVelocityCompareModeToggle();
initCustomSeriesModal();

window.generateVelocityTrend = generateVelocityTrend;
window.exportVelocityExcel = exportVelocityExcel;
window.exportVelocityPDF = exportVelocityPDF;
window.compareBranches = compareBranches;

// Called by dashboard.js's global header control on every Lot Size change — re-runs
// whichever mode (Simple Split vs Custom Comparison) the user last searched with, mirroring
// the existing veloHasSearched auto-rerun behavior for in-tab filter/Split By changes.
function refreshVelocityForBigLotFilter() {
  if (!veloHasSearched) return;
  if (veloCompareMode === 'custom') generateVelocityComparison();
  else generateVelocityTrend();
}
window.refreshVelocityForBigLotFilter = refreshVelocityForBigLotFilter;
