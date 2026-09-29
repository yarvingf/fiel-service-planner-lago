// Solo tipos aquí: el runtime se importa dinámicamente en exportarPlanExcel()
// para no arrastrar ExcelJS al bundle inicial.
import type ExcelJS from 'exceljs'
import type { Cuadrilla } from '@/domain/cuadrilla'
import type { Campo } from '@/domain/codigos'
import { etiquetaCampo, type DetalleObjetivo } from '@/domain/detalleAsignacion'
import { formatearFecha } from '@/domain/fecha'
import type { AsignacionRec } from '@/state/asignacionesStore'

/** Colores ARGB del reporte (navy del HUD + verde/rojo del checklist SI/NO). */
const NAVY = 'FF1E3A6E'
const BLANCO = 'FFFFFFFF'
const VERDE_SI = 'FF00B050'
const ROJO_NO = 'FFC00000'

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFB0B7C3' } },
  bottom: { style: 'thin', color: { argb: 'FFB0B7C3' } },
  left: { style: 'thin', color: { argb: 'FFB0B7C3' } },
  right: { style: 'thin', color: { argb: 'FFB0B7C3' } },
}

/** Encabezados de la tabla de pozos (fila FILA_ENCABEZADOS de cada hoja). */
const ENCABEZADOS = [
  'POZO', 'METODO', 'EF', 'MG', 'POT', 'BNPD', 'ACTIVIDAD', 'PRIORIDAD',
  'VALIDAR AJUSTE', 'REQUIERE MANÓMETRO', 'REQUIERE NIVEL', 'NOTA',
] as const
const N_COLUMNAS = ENCABEZADOS.length
/** Filas: 1 título, 2 datos del plan, 3 espacio, 4 encabezados de columna. */
const FILA_ENCABEZADOS = 4

/** Nombre de hoja válido para Excel: máx. 31 chars, sin \ / ? * [ ] :, sin repetir. */
function nombreHojaSeguro(base: string, usados: Set<string>): string {
  const limpio = base.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Cuadrilla'
  let nombre = limpio.slice(0, 31)
  for (let i = 2; usados.has(nombre.toLowerCase()); i++) {
    const sufijo = ` (${i})`
    nombre = limpio.slice(0, 31 - sufijo.length) + sufijo
  }
  usados.add(nombre.toLowerCase())
  return nombre
}

function estiloEtiqueta(cell: ExcelJS.Cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  cell.font = { bold: true, color: { argb: BLANCO }, size: 10 }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  cell.border = BORDE
}

/** Celda SI/NO del checklist: verde para SI, rojo para NO (impresión). */
function celdaSiNo(cell: ExcelJS.Cell, valor: boolean) {
  cell.value = valor ? 'SI' : 'NO'
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: valor ? VERDE_SI : ROJO_NO } }
  cell.font = { bold: true, color: { argb: BLANCO } }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
  cell.border = BORDE
}

function hojaDeCuadrilla(
  wb: ExcelJS.Workbook,
  nombreHoja: string,
  fecha: string,
  nombreCuadrilla: string,
  items: AsignacionRec[],
  detalleDe: ReadonlyMap<string, DetalleObjetivo>,
) {
  const ws = wb.addWorksheet(nombreHoja)
  ws.columns = [
    { width: 13 }, // POZO
    { width: 10 }, // METODO
    { width: 11 }, // EF
    { width: 11 }, // MG
    { width: 8 },  // POT
    { width: 8 },  // BNPD
    { width: 32 }, // ACTIVIDAD
    { width: 11 }, // PRIORIDAD
    { width: 15 }, // VALIDAR AJUSTE
    { width: 21 }, // REQUIERE MANÓMETRO
    { width: 15 }, // REQUIERE NIVEL
    { width: 42 }, // NOTA
  ]

  // Banda de título (fila 1)
  const ultimaCol = String.fromCharCode(64 + N_COLUMNAS) // 'L' con 12 columnas
  ws.mergeCells(`A1:${ultimaCol}1`)
  const titulo = ws.getCell('A1')
  titulo.value = `PLAN DE ASIGNACIONES — ${formatearFecha(fecha)}`
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  titulo.font = { bold: true, color: { argb: BLANCO }, size: 12 }
  titulo.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 20

  // Datos del plan (fila 2): CAMPO | CUADRILLA | FECHA | TOTAL ASIGNACIONES
  const campos = new Set<Campo>()
  for (const a of items) {
    const campo = detalleDe.get(a.objetivoId)?.campo
    if (campo) campos.add(campo)
  }
  ws.mergeCells('B2:C2')
  ws.mergeCells('E2:G2')
  ws.getCell('A2').value = 'CAMPO'
  ws.getCell('B2').value = etiquetaCampo(campos)
  ws.getCell('D2').value = 'CUADRILLA'
  ws.getCell('E2').value = nombreCuadrilla
  ws.getCell('H2').value = 'FECHA'
  ws.getCell('I2').value = formatearFecha(fecha)
  ws.getCell('J2').value = 'TOTAL'
  ws.getCell('K2').value = items.length
  for (const ref of ['A2', 'D2', 'H2', 'J2']) estiloEtiqueta(ws.getCell(ref))
  for (const ref of ['B2', 'E2', 'I2', 'K2']) {
    const c = ws.getCell(ref)
    c.font = { bold: true }
    c.alignment = { vertical: 'middle' }
    c.border = BORDE
  }

  // Encabezados de columna (fila 4)
  const filaEnc = ws.getRow(FILA_ENCABEZADOS)
  ENCABEZADOS.forEach((h, i) => {
    const c = filaEnc.getCell(i + 1)
    c.value = h
    estiloEtiqueta(c)
  })

  // Datos: una fila por pozo asignado, ordenados por código.
  for (const a of items) {
    const d = detalleDe.get(a.objetivoId)
    const fila = ws.addRow([
      a.codigo,
      d?.metodos.join(' ') ?? '',
      d?.ef ?? '',
      d?.mg ?? '',
      d?.pot ?? null,
      d?.bnpd ?? null,
      a.actividad ?? '',
      a.prioridad ?? null,
      null, // VALIDAR AJUSTE — se pinta aparte
      null, // REQUIERE MANÓMETRO
      null, // REQUIERE NIVEL
      a.nota ?? '',
    ])
    fila.eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDE
      c.alignment = { vertical: 'top' }
    })
    fila.getCell(1).font = { bold: true }
    fila.getCell(2).alignment = { horizontal: 'center', vertical: 'top' }
    fila.getCell(5).alignment = { horizontal: 'right', vertical: 'top' }
    fila.getCell(6).alignment = { horizontal: 'right', vertical: 'top' }
    fila.getCell(7).alignment = { vertical: 'top', wrapText: true }
    fila.getCell(8).alignment = { horizontal: 'right', vertical: 'top' }
    celdaSiNo(fila.getCell(9), a.validarAjuste)
    celdaSiNo(fila.getCell(10), a.requiereManometro)
    celdaSiNo(fila.getCell(11), a.requiereNivel)
    fila.getCell(12).alignment = { vertical: 'top', wrapText: true }
  }

  // Encabezados fijos al scrollear + autofiltro + página horizontal para imprimir.
  ws.views = [{ state: 'frozen', ySplit: FILA_ENCABEZADOS }]
  ws.autoFilter = { from: `A${FILA_ENCABEZADOS}`, to: `${ultimaCol}${FILA_ENCABEZADOS}` }
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  }
}

