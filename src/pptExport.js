import PptxGenJS from 'pptxgenjs';
import {
  getOverview,
  getBranchSummary,
  getProductSummary,
  getBDFocusSummary,
  getAgedStock,
  getBranchProductMatrix,
  getPriceRangeSummary,
  getStatusBreakdown,
} from './reader.js';

// Colours
const NAVY   = '1A2C5B';
const GOLD   = 'C9A84C';
const WHITE  = 'FFFFFF';
const LIGHT  = 'F5F6F8';
const GREEN  = '1D9E75';
const AMBER  = 'EF9F27';
const RED    = 'E24B4A';
const BLUE   = '378ADD';
const TEXT   = '1A1A2E';

const SLIDE_W = 10;
const SLIDE_H = 7.5;
const FONT    = 'Calibri';

function pct(n)  { return Number(n).toFixed(1) + '%'; }
function myr(n)  { return 'MYR ' + Number(n).toLocaleString('en-MY', { maximumFractionDigits: 0 }); }
function num(n)  { return Number(n).toLocaleString('en-MY'); }

function sellColor(pct) {
  if (pct >= 80) return GREEN;
  if (pct >= 50) return BLUE;
  return RED;
}

function addSlideChrome(slide, title, slideNum) {
  // Navy header bar
  slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.6, fill: { color: NAVY } });
  slide.addText(title, {
    x: 0.2, y: 0, w: SLIDE_W - 0.6, h: 0.6,
    fontSize: 16, bold: true, color: WHITE, fontFace: FONT, valign: 'middle',
  });
  // Gold rule
  slide.addShape('rect', { x: 0, y: 0.6, w: SLIDE_W, h: 0.04, fill: { color: GOLD } });
  // Footer
  slide.addText('Confidential · Internal Use Only', {
    x: 0.2, y: SLIDE_H - 0.3, w: SLIDE_W - 1.2, h: 0.25,
    fontSize: 7, color: '888888', fontFace: FONT, italic: true,
  });
  slide.addText(String(slideNum), {
    x: SLIDE_W - 0.5, y: SLIDE_H - 0.3, w: 0.3, h: 0.25,
    fontSize: 7, color: '888888', fontFace: FONT, align: 'right',
  });
}

// Slide 1 — Cover
function addCoverSlide(pptx, monthYear) {
  const slide = pptx.addSlide();
  slide.background = { color: NAVY };
  // Gold accent line
  slide.addShape('rect', { x: 0.5, y: 3.2, w: 1.5, h: 0.06, fill: { color: GOLD } });
  slide.addText('Central Region Stock Analysis', {
    x: 0.5, y: 2.0, w: 9, h: 0.9,
    fontSize: 32, bold: true, color: WHITE, fontFace: FONT,
  });
  slide.addText(`YTD ${monthYear}`, {
    x: 0.5, y: 3.0, w: 9, h: 0.5,
    fontSize: 18, color: GOLD, fontFace: FONT,
  });
  slide.addText('Nirvana Asia Group', {
    x: SLIDE_W - 3.5, y: SLIDE_H - 0.6, w: 3.2, h: 0.4,
    fontSize: 11, color: GOLD, fontFace: FONT, align: 'right', italic: true,
  });
  slide.addText('Confidential · Internal Use Only', {
    x: 0.5, y: SLIDE_H - 0.6, w: 5, h: 0.4,
    fontSize: 8, color: '888888', fontFace: FONT, italic: true,
  });
}

// Slide 2 — Executive Snapshot
function addExecutiveSlide(pptx, commentary) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Executive Snapshot', 2);

  const ov = getOverview();
  const kpis = [
    { label: 'Total Stock',     value: num(ov.totalStock) },
    { label: 'Total Sold',      value: num(ov.totalSold) },
    { label: 'Balance Units',   value: num(ov.totalBalance) },
    { label: 'Sell-through',    value: pct(ov.sellThrough) },
    { label: 'Balance Value',   value: myr(ov.totalValue) },
  ];

  kpis.forEach((kpi, i) => {
    const x = 0.3 + i * 1.94;
    slide.addShape('rect', { x, y: 0.85, w: 1.75, h: 1.2,
      fill: { color: NAVY }, line: { color: GOLD, pt: 1 } });
    slide.addText(kpi.value, {
      x, y: 0.85, w: 1.75, h: 0.75,
      fontSize: 16, bold: true, color: GOLD, fontFace: FONT, align: 'center', valign: 'middle',
    });
    slide.addText(kpi.label, {
      x, y: 1.55, w: 1.75, h: 0.5,
      fontSize: 8, color: WHITE, fontFace: FONT, align: 'center', valign: 'middle',
    });
  });

  slide.addText('Management Commentary', {
    x: 0.3, y: 2.3, w: 9.4, h: 0.3,
    fontSize: 11, bold: true, color: NAVY, fontFace: FONT,
  });
  slide.addText(commentary, {
    x: 0.3, y: 2.65, w: 9.4, h: 4.4,
    fontSize: 10, color: TEXT, fontFace: FONT, wrap: true, valign: 'top',
  });
}

