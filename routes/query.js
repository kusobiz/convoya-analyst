import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import {
  getOverview,
  getBranchSummary,
  getProductSummary,
  getBDFocusSummary,
  getStatusBreakdown,
  getPriceRangeSummary,
} from '../src/reader.js';
import { queryLots } from './lots.js';

const router = Router();
const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

function fmt(n) {
  return 'MYR ' + Number(n).toLocaleString('en-MY', { maximumFractionDigits: 0 });
}

function pct(n) {
  return Number(n).toFixed(1) + '%';
}

const LOT_KEYWORD_RE = /\b(zone|suite|level|lot)s?\b/i;
const BRANCHES = ['KL', 'SA', 'GX', 'SE', 'IJ', 'IP', 'KR', 'KN'];

function extractBranch(question) {
  const upper = question.toUpperCase();
  return BRANCHES.find(b => new RegExp(`\\b${b}\\b`).test(upper));
}

function buildLotContext(question) {
  if (!LOT_KEYWORD_RE.test(question)) return '';
  const branch = extractBranch(question);
  const rows = queryLots(branch ? { branch } : {});
  if (!rows.length) return '';

  const lotTable = rows.slice(0, 50).map(r =>
    `  ${r.zone} | ${r.level} | ${r.status} | ${r.totalStock} | ${r.totalSold} | ${r.totalBalance} | ${fmt(r.totalBalanceAmount)}`
  ).join('\n');

  return `LOT-LEVEL DATA (for this query)${branch ? ` — Branch ${branch}` : ''}:
Zone | Level | Status | Stock | Sold | Balance | Value
${lotTable}

`;
}

function buildSystemPrompt() {
  const overview   = getOverview();
  const branches   = getBranchSummary();
  const products   = getProductSummary();
  const bdFocus    = getBDFocusSummary();
  const statuses   = getStatusBreakdown();
  const priceRanges = getPriceRangeSummary();

  const now = new Date();
  const monthYear = now.toLocaleString('en-MY', { month: 'long', year: 'numeric' });

  const branchTable = branches.map(b =>
    `  ${b.branch}: Stock=${b.totalStock}, Sold=${b.totalSold}, Balance=${b.totalBalance}, Value=${fmt(b.totalValue)}, Sell-through=${pct(b.sellThrough)}`
  ).join('\n');

  const productTable = products.map(p =>
    `  ${p.product}: Stock=${p.totalStock}, Sold=${p.totalSold}, Balance=${p.totalBalance}, Sell-through=${pct(p.sellThrough)}`
  ).join('\n');

  const bdTable = bdFocus.map(b =>
    `  ${b.branch}: Balance=${b.totalBalance}, Value=${fmt(b.totalValue)}, Priority=${b.priority}`
  ).join('\n');

  const statusTable = statuses.map(s =>
    `  ${s.status}: ${s.count} lots, Balance=${s.totalBalance}`
  ).join('\n');

  const priceTable = priceRanges.map(p =>
    `  ${p.priceRange}: Stock=${p.totalStock}, Sold=${p.totalSold}, Sell-through=${pct(p.sellThrough)}`
  ).join('\n');

  return `You are a stock analysis assistant for Nirvana Asia Group — Central Region (Malaysia).
You have access to real-time inventory data as of ${monthYear}.

OVERVIEW KPIs:
  Total Stock: ${overview.totalStock}
  Total Sold: ${overview.totalSold}
  Balance Units: ${overview.totalBalance}
  Sell-through: ${pct(overview.sellThrough)}
  Balance Value: ${fmt(overview.totalValue)}

BRANCH SUMMARY (8 branches):
${branchTable}

PRODUCT SUMMARY (9 products):
${productTable}

BD FOCUS ZONE SUMMARY:
${bdTable}

STATUS BREAKDOWN:
${statusTable}

PRICE RANGE PERFORMANCE:
${priceTable}

DOMAIN RULES:
- Status = OPEN means unsold/available inventory
- BD Focus Zone = "yes" flags priority sales zones
- Branches: KL, SA, GX, SE, IJ, IP, KR, KN (all Central Region)
- Products: NV Niche, NV Burial Plot, NV Pedestal, NV Seed, NV Pet Niche, NV EBL, NV Urn Burial Plot, NV Baby Paradise, NV Pet Burial Plot

RESPONSE GUIDELINES:
- Be concise, data-driven, and action-oriented
- Use bullet points for recommendations
- Format all numbers with commas and MYR prefix
- Keep responses under 400 words unless explicitly asked for a full report
- Focus on actionable insights for sales managers`;
}

router.post('/', async (req, res) => {
  const { question, history = [] } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question is required' });
  }

  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: question },
  ];

  try {
    const system = buildLotContext(question) + buildSystemPrompt();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages,
    });

    const answer = response.content[0]?.text ?? '';
    res.json({ answer });
  } catch (err) {
    console.error('Claude query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
