import * as curveService from './curveService.js'
import { HttpError } from '../helpers/httpError.js'
import {
  parseDate,
  isValidDate,
  isoMonday,
  getWorkdays,
  buildPhaseWeeks,
  formatWeekLabel,
} from '../helpers/dateHelpers.js'
import { resampleCurve } from '../helpers/curveHelpers.js'
import { getLaborYearsElapsed } from '../helpers/escalationHelpers.js'

function validatePhases(phases, schedule) {
  if (!Array.isArray(phases) || phases.length < 1 || phases.length > 3) {
    throw new HttpError(400, 'phases must be an array of 1 to 3 items')
  }

  if (!isValidDate(schedule?.startDate) || !isValidDate(schedule?.endDate)) {
    throw new HttpError(400, 'schedule.startDate and schedule.endDate must be valid dates')
  }

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]
    const label = `phases[${i}]`

    if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
      throw new HttpError(400, `${label}.name is required`)
    }
    if (!isValidDate(p.startDate) || !isValidDate(p.endDate)) {
      throw new HttpError(400, `${label} must have valid startDate and endDate`)
    }
    if (parseDate(p.startDate) >= parseDate(p.endDate)) {
      throw new HttpError(400, `${label}.startDate must be before endDate`)
    }
    if (typeof p.estimatedHours !== 'number' || p.estimatedHours <= 0) {
      throw new HttpError(400, `${label}.estimatedHours must be a positive number`)
    }
    if (!p.curveId) {
      throw new HttpError(400, `${label}.curveId is required`)
    }

    if (!Array.isArray(p.materials) || p.materials.length === 0) {
      throw new HttpError(400, `Phase "${p.name}" must have at least 1 material`)
    }
    if (p.materials.length > 5) {
      throw new HttpError(400, `Phase "${p.name}" may have at most 5 materials`)
    }
    for (const mat of p.materials) {
      if (!mat.name || !mat.name.trim()) {
        throw new HttpError(400, `A material in phase "${p.name}" is missing a name`)
      }
      if (!mat.budget || isNaN(parseFloat(mat.budget))) {
        throw new HttpError(400, `Material "${mat.name}" in phase "${p.name}" has invalid budget`)
      }
      if (mat.escalationPercent === undefined || mat.escalationPercent === null || isNaN(parseFloat(mat.escalationPercent))) {
        throw new HttpError(400, `Material "${mat.name}" in phase "${p.name}" has invalid escalation percent`)
      }
      if (!mat.anniversaryDate) {
        throw new HttpError(400, `Material "${mat.name}" in phase "${p.name}" is missing anniversary date`)
      }
      if (!isValidDate(mat.anniversaryDate)) {
        throw new HttpError(400, `Material "${mat.name}" in phase "${p.name}" has invalid anniversary date`)
      }
    }

    if (!Array.isArray(p.labors) || p.labors.length === 0) {
      throw new HttpError(400, `Phase "${p.name}" must have at least 1 labor type`)
    }
    if (p.labors.length > 5) {
      throw new HttpError(400, `Phase "${p.name}" may have at most 5 labor types`)
    }
    for (const lab of p.labors) {
      if (!lab.name || !lab.name.trim()) {
        throw new HttpError(400, `A labor type in phase "${p.name}" is missing a name`)
      }
      if (!lab.budget || isNaN(parseFloat(lab.budget))) {
        throw new HttpError(400, `Labor "${lab.name}" in phase "${p.name}" has invalid budget`)
      }
      if (lab.escalationPercent === undefined || lab.escalationPercent === null || isNaN(parseFloat(lab.escalationPercent))) {
        throw new HttpError(400, `Labor "${lab.name}" in phase "${p.name}" has invalid escalation percent`)
      }
      if (!lab.anniversaryDate) {
        throw new HttpError(400, `Labor "${lab.name}" in phase "${p.name}" is missing anniversary date`)
      }
      if (!isValidDate(lab.anniversaryDate)) {
        throw new HttpError(400, `Labor "${lab.name}" in phase "${p.name}" has invalid anniversary date`)
      }
    }
  }
}

