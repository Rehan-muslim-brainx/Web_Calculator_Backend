import * as adminService from '../services/adminService.js'

export function login(req, res) {
  const { username, password } = req.body
  const result = adminService.login(username, password)
  res.json(result)
}
