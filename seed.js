import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const curves = [
  {
    name: 'Flat',
    weeks: Array(52).fill(0.019230769),
    is_active: true,
  },
  {
    name: 'Bell',
    weeks: [
      0.00031,0.00046,0.00067,0.000958,0.001352,0.001877,0.002565,0.003454,0.004565,0.005955,
      0.007663,0.009656,0.012028,0.014744,0.017759,0.021129,0.024645,0.028373,0.032187,0.035858,
      0.039444,0.042628,0.045354,0.047531,0.049031,0.049812,0.049812,0.049031,0.047531,0.045354,
      0.042628,0.039444,0.035858,0.032187,0.028373,0.024645,0.021129,0.017759,0.014744,0.012028,
      0.009656,0.007663,0.005955,0.004565,0.003454,0.002565,0.001877,0.001352,0.000958,0.00067,
      0.00046,0.00031,
    ],
    is_active: true,
  },
  {
    name: 'Frontloaded',
    weeks: [
      0.05374,0.051053,0.0485,0.046075,0.043771,0.041582,0.039503,0.037528,0.035652,0.033869,
      0.032176,0.030567,0.029039,0.027587,0.026208,0.024897,0.023652,0.022469,0.021346,0.020279,
      0.019265,0.018302,0.017387,0.016518,0.015692,0.014907,0.014162,0.013454,0.012781,0.012142,
      0.011535,0.010958,0.01041,0.009889,0.009395,0.008925,0.008479,0.008055,0.007652,0.007269,
      0.006906,0.006561,0.006233,0.005921,0.005625,0.005344,0.005077,0.004823,0.004582,0.004353,
      0.004135,0.003928,
    ],
    is_active: true,
  },
  {
    name: 'Escalating',
    weeks: [
      0.003928,0.004135,0.004353,0.004582,0.004823,0.005077,0.005344,0.005625,0.005921,0.006233,
      0.006561,0.006906,0.007269,0.007652,0.008055,0.008479,0.008925,0.009395,0.009889,0.01041,
      0.010958,0.011535,0.012142,0.012781,0.013454,0.014162,0.014907,0.015692,0.016518,0.017387,
      0.018302,0.019265,0.020279,0.021346,0.022469,0.023652,0.024897,0.026208,0.027587,0.029039,
      0.030567,0.032176,0.033869,0.035652,0.037528,0.039503,0.041582,0.043771,0.046075,0.0485,
      0.051053,0.05374,
    ],
    is_active: true,
  },
  {
    name: 'KI_CURVE',
    weeks: [
      0.0001,0.00015,0.00015,0.0001,0.0004,0.0006,0.0006,0.001,0.001,0.001,
      0.004,0.0064,0.008,0.012,0.0155,0.019,0.024,0.025,0.029,0.034,
      0.042,0.044,0.048,0.052,0.055,0.056,0.057,0.056,0.054,0.048,
      0.047,0.046,0.04,0.029,0.029,0.029,0.021,0.0166,0.0131,0.0102,
      0.007,0.005,0.004,0.003,0.0023,0.001,0.001,0.0006,0.0004,0.0001,
      0.0001,0.0005,
    ],
    is_active: true,
  },
]

async function seed() {
  console.log('Connecting to Supabase...')

  // First ensure the table exists by attempting a select
  const { error: tableCheck } = await supabase.from('curves').select('id').limit(1)
  if (tableCheck) {
    console.error('❌ Table "curves" does not exist yet.')
    console.error('   Please run server/supabase/schema.sql in Supabase SQL Editor first to create the table.')
    console.error('   Error:', tableCheck.message)
    process.exit(1)
  }

  console.log('Seeding curves...\n')

  for (const curve of curves) {
    // Upsert so re-running the script won't create duplicates
    const { data, error } = await supabase
      .from('curves')
      .upsert({ ...curve }, { onConflict: 'name' })
      .select('id, name')
      .single()

    if (error) {
      console.error(`❌ Failed to seed "${curve.name}":`, error.message)
    } else {
      const sum = curve.weeks.reduce((a, b) => a + b, 0)
      console.log(`✅ ${curve.name.padEnd(14)} | weeks: ${curve.weeks.length} | sum: ${sum.toFixed(6)}`)
    }
  }

  console.log('\nDone.')
}

seed()
