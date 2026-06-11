import { Router } from 'express'
import * as exportController from '../controllers/exportController.js'
import { asyncHandler } from '../helpers/asyncHandler.js'

const router = Router()

router.post('/', asyncHandler(exportController.exportPdf))

export default router
