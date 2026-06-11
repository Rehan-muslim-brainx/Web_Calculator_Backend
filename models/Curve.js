import { ObjectId } from 'mongodb'

export function toCurve(doc) {
  if (!doc) return null
  return {
    id: doc._id.toString(),
    name: doc.name,
    weeks: doc.weeks,
    is_active: doc.is_active,
    created_at: doc.created_at,
  }
}

export function toCurves(docs) {
  return docs.map(toCurve)
}

export function parseObjectId(id) {
  if (!id || !ObjectId.isValid(id)) return null
  return new ObjectId(id)
}
