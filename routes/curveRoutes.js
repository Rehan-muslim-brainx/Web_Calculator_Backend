import { Router } from 'express'
import multer from 'multer'
import * as curveController from '../controllers/curveController.js'
import { asyncHandler } from '../helpers/asyncHandler.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

router.get('/', asyncHandler(curveController.getCurves))
router.get('/:id', asyncHandler(curveController.getCurveById))
router.post('/', asyncHandler(curveController.createCurve))
router.put('/:id', asyncHandler(curveController.updateCurve))
router.delete('/:id', asyncHandler(curveController.deleteCurve))
router.patch('/:id/toggle', asyncHandler(curveController.toggleCurve))
router.post('/upload-csv', upload.single('file'), asyncHandler(curveController.uploadCurveCsv))

export default router
