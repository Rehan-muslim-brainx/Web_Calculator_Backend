import * as calculateService from '../services/calculateService.js'

export async function calculate(req, res) {
  const result = await calculateService.calculate(req.body)
  res.json(result)
}