async function fetchCurveMap(phases) {
  const curveMap = {}
  for (const phase of phases) {
    if (curveMap[phase.curveId]) continue

    const weeks = await curveService.findWeeksById(phase.curveId)
    if (!weeks) {
      throw new HttpError(404, `Curve not found for phase '${phase.name}' (id: ${phase.curveId})`)
    }

    curveMap[phase.curveId] = weeks
  }
  return curveMap
}

export async function calculate({ projectInfo, schedule, phases }) {
  validatePhases(phases, schedule)

  const curveMap = await fetchCurveMap(phases)

  const phaseWeights = []
  for (const phase of phases) {
    const curveWeeks = curveMap[phase.curveId]
    const workdays = getWorkdays(phase.startDate, phase.endDate)
    if (workdays.length === 0) {
      throw new HttpError(400, `Phase '${phase.name}' has no workdays in its date range`)
    }
    const { dayMeta, daysInWeek, phaseWeekCount } = buildPhaseWeeks(workdays)
    const resampledWeeks = resampleCurve(curveWeeks, phaseWeekCount)
    phaseWeights.push({ phase, resampledWeeks, dayMeta, daysInWeek })
  }

  const weekAccumulator = {}
  const phaseBreakdown = []

  for (const { phase, resampledWeeks, dayMeta, daysInWeek } of phaseWeights) {
    const matEscalatedTotals = new Array(phase.materials.length).fill(0)
    const labEscalatedTotals = new Array(phase.labors.length).fill(0)

    for (let dayIndex = 0; dayIndex < dayMeta.length; dayIndex++) {
      const { date, phaseWeekIndex } = dayMeta[dayIndex]
      const daysInThisWeek = daysInWeek[phaseWeekIndex]
      const productionPct = resampledWeeks[phaseWeekIndex - 1] / daysInThisWeek

      const rawDailyHours = phase.estimatedHours * productionPct
      const dailyHours = rawDailyHours

      const currentDayStr = date.toISOString().split('T')[0]
      const mondayKey = isoMonday(date)
      if (!weekAccumulator[mondayKey]) {
        weekAccumulator[mondayKey] = { materialCost: 0, laborCost: 0, hours: 0 }
      }
      weekAccumulator[mondayKey].hours += dailyHours

      let totalDailyMaterialCost = 0
      for (let mIdx = 0; mIdx < phase.materials.length; mIdx++) {
        const material = phase.materials[mIdx]
        const materialYears = getLaborYearsElapsed(material.anniversaryDate, currentDayStr)
        const materialEscFactor = Math.pow(1 + parseFloat(material.escalationPercent) / 100, materialYears)
        const dailyMatCost = parseFloat(material.budget) * materialEscFactor * productionPct
        totalDailyMaterialCost += dailyMatCost
        matEscalatedTotals[mIdx] += dailyMatCost
      }

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
      weekAccumulator[mondayKey].laborCost += totalDailyLaborCost
    }

    const materialsBreakdown = phase.materials.map((m, mIdx) => {
      const budgeted = parseFloat(m.budget)
      const escalated = matEscalatedTotals[mIdx]
      const difference = escalated - budgeted
      return { name: m.name, budgeted, escalated, difference, escPercent: budgeted > 0 ? difference / budgeted : 0 }
    })

    const laborsBreakdown = phase.labors.map((l, lIdx) => {
      const budgeted = parseFloat(l.budget)
      const escalated = labEscalatedTotals[lIdx]
      const difference = escalated - budgeted
      return { name: l.name, budgeted, escalated, difference, escPercent: budgeted > 0 ? difference / budgeted : 0 }
    })

    const phaseBudgetedMat = phase.materials.reduce((s, m) => s + parseFloat(m.budget), 0)
    const phaseEscalatedMat = materialsBreakdown.reduce((s, m) => s + m.escalated, 0)
    const phaseBudgetedLab = phase.labors.reduce((s, l) => s + parseFloat(l.budget), 0)
    const phaseEscalatedLab = laborsBreakdown.reduce((s, l) => s + l.escalated, 0)

    phaseBreakdown.push({
      phaseName: phase.name,
      materials: materialsBreakdown,
      labors: laborsBreakdown,
      phaseMaterialTotal: {
        budgeted: phaseBudgetedMat,
        escalated: phaseEscalatedMat,
        difference: phaseEscalatedMat - phaseBudgetedMat,
        escPercent: phaseBudgetedMat > 0 ? (phaseEscalatedMat - phaseBudgetedMat) / phaseBudgetedMat : 0,
      },
      phaseLaborTotal: {
        budgeted: phaseBudgetedLab,
        escalated: phaseEscalatedLab,
        difference: phaseEscalatedLab - phaseBudgetedLab,
        escPercent: phaseBudgetedLab > 0 ? (phaseEscalatedLab - phaseBudgetedLab) / phaseBudgetedLab : 0,
      },
      phaseTotal: {
        budgeted: phaseBudgetedMat + phaseBudgetedLab,
        escalated: phaseEscalatedMat + phaseEscalatedLab,
        difference: (phaseEscalatedMat + phaseEscalatedLab) - (phaseBudgetedMat + phaseBudgetedLab),
        escPercent: (phaseBudgetedMat + phaseBudgetedLab) > 0
          ? ((phaseEscalatedMat + phaseEscalatedLab) - (phaseBudgetedMat + phaseBudgetedLab)) / (phaseBudgetedMat + phaseBudgetedLab)
          : 0,
      },
    })
  }

  const sortedMondays = Object.keys(weekAccumulator).sort()
  let cumulativeMaterial = 0
  let cumulativeLabor = 0

  const weeklyData = sortedMondays.map((mondayKey, idx) => {
    const bucket = weekAccumulator[mondayKey]
    cumulativeMaterial += bucket.materialCost
    cumulativeLabor += bucket.laborCost
    return {
      week: idx + 1,
      weekLabel: formatWeekLabel(mondayKey),
      materialCost: bucket.materialCost,
      laborCost: bucket.laborCost,
      hours: bucket.hours,
      cumulativeMaterial,
      cumulativeLabor,
    }
  })

  const totalBudgetedMaterial = phases.flatMap(p => p.materials).reduce((s, m) => s + parseFloat(m.budget), 0)
  const totalEscalatedMaterial = phaseBreakdown.flatMap(pb => pb.materials).reduce((s, m) => s + m.escalated, 0)
  const totalBudgetedLabor = phases.flatMap(p => p.labors).reduce((s, l) => s + parseFloat(l.budget), 0)
  const totalEscalatedLabor = phaseBreakdown.flatMap(pb => pb.labors).reduce((s, l) => s + l.escalated, 0)

  const summary = {
    budgetedMaterial: totalBudgetedMaterial,
    escalatedMaterial: totalEscalatedMaterial,
    materialDifference: totalEscalatedMaterial - totalBudgetedMaterial,
    materialEscPercent: totalBudgetedMaterial > 0 ? (totalEscalatedMaterial - totalBudgetedMaterial) / totalBudgetedMaterial : 0,
    budgetedLabor: totalBudgetedLabor,
    escalatedLabor: totalEscalatedLabor,
    laborDifference: totalEscalatedLabor - totalBudgetedLabor,
    laborEscPercent: totalBudgetedLabor > 0 ? (totalEscalatedLabor - totalBudgetedLabor) / totalBudgetedLabor : 0,
    totalBudget: totalBudgetedMaterial + totalBudgetedLabor,
    totalEscalated: totalEscalatedMaterial + totalEscalatedLabor,
    totalDifference: (totalEscalatedMaterial + totalEscalatedLabor) - (totalBudgetedMaterial + totalBudgetedLabor),
    totalEscPercent: (totalBudgetedMaterial + totalBudgetedLabor) > 0
      ? ((totalEscalatedMaterial + totalEscalatedLabor) - (totalBudgetedMaterial + totalBudgetedLabor)) / (totalBudgetedMaterial + totalBudgetedLabor)
      : 0,
  }

  return {
    projectInfo: {
      ...projectInfo,
      phases: phases.map(p => ({
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        estimatedHours: p.estimatedHours,
      })),
    },
    weeklyData,
    phaseBreakdown,
    summary,
  }
}
