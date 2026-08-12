// Shared server-side display-formatting helpers — the Node/ESM counterpart to
// public/js/common.js. Every server-side module that renders a product name for display
// (report/PPT generation, AI Query/report context, computed labels sent to the client) must
// import stripProductPrefix from here rather than re-implementing the strip.

// Display-only: the DB's "Material Type Desc." values are all prefixed "NV "; queries always
// use the full value from the data, only rendering strips it.
export function stripProductPrefix(materialType) {
  return String(materialType || '').replace(/^NV\s+/i, '');
}
