import jwt from 'jsonwebtoken'
import { HttpError } from '../helpers/httpError.js'

export function login(username, password) {
  if (!username || !password) {
    throw new HttpError(400, 'username and password are required')
  }

  if (username !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASS) {
    throw new HttpError(401, 'Invalid credentials')
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' })
  return { token }
}
