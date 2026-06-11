import './config/env.js'
import app from './app.js'
import { connectDatabase } from './config/database.js'

const dbConnected = await connectDatabase()

if (process.env.VERCEL) {
  // Vercel serverless: handled by export default app at the bottom.
  // Do not call app.listen() — Vercel invokes the exported app per request.
} else {
  const PORT = process.env.PORT || 5000
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`)
    if (!dbConnected) {
      console.warn('Server started without a database connection')
    }
  })
}

export default app
