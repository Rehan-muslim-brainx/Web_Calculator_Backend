import * as curveService from './curveService.js'

export async function checkHealth() {
  await curveService.ping()
  return {
    status: 'ok',
    db: 'connected',
    timestamp: new Date().toISOString(),
  }
}
