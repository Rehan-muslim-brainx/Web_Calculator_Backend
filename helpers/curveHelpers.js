export function validateWeeks(weeks) {
  if (!Array.isArray(weeks) || weeks.length !== 52) {
    return 'weeks must be an array of exactly 52 numbers'
  }
  if (weeks.some(w => typeof w !== 'number' || isNaN(w))) {
    return 'every value in weeks must be a number'
  }
  const sum = weeks.reduce((a, b) => a + b, 0)
  if (sum < 0.99 || sum > 1.01) {
    return `weeks must sum to ~1.0 (got ${sum.toFixed(6)})`
  }
  return null
}

export function resampleCurve(curveWeeks, targetWeekCount) {
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
