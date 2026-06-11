import { Router } from 'express'
import * as adminController from '../controllers/adminController.js'
import { asyncHandler } from '../helpers/asyncHandler.js'


const router = Router()

router.post('/login', asyncHandler(adminController.login))

export default router;
