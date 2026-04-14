import { Router } from 'express'
import supabase from '../supabaseClient.js'

const router = Router()

// --- Helpers ---

function parseDate(dateStr) {
  if (!dateStr) return null

  // If format is YYYY-MM-DD (from HTML date input) use directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00')
  }

  // If format is DD/MM/YYYY convert to YYYY-MM-DD first
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split('/')
    return new Date(`${year}-${month}-${day}T00:00:00`)
  }

  // If format is MM/DD/YYYY (fallback)
  return new Date(dateStr + 'T00:00:00')
}

function isValidDate(str) {
  const d = parseDate(str)
  return !!d && !isNaN(d.getTime())
}

function toMonday(date) {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day // roll back to Monday
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function isoMonday(date) {
  return toMonday(date).toISOString().slice(0, 10)
}

// STEP 4 — build workday list for a phase
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

// STEP 5 — group workdays into phase weeks, return per-day metadata
function buildPhaseWeeks(workdays) {
  // Each workday gets a phaseWeekIndex (1-based).
  // A new phase week starts on Monday (or on the very first workday).
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

  // Count workdays per phase week (DaysInWeek for each week index)
  const daysInWeek = {}
  for (const d of dayMeta) {
    daysInWeek[d.phaseWeekIndex] = (daysInWeek[d.phaseWeekIndex] || 0) + 1
  }

  const phaseWeekCount = phaseWeekIndex

  return { dayMeta, daysInWeek, phaseWeekCount }
}

// STEP 6 — renormalize curve to phase length
function buildWeeklyPct(curveWeeks, phaseWeekCount) {
  const subset = curveWeeks.slice(0, phaseWeekCount)
  const subsetSum = subset.reduce((a, b) => a + b, 0)
  // weeklyPct is 1-indexed: weeklyPct[weekIndex] = renormalized weight
  const weeklyPct = {}
  for (let i = 0; i < phaseWeekCount; i++) {
    weeklyPct[i + 1] = subset[i] / subsetSum
  }
  return weeklyPct
}


// Format a date as "Mon D" e.g. "Jul 1"
function formatWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// POST /api/calculate
router.post('/', async (req, res) => {
  try {
    const { projectInfo, schedule, phases, materials, labor } = req.body

    // ── STEP 1: Input validation ──────────────────────────────────────────────
    if (!Array.isArray(phases) || phases.length < 1 || phases.length > 3) {
      return res.status(400).json({ error: 'phases must be an array of 1 to 3 items' })
    }

    if (!isValidDate(schedule?.startDate) || !isValidDate(schedule?.endDate)) {
      return res.status(400).json({ error: 'schedule.startDate and schedule.endDate must be valid dates' })
    }

    if (!isValidDate(materials?.anniversaryDate)) {
      return res.status(400).json({ error: 'materials.anniversaryDate must be a valid date' })
    }
    if (!isValidDate(labor?.anniversaryDate)) {
      return res.status(400).json({ error: 'labor.anniversaryDate must be a valid date' })
    }

    if (typeof materials?.budget !== 'number' || materials.budget <= 0) {
      return res.status(400).json({ error: 'materials.budget must be a positive number' })
    }
    if (typeof labor?.budget !== 'number' || labor.budget <= 0) {
      return res.status(400).json({ error: 'labor.budget must be a positive number' })
    }
    if (typeof materials?.escalationPercent !== 'number' || materials.escalationPercent < 0) {
      return res.status(400).json({ error: 'materials.escalationPercent must be 0 or a positive number' })
    }
    if (typeof labor?.escalationPercent !== 'number' || labor.escalationPercent < 0) {
      return res.status(400).json({ error: 'labor.escalationPercent must be 0 or a positive number' })
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
    }

    // ── STEP 2: Fetch curves from Supabase ────────────────────────────────────
    const curveMap = {}
    for (const phase of phases) {
      const { data: curve, error } = await supabase
        .from('curves')
        .select('weeks')
        .eq('id', phase.curveId)
        .single()

      if (error || !curve) {
        return res.status(404).json({ error: `Curve not found for phase '${phase.name}' (id: ${phase.curveId})` })
      }
      curveMap[phase.curveId] = curve.weeks
    }

    // ── STEP 3: Validate no phase date overlaps ───────────────────────────────
    for (let i = 0; i < phases.length; i++) {
      for (let j = i + 1; j < phases.length; j++) {
        const a = phases[i]
        const b = phases[j]
        const overlap = parseDate(a.startDate) < parseDate(b.endDate) &&
                        parseDate(b.startDate) < parseDate(a.endDate)
        if (overlap) {
          return res.status(400).json({
            error: `Phase '${a.name}' and '${b.name}' have overlapping dates`
          })
        }
      }
    }

    // ── STEPS 4–9: Per-phase daily calculations ───────────────────────────────

    const getFullYearsElapsed = (anniversaryDate, currentDate) => {
      const ann = parseDate(anniversaryDate)
      const cur = parseDate(currentDate)

      if (!ann || !cur || cur < ann) return 0

      let years = cur.getFullYear() - ann.getFullYear()

      const anniversaryThisYear = new Date(
        cur.getFullYear(),
        ann.getMonth(),
        ann.getDate()
      )

      if (cur < anniversaryThisYear) {
        years -= 1
      }

      return Math.max(0, years)
    }

    console.log('Material anniversary parsed:', parseDate(materials.anniversaryDate))
    console.log('Labor anniversary parsed:', parseDate(labor.anniversaryDate))

    // Pre-pass: compute each phase's subset sum so we can distribute the total
    // budget proportionally across phases (fixes double-counting bug).
    const phaseData = []
    let totalProjectWeight = 0

    for (const phase of phases) {
      const curveWeeks = curveMap[phase.curveId]
      const workdays = getWorkdays(phase.startDate, phase.endDate)
      if (workdays.length === 0) {
        return res.status(400).json({ error: `Phase '${phase.name}' has no workdays in its date range` })
      }
      const { dayMeta, daysInWeek, phaseWeekCount } = buildPhaseWeeks(workdays)
      const subsetSum = curveWeeks.slice(0, phaseWeekCount).reduce((a, b) => a + b, 0)
      totalProjectWeight += subsetSum
      phaseData.push({ phase, curveWeeks, dayMeta, daysInWeek, phaseWeekCount, subsetSum })
    }

    // Accumulate into a map keyed by ISO Monday date string
    const weekAccumulator = {} // { [mondayISO]: { materialCost, laborCost, hours } }

    for (const { phase, curveWeeks, dayMeta, daysInWeek, phaseWeekCount, subsetSum } of phaseData) {

      // Each phase gets its proportional share of the total budget
      const phaseMaterialBudget = materials.budget * (subsetSum / totalProjectWeight)
      const phaseLaborBudget    = labor.budget    * (subsetSum / totalProjectWeight)

      // Step 6 — renormalize curve
      const weeklyPct = buildWeeklyPct(curveWeeks, phaseWeekCount)

      // Steps 7–9 — per workday
      for (let dayIndex = 0; dayIndex < dayMeta.length; dayIndex++) {
        const { date, phaseWeekIndex } = dayMeta[dayIndex]
        const daysInThisWeek = daysInWeek[phaseWeekIndex]
        const productionPct = weeklyPct[phaseWeekIndex] / daysInThisWeek

        // Step 7
        const rawDailyHours = phase.estimatedHours * productionPct
        const dailyHours = Math.max(8, rawDailyHours)

        // Step 8 — Material escalation factor
        const currentDayStr = date.toISOString().split('T')[0]
        const materialYears = getFullYearsElapsed(materials.anniversaryDate, currentDayStr)
        const matEscFactor = Math.pow(1 + materials.escalationPercent / 100, materialYears)

        // Labor escalation factor
        const laborYears = getFullYearsElapsed(labor.anniversaryDate, currentDayStr)
        const labEscFactor = Math.pow(1 + labor.escalationPercent / 100, laborYears)

        // Log first day of each phase to verify escalation years
        if (dayIndex === 0) {
          console.log(`--- Phase: ${phase.name} ---`)
          console.log(`First day: ${currentDayStr}`)
          console.log(`Labor anniversary raw: ${labor.anniversaryDate}`)
          console.log(`Labor anniversary parsed: ${parseDate(labor.anniversaryDate)}`)
          console.log(`Labor years elapsed: ${laborYears}`)
          console.log(`Labor esc factor: ${labEscFactor}`)
        }

        // Step 9 — use phase-proportional budget, not total budget
        const dailyMaterialCost = phaseMaterialBudget * matEscFactor * productionPct
        const dailyLaborCost    = phaseLaborBudget    * labEscFactor * productionPct

        // Step 10 — accumulate into calendar week bucket
        const mondayKey = isoMonday(date)
        if (!weekAccumulator[mondayKey]) {
          weekAccumulator[mondayKey] = { materialCost: 0, laborCost: 0, hours: 0 }
        }
        weekAccumulator[mondayKey].materialCost += dailyMaterialCost
        weekAccumulator[mondayKey].laborCost    += dailyLaborCost
        weekAccumulator[mondayKey].hours        += dailyHours
      }
    }

    // ── STEP 10: Sort weeks chronologically and compute cumulative totals ──────
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
        cumulativeLabor
      }
    })

    // ── STEP 11: Summary ──────────────────────────────────────────────────────
    const escalatedMaterial = weeklyData.reduce((sum, w) => sum + w.materialCost, 0)
    const escalatedLabor = weeklyData.reduce((sum, w) => sum + w.laborCost, 0)

    const budgetedMaterial = materials.budget
    const budgetedLabor = labor.budget

    const materialDifference = escalatedMaterial - budgetedMaterial
    const laborDifference = escalatedLabor - budgetedLabor

    const totalBudget = budgetedMaterial + budgetedLabor
    const totalEscalated = escalatedMaterial + escalatedLabor
    const totalDifference = totalEscalated - totalBudget

    const summary = {
      budgetedMaterial,
      escalatedMaterial,
      materialDifference,
      materialEscPercent: materialDifference / budgetedMaterial,
      budgetedLabor,
      escalatedLabor,
      laborDifference,
      laborEscPercent: laborDifference / budgetedLabor,
      totalBudget,
      totalEscalated,
      totalDifference,
      totalEscPercent: totalDifference / totalBudget
    }

    // ── STEP 12: Response ─────────────────────────────────────────────────────
    res.json({
      projectInfo: {
        ...projectInfo,
        phases: phases.map(p => ({
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          estimatedHours: p.estimatedHours
        }))
      },
      weeklyData,
      summary
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
