import PDFDocument from 'pdfkit'
import { HttpError } from '../helpers/httpError.js'
import { fmtUSD, fmtPct } from '../helpers/formatters.js'
import { formatDisplayDate } from '../helpers/dateHelpers.js'

export function buildPdf({ result, formData, chartImages }) {
  if (!result || !formData) {
    throw new HttpError(400, 'result and formData are required')
  }

  const { summary, weeklyData } = result
  const pi = formData.projectInfo || {}
  const sched = formData.schedule || {}
  const phases = formData.phases || []

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: 'Escalation Calculator Report',
      Author: 'Escalation Calculator',
    },
  })

  const NAVY = '#1e3a5f'
  const BLUE = '#3b82f6'
  const WHITE = '#ffffff'
  const LIGHT_GRAY = '#f8fafc'
  const BORDER_GRAY = '#e2e8f0'
  const TEXT_PRI = '#1a1a2e'
  const TEXT_SEC = '#64748b'
  const GREEN = '#16a34a'
  const RED = '#dc2626'
  const ORANGE = '#f97316'
  const PURPLE = '#9333ea'

  const PW = doc.page.width - 80
  const ML = 40

  const fillRect = (x, y, w, h, color) => doc.rect(x, y, w, h).fill(color)
  const strokeRect = (x, y, w, h, color = BORDER_GRAY) => doc.rect(x, y, w, h).stroke(color)
  const leftAccent = (y, h, color) => fillRect(ML, y, 4, h, color)

  const sectionTitle = (text, yPos, color) => {
    leftAccent(yPos, 18, color)
    doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
      .text(text, ML + 16, yPos + 3)
    return yPos + 26
  }

  const tableHeader = (y, cols, labels, rowH = 16) => {
    fillRect(ML, y, PW, rowH, NAVY)
    let cx = ML + 4
    labels.forEach((h, i) => {
      doc.fillColor(WHITE).fontSize(7).font('Helvetica-Bold')
        .text(h, cx, y + 4, { width: cols[i], lineBreak: false })
      cx += cols[i]
    })
    return y + rowH
  }

  const checkPageBreak = (currentY, needed) => {
    if (currentY + needed > doc.page.height - 60) {
      doc.addPage()
      return 40
    }
    return currentY
  }

  fillRect(0, 0, doc.page.width, 60, NAVY)
  doc.fillColor(WHITE).fontSize(18).font('Helvetica-Bold')
    .text('ESCALATION CALCULATOR REPORT', ML, 18)
  doc.fillColor('#93c5fd').fontSize(10).font('Helvetica')
    .text(
      `Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      ML, 42
    )

  let y = 76

  const piH = 90
  fillRect(ML, y, PW, piH, WHITE)
  leftAccent(y, piH, BLUE)
  strokeRect(ML + 4, y, PW - 4, piH)

  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
    .text('PROJECT INFORMATION', ML + 16, y + 10)

  const piRows = [
    ['Estimate #:', pi.estimateNumber || '—'],
    ['BidTracer #:', pi.bidTracerNumber || '—'],
    ['Date:', formatDisplayDate(pi.date)],
    ['Bid Date:', formatDisplayDate(pi.bidDate)],
  ]
  piRows.forEach(([label, value], i) => {
    const ry = y + 28 + i * 14
    doc.fillColor(TEXT_SEC).fontSize(9).font('Helvetica').text(label, ML + 16, ry)
    doc.fillColor(TEXT_PRI).fontSize(9).font('Helvetica-Bold').text(value, ML + 120, ry)
  })

  doc.fillColor(TEXT_SEC).fontSize(9).font('Helvetica').text('Overall Schedule:', ML + 280, y + 28)
  doc.fillColor(TEXT_PRI).fontSize(9).font('Helvetica-Bold')
    .text(`${formatDisplayDate(sched.startDate)} → ${formatDisplayDate(sched.endDate)}`, ML + 280, y + 42)

  doc.fillColor(TEXT_SEC).fontSize(9).font('Helvetica').text('Phases:', ML + 280, y + 56)
  doc.fillColor(TEXT_PRI).fontSize(9).font('Helvetica-Bold')
    .text(phases.map(p => p.name).join(', ') || '—', ML + 280, y + 70, { width: PW - 260 })

  y += piH + 12

  const summH = 150
  fillRect(ML, y, PW, summH, WHITE)
  leftAccent(y, summH, BLUE)
  strokeRect(ML + 4, y, PW - 4, summH)

  doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
    .text('COST SUMMARY', ML + 16, y + 10)

  const boxW = Math.floor((PW - 24) / 4)
  const metricBoxes = [
    { label: 'ORIGINAL BUDGET', value: fmtUSD(summary?.totalBudget), color: NAVY },
    { label: 'ESCALATED TOTAL', value: fmtUSD(summary?.totalEscalated), color: NAVY },
    { label: '$ DIFFERENCE', value: fmtUSD(summary?.totalDifference), color: summary?.totalDifference > 0 ? RED : GREEN },
    { label: '% ESCALATION', value: fmtPct(summary?.totalEscPercent), color: NAVY },
  ]
  metricBoxes.forEach((box, i) => {
    const bx = ML + 16 + i * (boxW + 4)
    const by = y + 28
    fillRect(bx, by, boxW, 44, LIGHT_GRAY)
    strokeRect(bx, by, boxW, 44)
    doc.fillColor(TEXT_SEC).fontSize(7).font('Helvetica')
      .text(box.label, bx + 4, by + 6, { width: boxW - 8, align: 'center', lineBreak: false })
    doc.fillColor(box.color).fontSize(11).font('Helvetica-Bold')
      .text(box.value, bx + 4, by + 20, { width: boxW - 8, align: 'center', lineBreak: false })
  })

  const tblCols = [100, 95, 95, 95, 75]
  const tblHdrs = ['Category', 'Original Budget', 'Escalated Total', 'Difference', 'Esc. %']
  let ty = y + 82
  ty = tableHeader(ty, tblCols, tblHdrs)

  const tblData = [
    {
      label: 'Materials', accent: BLUE, bg: WHITE,
      vals: [
        fmtUSD(summary?.budgetedMaterial),
        fmtUSD(summary?.escalatedMaterial),
        fmtUSD(summary?.materialDifference),
        fmtPct(summary?.materialEscPercent),
      ],
      diffIdx: 2, diffVal: summary?.materialDifference,
    },
    {
      label: 'Labor', accent: GREEN, bg: LIGHT_GRAY,
      vals: [
        fmtUSD(summary?.budgetedLabor),
        fmtUSD(summary?.escalatedLabor),
        fmtUSD(summary?.laborDifference),
        fmtPct(summary?.laborEscPercent),
      ],
      diffIdx: 2, diffVal: summary?.laborDifference,
    },
  ]
  tblData.forEach((row) => {
    fillRect(ML, ty, PW, 16, row.bg)
    strokeRect(ML, ty, PW, 16)
    fillRect(ML, ty, 4, 16, row.accent)
    let cx = ML + 6
    ;[row.label, ...row.vals].forEach((v, i) => {
      const color = (i - 1 === row.diffIdx && row.diffVal > 0) ? RED : TEXT_PRI
      doc.fillColor(color).fontSize(8).font('Helvetica')
        .text(v, cx, ty + 4, { width: tblCols[i] - 4, lineBreak: false })
      cx += tblCols[i]
    })
    ty += 16
  })

  y += summH + 12

  const CHART_IMG_H = 180
  const CHART_TITLE_H = 18
  const CHART_SUB_H = 16
  const CHART_PAD = 24
  const CHART_TOTAL = CHART_TITLE_H + CHART_SUB_H + CHART_IMG_H + CHART_PAD

  const chartDefs = [
    { key: 'materialChart', title: 'CUMULATIVE MATERIAL COST', color: BLUE, sub: 'Blue line = Escalated Cost  |  Dashed = Original Budget' },
    { key: 'laborChart', title: 'CUMULATIVE LABOR COST', color: GREEN, sub: 'Green line = Escalated Cost  |  Dashed = Original Budget' },
    { key: 'hoursChart', title: 'WORKER HOURS PER WEEK', color: PURPLE, sub: 'Hours distributed across project timeline' },
  ]

  if (chartImages && Object.values(chartImages).some(Boolean)) {
    for (const chart of chartDefs) {
      const imgDataUrl = chartImages[chart.key]
      if (!imgDataUrl) continue

      y = checkPageBreak(y, CHART_TOTAL)
      leftAccent(y, CHART_TOTAL - CHART_PAD, chart.color)

      doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
        .text(chart.title, ML + 16, y)
      y += CHART_TITLE_H

      doc.fillColor(TEXT_SEC).fontSize(9).font('Helvetica')
        .text(chart.sub, ML + 16, y)
      y += CHART_SUB_H

      try {
        const base64 = imgDataUrl.replace(/^data:image\/png;base64,/, '')
        doc.image(Buffer.from(base64, 'base64'), ML + 16, y, {
          width: PW - 20,
          height: CHART_IMG_H,
        })
      } catch {
        doc.fillColor(TEXT_SEC).fontSize(9).font('Helvetica')
          .text('Chart not available', ML + 16, y + 80, { align: 'center', width: PW - 20 })
      }
      y += CHART_IMG_H + CHART_PAD
    }
  }

  y = checkPageBreak(y, 200)
  y += 16
  y = sectionTitle('WEEKLY BREAKDOWN', y, PURPLE)

  const wCols = [36, 62, 82, 82, 52, 88, 88]
  const wHdrs = ['Wk', 'Week Of', 'Mat. Cost', 'Labor Cost', 'Hours', 'Cum. Material', 'Cum. Labor']
  const drawWeeklyHeader = (yPos) => tableHeader(yPos, wCols, wHdrs, 16)

  y = drawWeeklyHeader(y)

  ;(weeklyData || []).forEach((row, idx) => {
    if (y > doc.page.height - 60) {
      doc.addPage()
      y = 40
      y = drawWeeklyHeader(y)
    }
    const bg = idx % 2 === 0 ? WHITE : LIGHT_GRAY
    fillRect(ML, y, PW, 13, bg)
    strokeRect(ML, y, PW, 13)
    const vals = [
      String(row.week || idx + 1),
      row.weekLabel || '—',
      fmtUSD(row.materialCost),
      fmtUSD(row.laborCost),
      Math.round(row.hours || 0).toLocaleString(),
      fmtUSD(row.cumulativeMaterial),
      fmtUSD(row.cumulativeLabor),
    ]
    let cx = ML + 4
    vals.forEach((v, i) => {
      doc.fillColor(TEXT_PRI).fontSize(7).font('Helvetica')
        .text(v, cx, y + 3, { width: wCols[i] - 2, lineBreak: false })
      cx += wCols[i]
    })
    y += 13
  })

  y = checkPageBreak(y + 16, 80)
  y = sectionTitle('PHASE DETAILS', y, ORANGE)

  ;(phases || []).forEach((phase, i) => {
    y = checkPageBreak(y, 58)
    fillRect(ML, y, PW, 50, WHITE)
    strokeRect(ML, y, PW, 50)
    leftAccent(y, 50, ORANGE)
    doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
      .text(`Phase ${i + 1}: ${phase.name}`, ML + 16, y + 8)
    doc.fillColor(TEXT_SEC).fontSize(8).font('Helvetica')
      .text(
        `${formatDisplayDate(phase.startDate)} → ${formatDisplayDate(phase.endDate)}   |   ` +
        `Hours: ${Number(phase.estimatedHours || 0).toLocaleString()}`,
        ML + 16, y + 26, { width: PW - 24 }
      )
    y += 58
  })

  doc.fillColor(TEXT_SEC).fontSize(8).font('Helvetica')
    .text('Escalation Calculator — Confidential', ML, doc.page.height - 30, { align: 'left' })
    .text(String(new Date().getFullYear()), ML, doc.page.height - 30, { align: 'right', width: PW })

  return {
    doc,
    filename: `escalation-report-${pi.estimateNumber || 'report'}.pdf`,
  }
}
