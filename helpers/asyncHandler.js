import { HttpError } from './httpError.js'

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (err instanceof HttpError) {
        return res.status(err.statusCode).json({ error: err.message })
      }
      return res.status(500).json({ error: err.message })
    })
  }
}