// Slide 3 — Branch Performance
function addBranchSlide(pptx) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Branch Performance', 3);

  const branches = getBranchSummary();

  // Table
  const rows = [
    [
      { text: 'Branch',       options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Stock',        options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Sold',         options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance',      options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance Value',options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Sell-through', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ],
    ...branches.map(b => [
      b.branch,
      num(b.totalStock),
      num(b.totalSold),
      num(b.totalBalance),
      myr(b.totalValue),
      { text: pct(b.sellThrough), options: { color: sellColor(b.sellThrough), bold: true } },
    ]),
  ];

  slide.addTable(rows, {
    x: 0.3, y: 0.75, w: 9.4, h: 3.5,
    fontSize: 9, fontFace: FONT,
    border: { pt: 0.5, color: 'CCCCCC' },
    colW: [1.2, 1.2, 1.2, 1.2, 2.0, 1.4],
    align: 'center',
  });

  // Bar chart
  slide.addChart('bar', [{
    name: 'Sell-through %',
    labels: branches.map(b => b.branch),
    values: branches.map(b => parseFloat(b.sellThrough.toFixed(1))),
  }], {
    x: 0.3, y: 4.35, w: 9.4, h: 2.7,
    barDir: 'col',
    chartColors: branches.map(b => sellColor(b.sellThrough)),
    showValue: true,
    dataLabelFontSize: 8,
    valAxisMaxVal: 100,
    showLegend: false,
    titleFontSize: 0,
  });
}

// Slide 4 — Product Analysis
function addProductSlide(pptx) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Product Analysis', 4);

  const products = getProductSummary();

  const rows = [
    [
      { text: 'Product',      options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Stock',        options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Sold',         options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance',      options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Sell-through', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Velocity',     options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ],
    ...products.map(p => {
      const velocity = p.sellThrough >= 80 ? 'Fast'
                     : p.sellThrough >= 60 ? 'Normal' : 'Slow';
      const vColor   = p.sellThrough >= 80 ? GREEN
                     : p.sellThrough >= 60 ? AMBER : RED;
      return [
        p.product,
        num(p.totalStock),
        num(p.totalSold),
        num(p.totalBalance),
        { text: pct(p.sellThrough), options: { color: sellColor(p.sellThrough), bold: true } },
        { text: velocity, options: { color: vColor, bold: true } },
      ];
    }),
  ];

  slide.addTable(rows, {
    x: 0.3, y: 0.75, w: 9.4, h: 3.8,
    fontSize: 9, fontFace: FONT,
    border: { pt: 0.5, color: 'CCCCCC' },
    colW: [2.8, 1.1, 1.1, 1.1, 1.5, 1.2],
    align: 'center',
  });

  // Horizontal bar chart
  slide.addChart('bar', [{
    name: 'Sell-through %',
    labels: products.map(p => p.product),
    values: products.map(p => parseFloat(p.sellThrough.toFixed(1))),
  }], {
    x: 0.3, y: 4.65, w: 9.4, h: 2.5,
    barDir: 'bar',
    chartColors: products.map(p => sellColor(p.sellThrough)),
    showValue: true,
    dataLabelFontSize: 8,
    valAxisMaxVal: 100,
    showLegend: false,
  });
}

// Slide 5 — BD Focus Zones
function addBDFocusSlide(pptx, actionBullets) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'BD Focus Zones', 5);

  const bd = getBDFocusSummary();

  const priorityColor = p =>
      p === 'Critical' ? RED
    : p === 'High'     ? AMBER
    : p === 'Medium'   ? BLUE : GREEN;

  const rows = [
    [
      { text: 'Branch',         options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance Units',  options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance Value',  options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Avg Value/Unit', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Priority',       options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ],
    ...bd.map(b => [
      b.branch,
      num(b.totalBalance),
      myr(b.totalValue),
      myr(b.avgValuePerUnit),
      { text: b.priority, options: { color: priorityColor(b.priority), bold: true } },
    ]),
  ];

  slide.addTable(rows, {
    x: 0.3, y: 0.75, w: 6.0, h: 3.5,
    fontSize: 9, fontFace: FONT,
    border: { pt: 0.5, color: 'CCCCCC' },
    colW: [1.2, 1.4, 1.6, 1.4, 1.2],
    align: 'center',
  });

  slide.addText('Management Actions', {
    x: 6.5, y: 0.75, w: 3.2, h: 0.3,
    fontSize: 11, bold: true, color: NAVY, fontFace: FONT,
  });
  slide.addText(actionBullets, {
    x: 6.5, y: 1.1, w: 3.2, h: 3.1,
    fontSize: 9, color: TEXT, fontFace: FONT, wrap: true, valign: 'top',
  });
}

// Slide 6 — Branch × Product Matrix
function addMatrixSlide(pptx) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Cross Analysis: Branch × Product Sell-through', 6);

  const { branches, products, matrix } = getBranchProductMatrix();

  const header = [
    { text: 'Branch', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ...products.map(p => ({ text: p.replace('NV ', ''), options: { bold: true, color: WHITE, fill: { color: NAVY }, fontSize: 7 } })),
  ];

  const dataRows = branches.map(b => [
    { text: b, options: { bold: true, fill: { color: 'EEF2FF' } } },
    ...products.map(p => {
      const val = matrix[b][p];
      if (val === null) return { text: '—', options: { color: 'AAAAAA', align: 'center' } };
      return {
        text: pct(val),
        options: {
          color: sellColor(val), bold: true, align: 'center',
          fill: { color: val >= 80 ? 'E6F9F3' : val >= 50 ? 'EBF4FD' : 'FEF0F0' },
        },
      };
    }),
  ]);

  const colW = [0.7, ...products.map(() => parseFloat((8.7 / products.length).toFixed(2)))];
  slide.addTable([header, ...dataRows], {
    x: 0.3, y: 0.75, w: 9.4, h: 6.4,
    fontSize: 8, fontFace: FONT,
    border: { pt: 0.5, color: 'CCCCCC' },
    colW,
  });
}

// Slide 7 — Aged Stock Alert
function addAgedStockSlide(pptx) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Aged Stock Alert', 7);

  const aged = getAgedStock().slice(0, 15);

  const rows = [
    [
      { text: 'Branch',     options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Product',    options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance',    options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Value',      options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Age',        options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Bucket',     options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ],
    ...aged.map(r => [
      r.branch,
      r.product,
      num(r.balance),
      myr(r.value),
      r.agedays + 'd',
      {
        text: r.ageBucket,
        options: {
          color: r.ageBucket === '>2 years' ? RED
               : r.ageBucket === '1–2 years' ? AMBER : TEXT,
          bold: r.ageBucket === '>2 years',
        },
      },
    ]),
  ];

  slide.addTable(rows, {
    x: 0.3, y: 0.75, w: 9.4, h: 5.6,
    fontSize: 9, fontFace: FONT,
    border: { pt: 0.5, color: 'CCCCCC' },
    colW: [1.0, 2.8, 1.0, 1.8, 0.8, 1.6],
    align: 'center',
  });

  slide.addText('Flagged for sales team priority action. Focus on >2 year inventory first.', {
    x: 0.3, y: 6.5, w: 9.4, h: 0.3,
    fontSize: 8, color: RED, fontFace: FONT, italic: true,
  });
}

// Slide 8 — Recommendations & Marketing Strategies
function addRecommendationsSlide(pptx, recommendations) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Recommendations & Marketing Strategies', 8);

  slide.addText(recommendations, {
    x: 0.3, y: 0.75, w: 9.4, h: 6.4,
    fontSize: 10, color: TEXT, fontFace: FONT, wrap: true, valign: 'top',
  });
}

// Slide 9 — Price Range Distribution
function addPriceRangeSlide(pptx) {
  const slide = pptx.addSlide();
  addSlideChrome(slide, 'Appendix: Price Range Distribution', 9);

  const pr = getPriceRangeSummary();

  const rows = [
    [
      { text: 'Price Range',  options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Total Stock',  options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Total Sold',   options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance',      options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Balance Value',options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: 'Sell-through', options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ],
    ...pr.map(p => [
      p.priceRange,
      num(p.totalStock),
      num(p.totalSold),
      num(p.totalBalance),
      myr(p.totalValue),
      { text: pct(p.sellThrough), options: { color: sellColor(p.sellThrough), bold: true } },
    ]),
  ];

  slide.addTable(rows, {
    x: 0.3, y: 0.75, w: 9.4, h: 3.5,
    fontSize: 9, fontFace: FONT,
    border: { pt: 0.5, color: 'CCCCCC' },
    colW: [2.2, 1.3, 1.3, 1.3, 2.0, 1.3],
    align: 'center',
  });

  slide.addChart('bar', [{
    name: 'Sell-through %',
    labels: pr.map(p => p.priceRange),
    values: pr.map(p => parseFloat(p.sellThrough.toFixed(1))),
  }], {
    x: 0.3, y: 4.4, w: 9.4, h: 2.7,
    barDir: 'bar',
    chartColors: pr.map(p => sellColor(p.sellThrough)),
    showValue: true,
    dataLabelFontSize: 8,
    valAxisMaxVal: 100,
    showLegend: false,
  });
}

// Claude-generated commentary via Sonnet
async function generateCommentary(client, prompt, maxTokens = 500) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0]?.text ?? '';
}

