export interface Cuadrilla {
  id: string
  nombre: string
  color: string
  activa: boolean
}

/**
 * Objetivo de una asignación: un pozo o una instalación, nunca ambos ni ninguno.
 * Se modela como unión discriminada aquí; en la base, dos columnas anulables
 * con un CHECK que exige exactamente una presente.
 */
export type ObjetivoAsignacion = { tipo: 'pozo'; pozoId: string } | { tipo: 'instalacion'; instalacionId: string }

export interface Asignacion {
  id: string
  fecha: string // YYYY-MM-DD; el plan es por día
  cuadrillaId: string
  objetivo: ObjetivoAsignacion
  asignadoPor: string
  creadoEn: string
}
