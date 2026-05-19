import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import {
  generateStandardReport,
  generateBranchReport,
  generateBDFocusReport,
  generateProductReport,
} from '../src/pptExport.js';

const router = Router();

router.post('/', async (req, res) => {
  const { reportType = 'standard', branchFilter } = req.body;

  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  let pptx;
  let filename;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 7); // YYYY-MM

  try {
    switch (reportType) {
      case 'branch':
        if (!branchFilter) return res.status(400).json({ error: 'branchFilter is required for branch report' });
        pptx = await generateBranchReport(client, branchFilter);
        filename = `CR_Branch_${branchFilter}_${stamp}.pptx`;
        break;
      case 'bd_focus':
        pptx = await generateBDFocusReport(client);
        filename = `CR_BDFocus_${stamp}.pptx`;
        break;
      case 'product':
        pptx = await generateProductReport(client);
        filename = `CR_Product_${stamp}.pptx`;
        break;
      case 'standard':
      default:
        pptx = await generateStandardReport(client);
        filename = `CR_StockAnalysis_${stamp}.pptx`;
        break;
    }

    const buffer = await pptx.write({ outputType: 'nodebuffer' });

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (err) {
    console.error('Report generation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