function buildDataContext() {
  const ov = getOverview();
  const branches = getBranchSummary();
  const products = getProductSummary();
  const bd = getBDFocusSummary();

  return `
Overview: Total Stock=${ov.totalStock}, Sold=${ov.totalSold}, Balance=${ov.totalBalance}, Sell-through=${ov.sellThrough.toFixed(1)}%, Value=MYR ${ov.totalValue.toLocaleString()}

Branches (sell-through %): ${branches.map(b => `${b.branch} ${b.sellThrough.toFixed(1)}%`).join(', ')}

Products (sell-through %): ${products.map(p => `${p.product} ${p.sellThrough.toFixed(1)}%`).join(', ')}

BD Focus top priorities: ${bd.slice(0, 3).map(b => `${b.branch} (${b.priority}, Balance=${b.totalBalance})`).join(', ')}
`.trim();
}

export async function generateStandardReport(claudeClient) {
  const now = new Date();
  const monthYear = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });
  const ctx = buildDataContext();

  const [commentary, actionBullets, recommendations] = await Promise.all([
    generateCommentary(claudeClient,
      `You are a senior stock analyst for Nirvana Asia Group Central Region. Write a concise 3-4 sentence executive commentary on current stock performance. Be direct and data-driven.\n\nData:\n${ctx}`
    ),
    generateCommentary(claudeClient,
      `Based on this stock data, write 4-5 short bullet point action items for BD Focus zones. Each bullet should be one actionable sentence.\n\nData:\n${ctx}`, 400
    ),
    generateCommentary(claudeClient,
      `Based on this stock data, write per-branch marketing strategy recommendations. For each branch, provide 1-2 specific actions. Label urgency: [URGENT], [THIS MONTH], or [PIPELINE].\n\nData:\n${ctx}`, 700
    ),
  ]);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 10" × 7.5"
  pptx.author = 'Nirvana Asia Group';
  pptx.title  = `CR Stock Analysis — ${monthYear}`;

  addCoverSlide(pptx, monthYear);
  addExecutiveSlide(pptx, commentary);
  addBranchSlide(pptx);
  addProductSlide(pptx);
  addBDFocusSlide(pptx, actionBullets);
  addMatrixSlide(pptx);
  addAgedStockSlide(pptx);
  addRecommendationsSlide(pptx, recommendations);
  addPriceRangeSlide(pptx);

  return pptx;
}

