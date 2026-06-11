import express from 'express'
import cors from 'cors'
import curveRoutes from './routes/curveRoutes.js'
import calculateRoutes from './routes/calculateRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import exportRoutes from './routes/exportRoutes.js'
import healthRoutes from './routes/healthRoutes.js'
import authMiddleware from './middleware/authMiddleware.js'

const app = express()

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
].filter(Boolean)

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

app.options('*', cors(corsOptions))
app.use(cors(corsOptions))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/health', healthRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/calculate', calculateRoutes)
app.use('/api/export-pdf', exportRoutes)

const curveAuthGuard = (req, res, next) => {
  if (req.method === 'GET') return next()
  return authMiddleware(req, res, next)
}

app.use('/api/curves', curveAuthGuard, curveRoutes)

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app
