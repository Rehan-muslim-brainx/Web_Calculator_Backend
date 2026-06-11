import * as curveService from '../services/curveService.js'
import { parseCurveCsv } from '../helpers/csvHelpers.js'
import { HttpError } from '../helpers/httpError.js'

export async function getCurves(req, res) {
  const publicOnly = req.query.public === 'true'
  const data = await curveService.findAll(publicOnly)
  res.json(data)
}

export async function getCurveById(req, res) {
  const data = await curveService.findById(req.params.id)
  if (!data) {
    throw new HttpError(404, 'Curve not found')
  }
  res.json(data)
}

export async function createCurve(req, res) {
  const { name, weeks } = req.body
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new HttpError(400, 'name is required')
  }

  const data = await curveService.create({ name, weeks })
  res.status(201).json(data)
}

export async function updateCurve(req, res) {
  const { name, weeks } = req.body
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new HttpError(400, 'name is required')
  }

  const data = await curveService.update(req.params.id, { name, weeks })
  res.json(data)
}

export async function deleteCurve(req, res) {
  await curveService.remove(req.params.id)
  res.json({ message: 'Curve deleted successfully' })
}

export async function toggleCurve(req, res) {
  const data = await curveService.toggleActive(req.params.id)
  res.json(data)
}

export async function uploadCurveCsv(req, res) {
  if (!req.file) {
    throw new HttpError(400, 'No file uploaded')
  }

  const name = req.body.name?.trim()
  if (!name) {
    throw new HttpError(400, 'name is required')
  }

  const weeks = await parseCurveCsv(req.file.buffer)
  const data = await curveService.create({ name, weeks })
  res.status(201).json(data)
}