export async function generateBranchReport(claudeClient, branchFilter) {
  const now = new Date();
  const monthYear = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = `${branchFilter} Branch Deep Dive — ${monthYear}`;

  // Cover
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText(`${branchFilter} Branch — Deep Dive`, {
    x: 0.5, y: 2.0, w: 9, h: 0.9, fontSize: 28, bold: true, color: WHITE, fontFace: FONT,
  });
  cover.addText(`YTD ${monthYear}`, {
    x: 0.5, y: 3.0, w: 9, h: 0.5, fontSize: 18, color: GOLD, fontFace: FONT,
  });

  addBranchSlide(pptx);
  addProductSlide(pptx);
  addAgedStockSlide(pptx);

  return pptx;
}

export async function generateBDFocusReport(claudeClient) {
  const now = new Date();
  const monthYear = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });
  const ctx = buildDataContext();

  const actionBullets = await generateCommentary(claudeClient,
    `Based on this BD Focus zone data, write 5-6 specific action bullet points for the sales team. Be urgent and specific.\n\nData:\n${ctx}`, 500
  );

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = `BD Focus Zones — ${monthYear}`;

  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText('BD Focus Zone Report', {
    x: 0.5, y: 2.0, w: 9, h: 0.9, fontSize: 28, bold: true, color: WHITE, fontFace: FONT,
  });
  cover.addText(`YTD ${monthYear}`, {
    x: 0.5, y: 3.0, w: 9, h: 0.5, fontSize: 18, color: GOLD, fontFace: FONT,
  });

  addBDFocusSlide(pptx, actionBullets);
  addMatrixSlide(pptx);

  return pptx;
}

export async function generateProductReport(claudeClient) {
  const now = new Date();
  const monthYear = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = `Product Analysis — ${monthYear}`;

  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addText('Product Category Analysis', {
    x: 0.5, y: 2.0, w: 9, h: 0.9, fontSize: 28, bold: true, color: WHITE, fontFace: FONT,
  });
  cover.addText(`YTD ${monthYear}`, {
    x: 0.5, y: 3.0, w: 9, h: 0.5, fontSize: 18, color: GOLD, fontFace: FONT,
  });

  addProductSlide(pptx);
  addMatrixSlide(pptx);
  addPriceRangeSlide(pptx);

  return pptx;
}
