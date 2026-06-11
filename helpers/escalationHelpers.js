import { parseDate } from './dateHelpers.js'

export function getFullYearsElapsed(anniversaryDate, currentDate) {
  const ann = parseDate(anniversaryDate)
  const cur = parseDate(currentDate)
  if (!ann || !cur || cur < ann) return 0
  let years = cur.getFullYear() - ann.getFullYear()
  const anniversaryThisYear = new Date(cur.getFullYear(), ann.getMonth(), ann.getDate())
  if (cur < anniversaryThisYear) years -= 1
  return Math.max(0, years)
}

export function getLaborYearsElapsed(anniversaryDateStr, currentDateStr) {
  const ann = parseDate(anniversaryDateStr)
  const cur = parseDate(currentDateStr)
  if (cur < ann) return 0
  const diffMs = cur.getTime() - ann.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return Math.floor(diffDays / 365) + 1
}
