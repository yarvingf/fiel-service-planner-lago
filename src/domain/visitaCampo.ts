import type { Campo } from './codigos'

/**
 * Visitas de campo: bitácora de las hojas "GL" y "BES" del Excel — una fila
 * por visita/inspección a un pozo en una fecha, con decenas de lecturas
 * específicas del método (presiones, caudal de gas, lecturas eléctricas del
 * VSD, etc.). Estructuralmente distinto de la hoja "Pozos" (que es una foto
 * del estado actual): esto es historial operativo, se acumula, no se
 * reemplaza.
 */
export type TipoVisita = 'GL' | 'BES'

export interface VisitaCampo {
  /** Id determinista = claveVisita(); estable entre re-importaciones. */
  id: string
  tipo: TipoVisita
  fecha: Date
  /** Código del pozo tal como viene en la hoja (puede no calzar con ningún pozo conocido). */
  pozoTexto: string
  /** Pozo resuelto contra el universo importado, o null si no hubo match. */
  pozoId: string | null
  cuadrilla: string
  /** Inferido del prefijo del código de pozo (no de la columna CAMPO de la hoja, que usa otra convención). */
  campo: Campo | null
  tipoActividad: string | null
  estadoInicial: string | null
  estadoFinal: string | null
  comentarios: string | null
  horaInicio: string | null
  horaFin: string | null
  /** Resto de columnas de la hoja (decenas de lecturas propias de GL o de BES), tal cual venían. */
  datosExtra: Record<string, string | number | boolean>
}

function fechaIso(f: Date): string {
  return f.toISOString().slice(0, 10)
}

/** Llave de negocio de una visita: tipo + fecha + pozo + cuadrilla (fija por decisión operativa). */
export function claveVisita(v: Pick<VisitaCampo, 'tipo' | 'fecha' | 'pozoTexto' | 'cuadrilla'>): string {
  return `${v.tipo}|${fechaIso(v.fecha)}|${v.pozoTexto.trim().toUpperCase()}|${v.cuadrilla.trim().toUpperCase()}`
}

/** Última visita (por fecha) de cada pozo resuelto, sin importar si fue GL o BES. */
export function ultimaVisitaPorPozo(visitas: readonly VisitaCampo[]): Map<string, VisitaCampo> {
  const ultimo = new Map<string, VisitaCampo>()
  for (const v of visitas) {
    if (!v.pozoId) continue
    const actual = ultimo.get(v.pozoId)
    if (!actual || v.fecha.getTime() > actual.fecha.getTime()) ultimo.set(v.pozoId, v)
  }
  return ultimo
}

/**
 * Días desde la última visita GL/BES de cada pozo (respecto a `hoy`). Los
 * pozos sin NINGUNA visita no aparecen en el mapa — los callers los tratan
 * como "nunca visitado", más viejo que cualquier umbral configurable.
 */
export function diasSinVisitaPorPozo(visitas: readonly VisitaCampo[], hoy = new Date()): Map<string, number> {
  const out = new Map<string, number>()
  for (const [pozoId, v] of ultimaVisitaPorPozo(visitas)) {
    out.set(pozoId, Math.max(0, Math.floor((hoy.getTime() - v.fecha.getTime()) / 86_400_000)))
  }
  return out
}
