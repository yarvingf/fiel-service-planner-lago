import Papa from 'papaparse'
import { importarPozos, type ValorCelda } from './importadorExcel'
import type { Instalacion } from '@/domain/instalacion'
import type { PozoConCompletaciones } from '@/domain/pozo'
import type { AlertaImport } from '@/domain/alertasImport'

/**
 * Importa un CSV de la hoja Pozos (p. ej. "Guardar como CSV" desde Excel, que
 * exporta solo la hoja activa). Detecta la fila de encabezados buscando la que
 * contiene "POZO" — puede ser la 1 o la 2 según cómo se exportó.
 * Las instalaciones ya cargadas se conservan y se usan para el cruce EF/MG.
 */
export function importarCsvPozos(
  textoCsv: string,
  instalaciones: Instalacion[],
): { pozos: PozoConCompletaciones[]; alertas: AlertaImport[] } {
  const { data, errors } = Papa.parse<string[]>(textoCsv, { skipEmptyLines: true })
  if (errors.length > 0 && data.length === 0) {
    throw new Error(`CSV inválido: ${errors[0].message}`)
  }

  const idxHeader = data.findIndex((fila) =>
    fila.some((celda) => celda.trim().toUpperCase() === 'POZO'),
  )
  if (idxHeader < 0) {
    throw new Error('El CSV no contiene una fila de encabezados con "POZO"')
  }

  const encabezados = data[idxHeader].map((h) => h.trim().toUpperCase())
  const filas: Record<string, ValorCelda>[] = []
  const numerosFila: number[] = []
  for (let i = idxHeader + 1; i < data.length; i++) {
    const dict: Record<string, ValorCelda> = {}
    for (let c = 0; c < encabezados.length; c++) {
      const v = data[i][c]?.trim() ?? ''
      dict[encabezados[c]] = v === '' ? null : v
    }
    if (Object.values(dict).some((v) => v !== null)) {
      filas.push(dict)
      numerosFila.push(i + 1)
    }
  }
  return importarPozos(filas, numerosFila, instalaciones)
}
