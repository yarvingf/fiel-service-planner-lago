import type { Campo } from './codigos'
import type { Instalacion } from './instalacion'
import type { EstatusCoa, Metodo, PozoConCompletaciones } from './pozo'
import { calcularDerivadosPozo } from './pozo'

/**
 * Detalle de un objetivo de asignación resuelto contra los datos importados:
 * el modal del plan y el exportador de Excel lo comparten para no duplicar
 * la derivación de EF/MG/POT/BNPD.
 */
export interface DetalleObjetivo {
  tipo: 'pozo' | 'instalacion'
  /** Código de la instalación EF asociada al pozo ('' si no aplica). */
  ef: string
  /** Código de la instalación MG asociada al pozo ('' si no aplica). */
  mg: string
  /** Potencial diferido confirmado (POT de completaciones cerradas). */
  pot: number | null
  /** Producción activa (suma de BNPD de completaciones abiertas). */
  bnpd: number | null
  /** Campo del pozo (null en instalaciones). */
  campo: Campo | null
  /** Estatus derivado del pozo (null en instalaciones). */
  estatus: EstatusCoa | null
  /** Métodos de extracción derivados (vacío en instalaciones o sin dato). */
  metodos: Metodo[]
}

const DETALLE_INSTALACION: DetalleObjetivo = {
  tipo: 'instalacion',
  ef: '',
  mg: '',
  pot: null,
  bnpd: null,
  campo: null,
  estatus: null,
  metodos: [],
}

/** Mapa objetivoId ("pozo|id" / "inst|id") → detalle operativo del objetivo. */
export function construirDetalleObjetivos(
  pozos: readonly PozoConCompletaciones[],
  instalaciones: readonly Instalacion[],
): Map<string, DetalleObjetivo> {
  const codigoInst = new Map(instalaciones.map((i) => [i.id, i.codigo]))
  const m = new Map<string, DetalleObjetivo>()
  for (const p of pozos) {
    const d = calcularDerivadosPozo(p.completaciones)
    m.set(`pozo|${p.id}`, {
      tipo: 'pozo',
      ef: p.efId ? (codigoInst.get(p.efId) ?? '') : '',
      mg: p.mgId ? (codigoInst.get(p.mgId) ?? '') : '',
      pot: d.potencialDiferidoConfirmado,
      bnpd: d.bnpdActivo,
      campo: p.campo,
      estatus: d.estatus,
      metodos: d.metodos,
    })
  }
  for (const i of instalaciones) m.set(`inst|${i.id}`, DETALLE_INSTALACION)
  return m
}

/**
 * Etiqueta de campo para la hoja de una cuadrilla, según los campos de sus
 * pozos. Convención del negocio: VLC/VLG (solo o mezclados entre sí) son la
 * operación Ceuta-Treco; BA solo es Bachaquero Lago; BA mezclado con
 * cualquier campo Ceuta produce la etiqueta combinada.
 */
export function etiquetaCampo(campos: ReadonlySet<Campo>): string {
  if (campos.size === 0) return ''
  const tieneBA = campos.has('BA')
  const tieneCeuta = campos.has('VLC') || campos.has('VLG')
  if (tieneBA && tieneCeuta) return 'Ceuta-Treco & Bachaquero Lago'
  if (tieneBA) return 'Bachaquero Lago'
  return 'Ceuta-Treco'
}
