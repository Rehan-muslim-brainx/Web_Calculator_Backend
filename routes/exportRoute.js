import { Router } from 'express'
import puppeteer from 'puppeteer'

const router = Router()

// ── Formatters ─────────────────────────────────────────────────────────────

function usd(val) {
  if (val == null || isNaN(val)) return '$0.00'
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function pct(val) {
  if (val == null || isNaN(val)) return '0.00%'
  return (val * 100).toFixed(2) + '%'
}

function diffColor(val) {
  if (val > 0) return '#dc2626'
  if (val < 0) return '#16a34a'
  return '#16a34a'
}

function diffStr(val) {
  if (val == null || isNaN(val)) return '$0.00'
  const formatted = usd(Math.abs(val))
  if (val > 0) return '+' + formatted
  if (val < 0) return '-' + formatted
  return formatted
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtHours(val) {
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

// ── HTML Builder ───────────────────────────────────────────────────────────

function chartSection(title, borderColor, legendText, imgDataUrl) {
  const content = imgDataUrl
    ? `<img src="${imgDataUrl}" style="width:100%; height:auto; display:block; border-radius:4px;" />`
    : `<p style="color:#64748b;font-style:italic;text-align:center;padding:20px;">Chart not available</p>`
  const legend = legendText
    ? `<div style="font-size:10px;color:#64748b;margin-bottom:8px;">${legendText}</div>`
    : ''
  return `
  <div style="background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid ${borderColor};
    border-radius:6px;padding:16px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;
      color:#1e3a5f;margin-bottom:12px;">${title}</div>
    ${legend}
    ${content}
  </div>`
}

function buildHtml(result, formData, chartImages) {
  const { summary, weeklyData, projectInfo } = result
  const { materialChart, laborChart, hoursChart } = chartImages || {}
  const pi = formData.projectInfo
  const sched = formData.schedule
  const phases = projectInfo.phases || []
  const generatedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const phaseTagsHtml = phases.map(p =>
    `<span style="display:inline-block;background:#e0e7ff;color:#1e3a5f;border-radius:4px;
      padding:2px 8px;font-size:9px;margin:2px 4px 2px 0;font-weight:600;">
      ${escHtml(p.name)}: ${p.startDate} → ${p.endDate}
    </span>`
  ).join('')

  const summaryRows = [
    { label: 'Materials', orig: summary.budgetedMaterial, esc: summary.escalatedMaterial, diff: summary.materialDifference, pctVal: summary.materialEscPercent, accent: '#3b82f6' },
    { label: 'Labor',     orig: summary.budgetedLabor,    esc: summary.escalatedLabor,    diff: summary.laborDifference,    pctVal: summary.laborEscPercent,    accent: '#16a34a' },
  ].map(r => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;
        border-left:3px solid ${r.accent};font-weight:600;color:#1a1a2e;">${r.label}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;text-align:right;color:#1a1a2e;">${usd(r.orig)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;text-align:right;color:#1a1a2e;">${usd(r.esc)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;text-align:right;color:${diffColor(r.diff)};font-weight:600;">${diffStr(r.diff)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;text-align:right;color:#64748b;">${pct(r.pctVal)}</td>
    </tr>
  `).join('')

  const weeklyRows = weeklyData.map((row, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc'
    return `
      <tr style="background:${bg};">
        <td style="padding:5px 8px;font-size:10px;text-align:center;color:#64748b;border-bottom:1px solid #e2e8f0;">${row.week}</td>
        <td style="padding:5px 8px;font-size:10px;font-weight:600;color:#1a1a2e;border-bottom:1px solid #e2e8f0;white-space:nowrap;">${row.weekLabel}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:right;color:#1a1a2e;border-bottom:1px solid #e2e8f0;">${usd(row.materialCost)}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:right;color:#1a1a2e;border-bottom:1px solid #e2e8f0;">${usd(row.laborCost)}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:right;color:#1a1a2e;border-bottom:1px solid #e2e8f0;">${fmtHours(row.hours)}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:right;color:#1e3a5f;font-weight:600;border-bottom:1px solid #e2e8f0;">${usd(row.cumulativeMaterial)}</td>
        <td style="padding:5px 8px;font-size:10px;text-align:right;color:#16a34a;font-weight:600;border-bottom:1px solid #e2e8f0;">${usd(row.cumulativeLabor)}</td>
      </tr>
    `
  }).join('')

  const phaseDetailsHtml = phases.map((p, i) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#1e3a5f;">
        Phase ${i + 1} — ${escHtml(p.name)}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;">${p.startDate} → ${p.endDate}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;text-align:right;color:#1a1a2e;">
        ${Number(p.estimatedHours).toLocaleString('en-US')} hrs
      </td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #f8fafc; color: #1a1a2e; font-size: 12px; line-height: 1.5; }
  @page { margin: 15mm 12mm; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>

  <!-- ── PAGE HEADER ───────────────────────────────────────────────────── -->
  <div style="background:#1e3a5f;padding:16px 20px;display:flex;justify-content:space-between;
    align-items:center;border-bottom:3px solid #3b82f6;margin-bottom:0;">
    <div>
      <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">
        ESCALATION CALCULATOR REPORT
      </div>
      <div style="font-size:11px;color:#93c5fd;margin-top:3px;">Cost Escalation Analysis</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:11px;color:#93c5fd;">Generated: ${generatedDate}</div>
      <div style="font-size:10px;color:#60a5fa;margin-top:2px;">Confidential</div>
    </div>
  </div>

  <!-- ── PROJECT INFO CARD ─────────────────────────────────────────────── -->
  <div style="background:#ffffff;border-bottom:3px solid #3b82f6;padding:16px 20px;margin-bottom:16px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
      <tr>
        <td style="width:25%;padding:4px 8px 4px 0;">
          <span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Estimate #</span><br>
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;">${escHtml(pi.estimateNumber)}</span>
        </td>
        <td style="width:25%;padding:4px 8px;">
          <span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">BidTracer #</span><br>
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;">${escHtml(pi.bidTracerNumber)}</span>
        </td>
        <td style="width:25%;padding:4px 8px;">
          <span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Date</span><br>
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;">${pi.date}</span>
        </td>
        <td style="width:25%;padding:4px 0 4px 8px;">
          <span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Bid Date</span><br>
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;">${pi.bidDate}</span>
        </td>
      </tr>
    </table>
    <div style="padding-top:10px;border-top:1px solid #e2e8f0;">
      <span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Overall Schedule</span>
      <span style="font-size:11px;font-weight:600;color:#1a1a2e;margin-left:8px;">${sched.startDate} → ${sched.endDate}</span>
    </div>
    <div style="margin-top:8px;">
      <span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;vertical-align:middle;">Phases</span>
      <span style="margin-left:8px;">${phaseTagsHtml}</span>
    </div>
  </div>

  <!-- ── COST SUMMARY CARD ─────────────────────────────────────────────── -->
  <div style="background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;
    border-radius:6px;padding:16px 20px;margin-bottom:16px;">

    <div style="font-size:13px;font-weight:700;color:#1e3a5f;text-transform:uppercase;
      letter-spacing:0.05em;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;">
      COST SUMMARY
    </div>

    <!-- 4 metric boxes -->
    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:16px;">
      <tr>
        ${[
          { label: 'ORIGINAL BUDGET',  value: usd(summary.totalBudget) },
          { label: 'ESCALATED TOTAL',  value: usd(summary.totalEscalated) },
          { label: '$ DIFFERENCE',     value: diffStr(summary.totalDifference), color: diffColor(summary.totalDifference) },
          { label: '% ESCALATION',     value: pct(summary.totalEscPercent) },
        ].map(m => `
          <td style="width:25%;background:#f0f4f8;border:1px solid #e2e8f0;border-radius:6px;
            padding:10px 12px;vertical-align:top;">
            <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">
              ${m.label}
            </div>
            <div style="font-size:16px;font-weight:700;color:${m.color || '#1e3a5f'};">
              ${m.value}
            </div>
          </td>
        `).join('')}
      </tr>
    </table>

    <!-- Breakdown table -->
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#1e3a5f;">
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Category</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Original Budget</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Escalated Total</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Difference</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Esc. %</th>
        </tr>
      </thead>
      <tbody>
        ${summaryRows}
        <tr style="background:#1e3a5f;">
          <td style="padding:9px 10px;font-size:11px;font-weight:700;color:#ffffff;border-left:3px solid #3b82f6;">TOTAL</td>
          <td style="padding:9px 10px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;">${usd(summary.totalBudget)}</td>
          <td style="padding:9px 10px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;">${usd(summary.totalEscalated)}</td>
          <td style="padding:9px 10px;font-size:11px;font-weight:700;text-align:right;color:${diffColor(summary.totalDifference)};">
            ${diffStr(summary.totalDifference)}
          </td>
          <td style="padding:9px 10px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;">${pct(summary.totalEscPercent)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ── CHARTS ──────────────────────────────────────────────────────── -->
  ${chartSection(
    'CUMULATIVE MATERIAL COST',
    '#3b82f6',
    'Blue line = Escalated Cost &nbsp;|&nbsp; Dashed line = Original Budget',
    materialChart
  )}
  ${chartSection(
    'CUMULATIVE LABOR COST',
    '#16a34a',
    'Green line = Escalated Cost &nbsp;|&nbsp; Dashed line = Original Budget',
    laborChart
  )}
  ${chartSection('WORKER HOURS PER WEEK', '#9333ea', null, hoursChart)}

  <!-- ── PHASE DETAILS CARD ────────────────────────────────────────────── -->
  <div style="background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #f97316;
    border-radius:6px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;color:#1e3a5f;text-transform:uppercase;
      letter-spacing:0.05em;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;">
      PHASE DETAILS
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#1e3a5f;">
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Phase</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Schedule</th>
          <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:700;color:#ffffff;text-transform:uppercase;">Est. Hours</th>
        </tr>
      </thead>
      <tbody>${phaseDetailsHtml}</tbody>
    </table>
  </div>

  <!-- ── WEEKLY BREAKDOWN (new page) ──────────────────────────────────── -->
  <div class="page-break"></div>

  <div style="background:#ffffff;border:1px solid #e2e8f0;border-left:4px solid #9333ea;
    border-radius:6px;padding:16px 20px;margin-bottom:16px;">
    <div style="font-size:13px;font-weight:700;color:#1e3a5f;text-transform:uppercase;
      letter-spacing:0.05em;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #e2e8f0;">
      WEEKLY BREAKDOWN
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#1e3a5f;">
          <th style="padding:7px 8px;text-align:center;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Wk</th>
          <th style="padding:7px 8px;text-align:left;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Week Of</th>
          <th style="padding:7px 8px;text-align:right;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Material Cost</th>
          <th style="padding:7px 8px;text-align:right;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Labor Cost</th>
          <th style="padding:7px 8px;text-align:right;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Hours</th>
          <th style="padding:7px 8px;text-align:right;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Cum. Material</th>
          <th style="padding:7px 8px;text-align:right;font-size:10px;font-weight:700;color:#ffffff;text-transform:uppercase;">Cum. Labor</th>
        </tr>
      </thead>
      <tbody>${weeklyRows}</tbody>
    </table>
  </div>

  <!-- ── FOOTER ───────────────────────────────────────────────────────── -->
  <div style="margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;
    display:flex;justify-content:space-between;font-size:9px;color:#64748b;">
    <span>Escalation Calculator — Confidential</span>
    <span>${new Date().getFullYear()}</span>
  </div>

</body>
</html>`
}

// ── Route ──────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  console.log('PDF export started')

  const { result, formData, chartImages } = req.body

  if (!result || !formData) {
    return res.status(400).json({ error: 'result and formData are required' })
  }

  console.log('Payload received — weeklyData rows:', result?.weeklyData?.length)
  console.log('Chart images received:', Object.keys(chartImages || {}).filter(k => chartImages[k]))

  let browser
  try {
    const html = buildHtml(result, formData, chartImages)
    console.log('HTML built, length:', html.length)

    console.log('Launching puppeteer...')
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ],
    })
    console.log('Puppeteer launched')

    const page = await browser.newPage()

    console.log('Setting page content...')
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // Short wait to ensure base64 images are fully decoded before PDF render
    await new Promise(resolve => setTimeout(resolve, 500))
    console.log('Content set')

    console.log('Generating PDF...')
    const pdfResult = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      timeout: 30000,
      displayHeaderFooter: false,
    })
    console.log('PDF generated, type:', typeof pdfResult, 'constructor:', pdfResult?.constructor?.name)

    await browser.close()
    browser = null

    // Convert Uint8Array → Node.js Buffer (fixes res.send() JSON-serialisation bug)
    const pdfBuffer = Buffer.from(pdfResult)
    console.log('PDF buffer size:', pdfBuffer.length)

    const estimateNum = formData?.projectInfo?.estimateNumber || 'report'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="escalation-report-${escHtml(estimateNum)}.pdf"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.end(pdfBuffer)   // res.end() sends raw binary — avoids express res.send() serialisation
    console.log('PDF sent successfully')

  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    console.error('PDF generation error:', err.message)
    console.error(err.stack)
    res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  }
})

export default router
