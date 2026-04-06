import { Router } from 'express'
import multer from 'multer'
import csvParser from 'csv-parser'
import { Readable } from 'stream'
import supabase from '../supabaseClient.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// --- Validation helper ---
function validateWeeks(weeks) {
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

// GET /api/curves
router.get('/', async (req, res) => {
  try {
    let query = supabase.from('curves').select('*').order('created_at', { ascending: true })

    if (req.query.public === 'true') {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query
    if (error) throw error

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/curves/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('curves')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Curve not found' })
    }
    if (error) throw error

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/curves
router.post('/', async (req, res) => {
  try {
    const { name, weeks } = req.body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' })
    }

    const validationError = validateWeeks(weeks)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }

    const { data, error } = await supabase
      .from('curves')
      .insert({ name: name.trim(), weeks, is_active: true })
      .select()
      .single()

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/curves/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, weeks } = req.body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' })
    }

    const validationError = validateWeeks(weeks)
    if (validationError) {
      return res.status(400).json({ error: validationError })
    }

    const { data, error } = await supabase
      .from('curves')
      .update({ name: name.trim(), weeks })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Curve not found' })
    }
    if (error) throw error

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/curves/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('curves')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error

    res.json({ message: 'Curve deleted successfully' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/curves/:id/toggle
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { data: current, error: fetchError } = await supabase
      .from('curves')
      .select('is_active')
      .eq('id', req.params.id)
      .single()

    if (fetchError && fetchError.code === 'PGRST116') {
      return res.status(404).json({ error: 'Curve not found' })
    }
    if (fetchError) throw fetchError

    const { data, error } = await supabase
      .from('curves')
      .update({ is_active: !current.is_active })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/curves/upload-csv
router.post('/upload-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const name = req.body.name?.trim()
    if (!name) {
      return res.status(400).json({ error: 'name is required' })
    }

    // Parse CSV — mapHeaders lowercases+trims all column names at parse time
    const rows = await new Promise((resolve, reject) => {
      const results = []
      const stream = Readable.from(req.file.buffer.toString('utf-8'))
      stream
        .pipe(csvParser({ mapHeaders: ({ header }) => header.toLowerCase().trim(), skipEmptyLines: true }))
        .on('data', (row) => results.push(row))
        .on('end', () => resolve(results))
        .on('error', reject)
    })

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty or could not be parsed' })
    }

    console.log('CSV columns found:', Object.keys(rows[0]))
    console.log('Total rows parsed:', rows.length)

    if (rows.length !== 52) {
      return res.status(400).json({
        error: `CSV must have exactly 52 rows (got ${rows.length})`
      })
    }

    // Flexible column name resolution — accepts week_index / week / wk / index
    // and percent / percentage / pct / value / weight
    const getWeekIndex = (row) =>
      row['week_index'] ?? row['week index'] ?? row['weekindex'] ?? row['week'] ?? row['wk'] ?? row['index'] ?? undefined
    const getPercent = (row) =>
      row['percent'] ?? row['percentage'] ?? row['pct'] ?? row['value'] ?? row['weight'] ?? undefined

    // Check that at least the first row has recognisable columns
    if (getWeekIndex(rows[0]) === undefined || getPercent(rows[0]) === undefined) {
      return res.status(400).json({
        error: `Could not read CSV columns. Expected "week_index" and "percent". Found: ${Object.keys(rows[0]).join(', ')}`
      })
    }

    // Parse and validate each row
    const parsed = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const weekIndex = parseInt(getWeekIndex(row), 10)
      const percent = parseFloat(getPercent(row))

      if (isNaN(weekIndex) || weekIndex < 1 || weekIndex > 52) {
        return res.status(400).json({
          error: `Row ${i + 1}: week_index must be an integer between 1 and 52 (got "${getWeekIndex(row)}")`
        })
      }
      if (isNaN(percent)) {
        return res.status(400).json({
          error: `Row ${i + 1}: percent must be a number (got "${getPercent(row)}")`
        })
      }

      parsed.push({ weekIndex, percent })
    }

    // Auto-detect percentage vs decimal — if any value > 1 assume percentages, divide all by 100
    const needsNormalization = parsed.some(r => r.percent > 1)
    const normalized = parsed.map(r => ({
      weekIndex: r.weekIndex,
      value: needsNormalization ? r.percent / 100 : r.percent
    }))

    // Sort by week_index and build 52-element array
    normalized.sort((a, b) => a.weekIndex - b.weekIndex)

    const uniqueIndices = new Set(normalized.map(r => r.weekIndex))
    if (uniqueIndices.size !== 52) {
      return res.status(400).json({ error: 'week_index values must be unique and cover weeks 1–52' })
    }

    const weeks = normalized.map(r => r.value)

    const sum = weeks.reduce((a, b) => a + b, 0)
    if (sum < 0.99 || sum > 1.01) {
      return res.status(400).json({
        error: `Week values must sum to ~1.0 (got ${sum.toFixed(6)})`
      })
    }

    const { data, error } = await supabase
      .from('curves')
      .insert({ name, weeks, is_active: true })
      .select()
      .single()

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
