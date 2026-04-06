import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

import curveRoutes from './routes/curveRoutes.js'
import calculateRoute from './routes/calculateRoute.js'
import adminRoutes from './routes/adminRoutes.js'
import exportRoute from './routes/exportRoute.js'
import authMiddleware from './middleware/authMiddleware.js'

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Public routes ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/admin', adminRoutes)        // POST /api/admin/login — public
app.use('/api/calculate', calculateRoute) // POST /api/calculate  — public
app.use('/api/export-pdf', exportRoute)   // POST /api/export-pdf — public

// ── Curve routes — GET is public, all mutations require auth ───────────────
const curveAuthGuard = (req, res, next) => {
  if (req.method === 'GET') return next()
  return authMiddleware(req, res, next)
}

app.use('/api/curves', curveAuthGuard, curveRoutes)

// ── Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
