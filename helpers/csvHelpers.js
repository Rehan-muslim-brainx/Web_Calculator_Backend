import csvParser from 'csv-parser'
import { Readable } from 'stream'
import { HttpError } from './httpError.js'

function getWeekIndex(row) {
  return row['week_index'] ?? row['week index'] ?? row['weekindex'] ?? row['week'] ?? row['wk'] ?? row['index'] ?? undefined
}

function getPercent(row) {
  return row['percent'] ?? row['percentage'] ?? row['pct'] ?? row['value'] ?? row['weight'] ?? undefined
}

export async function parseCurveCsv(buffer) {
  const rows = await new Promise((resolve, reject) => {
    const results = []
    const stream = Readable.from(buffer.toString('utf-8'))
    stream
      .pipe(csvParser({ mapHeaders: ({ header }) => header.toLowerCase().trim(), skipEmptyLines: true }))
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject)
  })

  if (!rows || rows.length === 0) {
    throw new HttpError(400, 'CSV file is empty or could not be parsed')
  }

  console.log('CSV columns found:', Object.keys(rows[0]))
  console.log('Total rows parsed:', rows.length)

  if (rows.length !== 52) {
    throw new HttpError(400, `CSV must have exactly 52 rows (got ${rows.length})`)
  }

  if (getWeekIndex(rows[0]) === undefined || getPercent(rows[0]) === undefined) {
    throw new HttpError(
      400,
      `Could not read CSV columns. Expected "week_index" and "percent". Found: ${Object.keys(rows[0]).join(', ')}`
    )
  }

  const parsed = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const weekIndex = parseInt(getWeekIndex(row), 10)
    const percent = parseFloat(getPercent(row))

    if (isNaN(weekIndex) || weekIndex < 1 || weekIndex > 52) {
      throw new HttpError(
        400,
        `Row ${i + 1}: week_index must be an integer between 1 and 52 (got "${getWeekIndex(row)}")`
      )
    }
    if (isNaN(percent)) {
      throw new HttpError(400, `Row ${i + 1}: percent must be a number (got "${getPercent(row)}")`)
    }

    parsed.push({ weekIndex, percent })
  }

  const needsNormalization = parsed.some(r => r.percent > 1)
  const normalized = parsed.map(r => ({
    weekIndex: r.weekIndex,
    value: needsNormalization ? r.percent / 100 : r.percent,
  }))

  normalized.sort((a, b) => a.weekIndex - b.weekIndex)

  const uniqueIndices = new Set(normalized.map(r => r.weekIndex))
  if (uniqueIndices.size !== 52) {
    throw new HttpError(400, 'week_index values must be unique and cover weeks 1–52')
  }

  const weeks = normalized.map(r => r.value)
  const sum = weeks.reduce((a, b) => a + b, 0)
  if (sum < 0.99 || sum > 1.01) {
    throw new HttpError(400, `Week values must sum to ~1.0 (got ${sum.toFixed(6)})`)
  }

  return weeks
}
