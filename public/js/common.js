/* common.js — shared display-formatting helpers used across every tab. Loaded before all other
   tab scripts so its functions are available as globals everywhere. */

// Display-only: the DB's "Material Type Desc." values are all prefixed "NV "; queries always
// use the full value from the data, only rendering strips it. This is the single shared
// implementation — every tab (filter dropdowns, chart labels/tooltips, table cells, summary
// text, exports, AI Query context) must call this rather than re-implementing the strip.
function stripNVPrefix(materialType) {
  return String(materialType || '').replace(/^NV\s+/i, '');
}

// Shared chart-tooltip percentage formatter — "(X% of ...)" appended to a tooltip line, used
// across every Chart.js chart that shows a share-of-total figure. `value` is this segment's
// own number; `total` is whatever it's being compared against (chart grand total, this bar's
// own stack, this point's cross-series total, etc. — computed by the caller per chart type).
// Guards divide-by-zero (empty/all-null series) by simply omitting the parenthetical.
function pctOfTotalLabel(value, total, suffix) {
  if (!total || !isFinite(total)) return '';
  const p = (value / total) * 100;
  return ` (${p.toFixed(1)}% of ${suffix})`;
}

function sumFinite(arr) {
  return arr.reduce((s, v) => s + (typeof v === 'number' && isFinite(v) ? v : 0), 0);
}
