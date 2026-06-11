import './env.js'
import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI || process.env.MONGDB_URI

if (!uri) {
  throw new Error('MONGODB_URI is not set')
}

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri)
  global._mongoClientPromise = client.connect()
}

const clientPromise = global._mongoClientPromise

let indexesReady = false

export async function connectDatabase() {
  try {
    const client = await clientPromise
    const db = client.db()
    await db.command({ ping: 1 })
    console.log(`MongoDB connected successfully (database: ${db.databaseName})`)
    return true
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}`)
    return false
  }
}

export async function getDb() {
  const client = await clientPromise
  return client.db()
}

export async function getCurvesCollection() {
  const db = await getDb()
  const collection = db.collection('curves')

  if (!indexesReady) {
    await collection.createIndex({ name: 1 }, { unique: true })
    await collection.createIndex({ created_at: 1 })
    indexesReady = true
  }

  return collection
}
