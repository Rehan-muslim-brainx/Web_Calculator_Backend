import { getCurvesCollection } from '../config/database.js'
import { toCurve, toCurves, parseObjectId } from '../models/Curve.js'
import { validateWeeks } from '../helpers/curveHelpers.js'
import { HttpError } from '../helpers/httpError.js'

export async function findAll(publicOnly = false) {
  const collection = await getCurvesCollection()
  const filter = publicOnly ? { is_active: true } : {}
  const docs = await collection.find(filter).sort({ created_at: 1 }).toArray()
  return toCurves(docs)
}

export async function findById(id) {
  const objectId = parseObjectId(id)
  if (!objectId) return null

  const collection = await getCurvesCollection()
  const doc = await collection.findOne({ _id: objectId })
  return toCurve(doc)
}

export async function findWeeksById(id) {
  const objectId = parseObjectId(id)
  if (!objectId) return null

  const collection = await getCurvesCollection()
  const doc = await collection.findOne({ _id: objectId })
  if (!doc) return null
  return doc.weeks.map(w => parseFloat(w))
}

export async function create({ name, weeks }) {
  const validationError = validateWeeks(weeks)
  if (validationError) {
    throw new HttpError(400, validationError)
  }

  const collection = await getCurvesCollection()
  const doc = {
    name: name.trim(),
    weeks,
    is_active: true,
    created_at: new Date(),
  }

  const { insertedId } = await collection.insertOne(doc)
  const created = await collection.findOne({ _id: insertedId })
  return toCurve(created)
}

export async function update(id, { name, weeks }) {
  const validationError = validateWeeks(weeks)
  if (validationError) {
    throw new HttpError(400, validationError)
  }

  const objectId = parseObjectId(id)
  if (!objectId) {
    throw new HttpError(404, 'Curve not found')
  }

  const collection = await getCurvesCollection()
  const updated = await collection.findOneAndUpdate(
    { _id: objectId },
    { $set: { name: name.trim(), weeks } },
    { returnDocument: 'after' }
  )

  if (!updated) {
    throw new HttpError(404, 'Curve not found')
  }

  return toCurve(updated)
}

export async function remove(id) {
  const objectId = parseObjectId(id)
  if (!objectId) return

  const collection = await getCurvesCollection()
  await collection.deleteOne({ _id: objectId })
}

export async function toggleActive(id) {
  const objectId = parseObjectId(id)
  if (!objectId) {
    throw new HttpError(404, 'Curve not found')
  }

  const collection = await getCurvesCollection()
  const current = await collection.findOne({ _id: objectId })

  if (!current) {
    throw new HttpError(404, 'Curve not found')
  }

  const updated = await collection.findOneAndUpdate(
    { _id: objectId },
    { $set: { is_active: !current.is_active } },
    { returnDocument: 'after' }
  )

  return toCurve(updated)
}

export async function ping() {
  const collection = await getCurvesCollection()
  await collection.findOne({}, { projection: { _id: 1 } })
}

export async function seedAll(curves) {
  const collection = await getCurvesCollection()

  for (const curve of curves) {
    await collection.updateOne(
      { name: curve.name },
      {
        $set: {
          weeks: curve.weeks,
          is_active: curve.is_active,
        },
        $setOnInsert: {
          name: curve.name,
          created_at: new Date(),
        },
      },
      { upsert: true }
    )
  }
}
