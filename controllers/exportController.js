import { buildPdf } from '../services/exportService.js'
import { HttpError } from '../helpers/httpError.js'

export async function exportPdf(req, res) {
  try {
    const { result, formData, chartImages } = req.body
    const { doc, filename } = buildPdf({ result, formData, chartImages })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    doc.pipe(res)
    doc.end()
    console.log('PDF generated and sent via PDFKit')
  } catch (err) {
    console.error('PDF generation error:', err.message)
    if (!res.headersSent) {
      if (err instanceof HttpError) {
        res.status(err.statusCode).json({ error: err.message })
      } else {
        res.status(500).json({ error: 'PDF generation failed', detail: err.message })
      }
    }
  }
}
