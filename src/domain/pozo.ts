import type { Campo, CodigoPozoParseado } from './codigos'

/**
 * Estatus de una completación (arena/yacimiento) individual, tomado de la
 * columna COA. Vacío se modela como 'Indeterminado', no como cerrado.
 */
export type EstatusCoa = 'Abierto' | 'Cerrado' | 'Indeterminado'

/** Métodos de extracción observados en los datos reales (columna METODO). */
export type Metodo = 'GL' | 'BES' | 'NF' | 'BM' | 'BCP'

/**
 * Una fila del Excel = una completación (arena/yacimiento) de un pozo.
 * La llave natural es (pozo, nbYacimiento); NB_YACIMIENTO es texto libre,
 * no tiene un patrón parseable.
 */
export interface PozoCompletacion {
  id: string
  pozoId: string
  nbYacimiento: string
  coa: EstatusCoa
  metodo: Metodo | null
  cat: number | null
  /** Producción actual, en BPD. null = dato no reportado (no es lo mismo que 0). */
  bnpd: number | null
  /** Fecha de la última medición de BNPD (columna BNPD_FE). */
  bnpdFecha: Date | null
  /** Potencial, en BPD. Se usa para calcular producción diferida si está cerrada. null = no reportado. */
  pot: number | null
  /** Código de estado/condición del pozo (columna EDO), informativo. */
  edo: string | null
}

export interface Pozo {
  id: string
  campo: Campo
  /** Número entero del pozo (sin ceros a la izquierda), ej. 345. */
  numero: number
  /** Letra de reemplazo del pozo activo, o null si es el original. */
  reemplazo: CodigoPozoParseado['reemplazo']
  /** Código de despliegue, ej. "BA 0345" o "BA 345A". */
  codigo: string
  /** Coordenadas; null si la fila primaria no las traía (no se dibuja, va al panel lateral). */
  lat: number | null
  lon: number | null
  efId: string | null
  mgId: string | null
  pcId: string | null
  pbesId: string | null
  /** true si un pozo con letra de reemplazo mayor existe para el mismo (campo, número). */
  reemplazado: boolean
  activo: boolean
}

export interface PozoConCompletaciones extends Pozo {
  completaciones: PozoCompletacion[]
}

// --- Valores derivados ---

export interface DerivadosPozo {
  estatus: EstatusCoa
  /** Suma de BNPD de las completaciones abiertas. */
  bnpdActivo: number
  /** Suma de POT de completaciones cerradas: producción diferida confirmada. */
  potencialDiferidoConfirmado: number
  /** Diferido confirmado + POT de completaciones indeterminadas (COA vacío). */
  potencialDiferidoPosible: number
  /** true si alguna completación relevante para el diferido no reportó POT (subestimación). */
  diferidoIncompleto: boolean
  /** Métodos distintos entre las completaciones abiertas (o, si no hay abiertas, la de mayor prioridad). */
  metodos: Metodo[]
  categorias: number[]
}

function sumarPot(completaciones: readonly PozoCompletacion[]): { total: number; incompleto: boolean } {
  let total = 0
  let incompleto = false
  for (const c of completaciones) {
    if (c.pot === null) incompleto = true
    else total += c.pot
  }
  return { total, incompleto }
}

export function calcularDerivadosPozo(completaciones: readonly PozoCompletacion[]): DerivadosPozo {
  const abiertas = completaciones.filter((c) => c.coa === 'Abierto')
  const cerradas = completaciones.filter((c) => c.coa === 'Cerrado')
  const indeterminadas = completaciones.filter((c) => c.coa === 'Indeterminado')

  const estatus: EstatusCoa = abiertas.length > 0 ? 'Abierto' : cerradas.length > 0 ? 'Cerrado' : 'Indeterminado'

  const bnpdActivo = abiertas.reduce((acc, c) => acc + (c.bnpd ?? 0), 0)

  const confirmado = sumarPot(cerradas)
  const posibleExtra = sumarPot(indeterminadas)

  const base = abiertas.length > 0 ? abiertas : completaciones
  const metodos = [...new Set(base.map((c) => c.metodo).filter((m): m is Metodo => m !== null))]
  const categorias = [...new Set(base.map((c) => c.cat).filter((c): c is number => c !== null))]

  return {
    estatus,
    bnpdActivo,
    potencialDiferidoConfirmado: confirmado.total,
    potencialDiferidoPosible: confirmado.total + posibleExtra.total,
    diferidoIncompleto: confirmado.incompleto || posibleExtra.incompleto,
    metodos,
    categorias,
  }
}

/**
 * Un pozo sin MG asignado solo es una alerta real si alguna de sus completaciones
 * usa Levantamiento por Gas (GL); BES, BM y BCP no requieren múltiple de gas.
 */
export function debeAlertarPorFaltaDeMg(mgId: string | null, completaciones: readonly PozoCompletacion[]): boolean {
  return mgId === null && completaciones.some((c) => c.metodo === 'GL')
}
