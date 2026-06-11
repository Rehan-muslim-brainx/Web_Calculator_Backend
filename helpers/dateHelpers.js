export function parseDate(dateStr) {
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

export function isValidDate(str) {
  const d = parseDate(str)
  return !!d && !isNaN(d.getTime())
}

export function toMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function isoMonday(date) {
  return toMonday(date).toISOString().slice(0, 10)
}

export function getWorkdays(startDate, endDate) {
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

export function buildPhaseWeeks(workdays) {
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

export function formatWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDisplayDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-US')
  } catch {
    return d || '—'
  }
}
