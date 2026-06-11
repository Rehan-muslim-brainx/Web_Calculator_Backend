import * as healthService from '../services/healthService.js'

export async function getHealth(req, res) {
  try {
    const result = await healthService.checkHealth()
    res.json(result)
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      db: err.message,
      timestamp: new Date().toISOString(),
    })
  }
}
