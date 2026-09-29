import type { AlertaImport } from '@/domain/alertasImport'

/** Genera el reporte de alertas del import como .xlsx y dispara la descarga. */
export async function exportarAlertasExcel(alertas: readonly AlertaImport[]): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Alertas')
  ws.columns = [
    { header: 'HOJA', key: 'hoja', width: 14 },
    { header: 'FILA', key: 'fila', width: 8 },
    { header: 'TIPO', key: 'tipo', width: 38 },
    { header: 'POZO / CÓDIGO', key: 'pozo', width: 18 },
    { header: 'MENSAJE', key: 'mensaje', width: 90 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const a of alertas) {
    ws.addRow({ hoja: a.hoja, fila: a.fila, tipo: a.tipo, pozo: a.pozo ?? '', mensaje: a.mensaje })
  }
  ws.autoFilter = { from: 'A1', to: 'E1' }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `alertas-import-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
