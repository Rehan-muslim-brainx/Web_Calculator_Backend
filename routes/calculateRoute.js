import { Router } from 'express'
import supabase from '../supabaseClient.js'

const router = Router()

// --- Helpers ---

function parseDate(dateStr) {
  if (!dateStr) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00')
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split('/')
    return new Date(`${year}-${month}-${day}T00:00:00`)
  }
  return new Date(dateStr + 'T00:00:00')
}

function isValidDate(str) {
  const d = parseDate(str)
  return !!d && !isNaN(d.getTime())
}

function toMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function isoMonday(date) {
  return toMonday(date).toISOString().slice(0, 10)
}

function getWorkdays(startDate, endDate) {
  const workdays = []
  const current = parseDate(startDate)
  const end = parseDate(endDate)
  current.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  while (current < end) {
    const dow = current.getDay()
    if (dow !== 0 && dow !== 6) workdays.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  return workdays
}

function buildPhaseWeeks(workdays) {
  const dayMeta = []
  let phaseWeekIndex = 1
  let prevMonday = null
  for (const day of workdays) {
    const monday = isoMonday(day)
    if (prevMonday === null) {
      prevMonday = monday
    } else if (monday !== prevMonday) {
      phaseWeekIndex++
      prevMonday = monday
    }
    dayMeta.push({ date: new Date(day), phaseWeekIndex })
  }
  const daysInWeek = {}
  for (const d of dayMeta) {
    daysInWeek[d.phaseWeekIndex] = (daysInWeek[d.phaseWeekIndex] || 0) + 1
  }
  return { dayMeta, daysInWeek, phaseWeekCount: phaseWeekIndex }
}

function formatWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const resampleCurve = (curveWeeks, targetWeekCount) => {
  if (targetWeekCount === 1) return [1.0]
  const resampled = []
  for (let i = 0; i < targetWeekCount; i++) {
    const pos = (i / (targetWeekCount - 1)) * (curveWeeks.length - 1)
    const lower = Math.floor(pos)
    const upper = Math.min(lower + 1, curveWeeks.length - 1)
    const frac = pos - lower
    resampled.push(curveWeeks[lower] * (1 - frac) + curveWeeks[upper] * frac)
  }
  const total = resampled.reduce((a, b) => a + b, 0)
  return resampled.map(v => v / total)
}

const getFullYearsElapsed = (anniversaryDate, currentDate) => {
  const ann = parseDate(anniversaryDate)
  const cur = parseDate(currentDate)
  if (!ann || !cur || cur < ann) return 0
  let years = cur.getFullYear() - ann.getFullYear()
  const anniversaryThisYear = new Date(cur.getFullYear(), ann.getMonth(), ann.getDate())
  if (cur < anniversaryThisYear) years -= 1
  return Math.max(0, years)
}

const getLaborYearsElapsed = (anniversaryDateStr, currentDateStr) => {
  const ann = parseDate(anniversaryDateStr)
  const cur = parseDate(currentDateStr)
  if (cur < ann) return 0
  const diffMs = cur.getTime() - ann.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return Math.floor(diffDays / 365) + 1
}

// POST /api/calculate
router.post('/', async (req, res) => {
  try {
    const { projectInfo, schedule, phases } = req.body

    // ── STEP 1: Validate phases array ─────────────────────────────────────────
    if (!Array.isArray(phases) || phases.length < 1 || phases.length > 3) {
      return res.status(400).json({ error: 'phases must be an array of 1 to 3 items' })
    }

    if (!isValidDate(schedule?.startDate) || !isValidDate(schedule?.endDate)) {
      return res.status(400).json({ error: 'schedule.startDate and schedule.endDate must be valid dates' })
    }

    for (let i = 0; i < phases.length; i++) {
      const p = phases[i]
      const label = `phases[${i}]`

      if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
        return res.status(400).json({ error: `${label}.name is required` })
      }
      if (!isValidDate(p.startDate) || !isValidDate(p.endDate)) {
        return res.status(400).json({ error: `${label} must have valid startDate and endDate` })
      }
      if (parseDate(p.startDate) >= parseDate(p.endDate)) {
        return res.status(400).json({ error: `${label}.startDate must be before endDate` })
      }
      if (typeof p.estimatedHours !== 'number' || p.estimatedHours <= 0) {
        return res.status(400).json({ error: `${label}.estimatedHours must be a positive number` })
      }
      if (!p.curveId) {
        return res.status(400).json({ error: `${label}.curveId is required` })
      }

      // Validate per-phase materials
      if (!Array.isArray(p.materials) || p.materials.length === 0) {
        return res.status(400).json({ error: `Phase "${p.name}" must have at least 1 material` })
      }
      if (p.materials.length > 5) {
        return res.status(400).json({ error: `Phase "${p.name}" may have at most 5 materials` })
      }
      for (const mat of p.materials) {
        if (!mat.name || !mat.name.trim()) {
          return res.status(400).json({ error: `A material in phase "${p.name}" is missing a name` })
        }
        if (!mat.budget || isNaN(parseFloat(mat.budget))) {
          return res.status(400).json({ error: `Material "${mat.name}" in phase "${p.name}" has invalid budget` })
        }
        if (mat.escalationPercent === undefined || mat.escalationPercent === null || isNaN(parseFloat(mat.escalationPercent))) {
          return res.status(400).json({ error: `Material "${mat.name}" in phase "${p.name}" has invalid escalation percent` })
        }
        if (!mat.anniversaryDate) {
          return res.status(400).json({ error: `Material "${mat.name}" in phase "${p.name}" is missing anniversary date` })
        }
        if (!isValidDate(mat.anniversaryDate)) {
          return res.status(400).json({ error: `Material "${mat.name}" in phase "${p.name}" has invalid anniversary date` })
        }
      }

      // Validate per-phase labors
      if (!Array.isArray(p.labors) || p.labors.length === 0) {
        return res.status(400).json({ error: `Phase "${p.name}" must have at least 1 labor type` })
      }
      if (p.labors.length > 5) {
        return res.status(400).json({ error: `Phase "${p.name}" may have at most 5 labor types` })
      }
      for (const lab of p.labors) {
        if (!lab.name || !lab.name.trim()) {
          return res.status(400).json({ error: `A labor type in phase "${p.name}" is missing a name` })
        }
        if (!lab.budget || isNaN(parseFloat(lab.budget))) {
          return res.status(400).json({ error: `Labor "${lab.name}" in phase "${p.name}" has invalid budget` })
        }
        if (lab.escalationPercent === undefined || lab.escalationPercent === null || isNaN(parseFloat(lab.escalationPercent))) {
          return res.status(400).json({ error: `Labor "${lab.name}" in phase "${p.name}" has invalid escalation percent` })
        }
        if (!lab.anniversaryDate) {
          return res.status(400).json({ error: `Labor "${lab.name}" in phase "${p.name}" is missing anniversary date` })
        }
        if (!isValidDate(lab.anniversaryDate)) {
          return res.status(400).json({ error: `Labor "${lab.name}" in phase "${p.name}" has invalid anniversary date` })
        }
      }
    }

    // ── STEP 2: Fetch curves from Supabase ────────────────────────────────────
    const curveMap = {}
    for (const phase of phases) {
      if (curveMap[phase.curveId]) continue
      const { data: rawCurve, error } = await supabase
        .from('curves')
        .select('*')
        .eq('id', phase.curveId)
        .single()

      if (!rawCurve || error) {
        return res.status(404).json({ error: `Curve not found for phase '${phase.name}' (id: ${phase.curveId})` })
      }

      curveMap[phase.curveId] = rawCurve.weeks.map(w => parseFloat(w))
    }

    // ── STEPS 4–9: Build per-phase workday metadata ───────────────────────────
    const phaseWeights = []
    for (const phase of phases) {
      const curveWeeks = curveMap[phase.curveId]
      const workdays = getWorkdays(phase.startDate, phase.endDate)
      if (workdays.length === 0) {
        return res.status(400).json({ error: `Phase '${phase.name}' has no workdays in its date range` })
      }
      const { dayMeta, daysInWeek, phaseWeekCount } = buildPhaseWeeks(workdays)
      const resampledWeeks = resampleCurve(curveWeeks, phaseWeekCount)
      phaseWeights.push({ phase, resampledWeeks, dayMeta, daysInWeek })
    }

    // ── STEP 10: Calculate per-day costs and accumulate ───────────────────────
    const weekAccumulator = {} // { [mondayISO]: { materialCost, laborCost, hours } }
    const phaseBreakdown = []

    for (const { phase, resampledWeeks, dayMeta, daysInWeek } of phaseWeights) {

      // Per-phase trackers keyed by index (handles duplicate names correctly)
      const matEscalatedTotals = new Array(phase.materials.length).fill(0)
      const labEscalatedTotals = new Array(phase.labors.length).fill(0)

      for (let dayIndex = 0; dayIndex < dayMeta.length; dayIndex++) {
        const { date, phaseWeekIndex } = dayMeta[dayIndex]
        const daysInThisWeek = daysInWeek[phaseWeekIndex]
        const productionPct = resampledWeeks[phaseWeekIndex - 1] / daysInThisWeek

        // Hours
        const rawDailyHours = phase.estimatedHours * productionPct
        const dailyHours = rawDailyHours

        const currentDayStr = date.toISOString().split('T')[0]
        const mondayKey = isoMonday(date)
        if (!weekAccumulator[mondayKey]) {
          weekAccumulator[mondayKey] = { materialCost: 0, laborCost: 0, hours: 0 }
        }
        weekAccumulator[mondayKey].hours += dailyHours

        // Per-material escalation
        let totalDailyMaterialCost = 0
        for (let mIdx = 0; mIdx < phase.materials.length; mIdx++) {
          const material = phase.materials[mIdx]
          const materialYears = getLaborYearsElapsed(material.anniversaryDate, currentDayStr)
          const materialEscFactor = Math.pow(1 + parseFloat(material.escalationPercent) / 100, materialYears)
          const dailyMatCost = parseFloat(material.budget) * materialEscFactor * productionPct
          totalDailyMaterialCost += dailyMatCost
          matEscalatedTotals[mIdx] += dailyMatCost
        }

        // Per-labor escalation
        let totalDailyLaborCost = 0
        for (let lIdx = 0; lIdx < phase.labors.length; lIdx++) {
          const labor = phase.labors[lIdx]
          const laborYears = getLaborYearsElapsed(labor.anniversaryDate, currentDayStr)
          const laborEscFactor = Math.pow(1 + parseFloat(labor.escalationPercent) / 100, laborYears)
          const dailyLabCost = parseFloat(labor.budget) * laborEscFactor * productionPct
          totalDailyLaborCost += dailyLabCost
          labEscalatedTotals[lIdx] += dailyLabCost
        }

        weekAccumulator[mondayKey].materialCost += totalDailyMaterialCost
        weekAccumulator[mondayKey].laborCost    += totalDailyLaborCost
      }

      // Build phase breakdown after day loop
      const materialsBreakdown = phase.materials.map((m, mIdx) => {
        const budgeted  = parseFloat(m.budget)
        const escalated = matEscalatedTotals[mIdx]
        const difference = escalated - budgeted
        return { name: m.name, budgeted, escalated, difference, escPercent: budgeted > 0 ? difference / budgeted : 0 }
      })

      const laborsBreakdown = phase.labors.map((l, lIdx) => {
        const budgeted  = parseFloat(l.budget)
        const escalated = labEscalatedTotals[lIdx]
        const difference = escalated - budgeted
        return { name: l.name, budgeted, escalated, difference, escPercent: budgeted > 0 ? difference / budgeted : 0 }
      })

      const phaseBudgetedMat  = phase.materials.reduce((s, m) => s + parseFloat(m.budget), 0)
      const phaseEscalatedMat = materialsBreakdown.reduce((s, m) => s + m.escalated, 0)
      const phaseBudgetedLab  = phase.labors.reduce((s, l) => s + parseFloat(l.budget), 0)
      const phaseEscalatedLab = laborsBreakdown.reduce((s, l) => s + l.escalated, 0)

      phaseBreakdown.push({
        phaseName: phase.name,
        materials: materialsBreakdown,
        labors: laborsBreakdown,
        phaseMaterialTotal: {
          budgeted:   phaseBudgetedMat,
          escalated:  phaseEscalatedMat,
          difference: phaseEscalatedMat - phaseBudgetedMat,
          escPercent: phaseBudgetedMat > 0 ? (phaseEscalatedMat - phaseBudgetedMat) / phaseBudgetedMat : 0,
        },
        phaseLaborTotal: {
          budgeted:   phaseBudgetedLab,
          escalated:  phaseEscalatedLab,
          difference: phaseEscalatedLab - phaseBudgetedLab,
          escPercent: phaseBudgetedLab > 0 ? (phaseEscalatedLab - phaseBudgetedLab) / phaseBudgetedLab : 0,
        },
        phaseTotal: {
          budgeted:   phaseBudgetedMat + phaseBudgetedLab,
          escalated:  phaseEscalatedMat + phaseEscalatedLab,
          difference: (phaseEscalatedMat + phaseEscalatedLab) - (phaseBudgetedMat + phaseBudgetedLab),
          escPercent: (phaseBudgetedMat + phaseBudgetedLab) > 0
            ? ((phaseEscalatedMat + phaseEscalatedLab) - (phaseBudgetedMat + phaseBudgetedLab)) / (phaseBudgetedMat + phaseBudgetedLab)
            : 0,
        },
      })
    }

    // ── STEP 11: Sort weeks and compute cumulative totals ─────────────────────
    const sortedMondays = Object.keys(weekAccumulator).sort()
    let cumulativeMaterial = 0
    let cumulativeLabor    = 0

    const weeklyData = sortedMondays.map((mondayKey, idx) => {
      const bucket = weekAccumulator[mondayKey]
      cumulativeMaterial += bucket.materialCost
      cumulativeLabor    += bucket.laborCost
      return {
        week: idx + 1,
        weekLabel: formatWeekLabel(mondayKey),
        materialCost: bucket.materialCost,
        laborCost:    bucket.laborCost,
        hours:        bucket.hours,
        cumulativeMaterial,
        cumulativeLabor,
      }
    })

    // ── STEP 12: Summary (keys preserved for PDF export compatibility) ─────────
    const totalBudgetedMaterial  = phases.flatMap(p => p.materials).reduce((s, m) => s + parseFloat(m.budget), 0)
    const totalEscalatedMaterial = phaseBreakdown.flatMap(pb => pb.materials).reduce((s, m) => s + m.escalated, 0)
    const totalBudgetedLabor     = phases.flatMap(p => p.labors).reduce((s, l) => s + parseFloat(l.budget), 0)
    const totalEscalatedLabor    = phaseBreakdown.flatMap(pb => pb.labors).reduce((s, l) => s + l.escalated, 0)

    const summary = {
      budgetedMaterial:   totalBudgetedMaterial,
      escalatedMaterial:  totalEscalatedMaterial,
      materialDifference: totalEscalatedMaterial - totalBudgetedMaterial,
      materialEscPercent: totalBudgetedMaterial > 0 ? (totalEscalatedMaterial - totalBudgetedMaterial) / totalBudgetedMaterial : 0,
      budgetedLabor:      totalBudgetedLabor,
      escalatedLabor:     totalEscalatedLabor,
      laborDifference:    totalEscalatedLabor - totalBudgetedLabor,
      laborEscPercent:    totalBudgetedLabor > 0 ? (totalEscalatedLabor - totalBudgetedLabor) / totalBudgetedLabor : 0,
      totalBudget:        totalBudgetedMaterial + totalBudgetedLabor,
      totalEscalated:     totalEscalatedMaterial + totalEscalatedLabor,
      totalDifference:    (totalEscalatedMaterial + totalEscalatedLabor) - (totalBudgetedMaterial + totalBudgetedLabor),
      totalEscPercent:    (totalBudgetedMaterial + totalBudgetedLabor) > 0
        ? ((totalEscalatedMaterial + totalEscalatedLabor) - (totalBudgetedMaterial + totalBudgetedLabor)) / (totalBudgetedMaterial + totalBudgetedLabor)
        : 0,
    }

    // ── STEP 13: Response ─────────────────────────────────────────────────────
    res.json({
      projectInfo: {
        ...projectInfo,
        phases: phases.map(p => ({
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          estimatedHours: p.estimatedHours,
        }))
      },
      weeklyData,
      phaseBreakdown,
      summary,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