/**
 * Orden fijo de las filas dentro de cada hoja (jerarquía operativa):
 * PRIORIDAD asc (1 primero, sin dato al final) → METODO asc → ACTIVIDAD asc
 * → MG asc → BNPD desc (mayor producción primero, sin dato al final).
 */
export function compararPlan(a: AsignacionRec, b: AsignacionRec, detalleDe: ReadonlyMap<string, DetalleObjetivo>): number {
  const da = detalleDe.get(a.objetivoId)
  const db = detalleDe.get(b.objetivoId)
  // Numéricos: null siempre al final, sin importar el sentido del orden.
  const num = (x: number | null | undefined, y: number | null | undefined, dir: 1 | -1) =>
    x == null ? (y == null ? 0 : 1) : y == null ? -1 : (x - y) * dir
  const txt = (x: string, y: string) => x.localeCompare(y)
  return (
    num(a.prioridad, b.prioridad, 1) ||
    txt(da?.metodos.join(' ') ?? '', db?.metodos.join(' ') ?? '') ||
    txt(a.actividad ?? '', b.actividad ?? '') ||
    txt(da?.mg ?? '', db?.mg ?? '') ||
    num(da?.bnpd, db?.bnpd, -1) ||
    txt(a.codigo, b.codigo)
  )
}

/**
 * Genera el plan del día como Excel: una hoja por cuadrilla con sus pozos
 * (las instalaciones asignadas no entran al reporte), con el checklist
 * SI/NO coloreado para impresión. Devuelve false si no había nada que
 * exportar (sin pozos asignados ese día) y no descarga ningún archivo.
 */
export async function exportarPlanExcel(
  fecha: string,
  cuadrillas: readonly Cuadrilla[],
  asignaciones: readonly AsignacionRec[],
  detalleDe: ReadonlyMap<string, DetalleObjetivo>,
): Promise<boolean> {
  const delDia = asignaciones.filter(
    (a) => a.fecha === fecha && a.objetivoId.startsWith('pozo|'),
  )
  if (delDia.length === 0) return false

  const { default: ExcelJSRuntime } = await import('exceljs')
  const wb = new ExcelJSRuntime.Workbook()
  const nombresUsados = new Set<string>()
  const ordenar = (items: AsignacionRec[]) => items.sort((x, y) => compararPlan(x, y, detalleDe))

  for (const c of cuadrillas) {
    const items = ordenar(delDia.filter((a) => a.cuadrillaId === c.id))
    if (items.length === 0) continue
    hojaDeCuadrilla(wb, nombreHojaSeguro(c.nombre, nombresUsados), fecha, c.nombre, items, detalleDe)
  }
  // Asignaciones huérfanas (cuadrilla borrada o no cargada): van a su propia hoja.
  const huerfanos = ordenar(
    delDia.filter((a) => !cuadrillas.some((c) => c.id === a.cuadrillaId)),
  )
  if (huerfanos.length > 0)
    hojaDeCuadrilla(wb, nombreHojaSeguro('Sin cuadrilla', nombresUsados), fecha, 'Sin cuadrilla', huerfanos, detalleDe)

  if (wb.worksheets.length === 0) return false

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Plan_${formatearFecha(fecha).replace(/\//g, '-')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  return true
}
