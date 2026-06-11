import { Router } from 'express'
import * as calculateController from '../controllers/calculateController.js'
import { asyncHandler } from '../helpers/asyncHandler.js'

const router = Router()

router.post('/', asyncHandler(calculateController.calculate))

export default router
