import './config/env.js'
import { connectDatabase } from './config/database.js'
import { seedCurves } from './data/seedCurves.js'
import * as curveService from './services/curveService.js'

async function seed() {
  const dbConnected = await connectDatabase()
  if (!dbConnected) {
    process.exit(1)
  }

  console.log('Seeding curves...\n')

  try {
    await curveService.seedAll(seedCurves)

    for (const curve of seedCurves) {
      const sum = curve.weeks.reduce((a, b) => a + b, 0)
      console.log(`✅ ${curve.name.padEnd(14)} | weeks: ${curve.weeks.length} | sum: ${sum.toFixed(6)}`)
    }
  } catch (err) {
    console.error('❌ Seeding failed:', err.message)
    process.exit(1)
  }

  console.log('\nDone.')
  process.exit(0)
}

seed()
