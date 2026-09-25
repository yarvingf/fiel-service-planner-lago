/**
 * Parseo y normalización de códigos de pozos, EF y MG.
 *
 * Reglas validadas contra el archivo real de referencia (1398 pozos, 3 campos):
 * - Pozo BA:        "BA" + espacio + 3-4 dígitos + letra de reemplazo opcional (A-D)
 * - Pozo VLC/VLG:   prefijo + 3-4 dígitos + letra de reemplazo opcional (A-D), sin espacio
 * - La letra final indica REEMPLAZO, no arena: sin letra = original, A = 1er reemplazo,
 *   B = 2do, C = 3ro, D = 4to. Solo el de letra más alta (o sin letra, si no hay ninguna)
 *   está activo; los anteriores son historia (pozo muerto).
 * - Las arenas están en NB_YACIMIENTO (texto libre, sin patrón), una fila por arena.
 */

export type Campo = 'BA' | 'VLC' | 'VLG'

const CAMPOS_VALIDOS: readonly Campo[] = ['BA', 'VLC', 'VLG']

export function esCampoValido(valor: string): valor is Campo {
  return (CAMPOS_VALIDOS as readonly string[]).includes(valor)
}

export interface CodigoPozoParseado {
  /** Campo administrativo del pozo, tal como viene en la columna CAMPO. */
  campo: Campo
  /** Número interpretado como entero, ignorando ceros a la izquierda. */
  numero: number
  /** Letra de reemplazo, o null si es el pozo original (sin reemplazo). */
  reemplazo: 'A' | 'B' | 'C' | 'D' | null
  /** Código tal como venía en el archivo, sin modificar. */
  codigoOriginal: string
}

const PATRON_BA = /^BA[ ]?(\d{3,4})([A-D])?$/
const PATRON_VL = /^(VLC|VLG)(\d{3,4})([A-D])?$/

/**
 * Parsea un código de pozo. Devuelve null si no calza con ningún patrón conocido,
 * en cuyo caso debe reportarse como alerta de import en vez de descartarse en silencio.
 */
export function parsearCodigoPozo(codigoCrudo: string, campoEsperado: Campo): CodigoPozoParseado | null {
  const codigo = codigoCrudo.trim()

  if (campoEsperado === 'BA') {
    const m = PATRON_BA.exec(codigo)
    if (!m) return null
    return {
      campo: 'BA',
      numero: parseInt(m[1], 10),
      reemplazo: (m[2] as CodigoPozoParseado['reemplazo']) ?? null,
      codigoOriginal: codigoCrudo,
    }
  }

  const m = PATRON_VL.exec(codigo)
  if (!m || m[1] !== campoEsperado) return null
  return {
    campo: campoEsperado,
    numero: parseInt(m[2], 10),
    reemplazo: (m[3] as CodigoPozoParseado['reemplazo']) ?? null,
    codigoOriginal: codigoCrudo,
  }
}

/** Llave de agrupación de reemplazos: mismo campo + mismo número = mismo pozo físico. */
export function clavePozoFisico(p: Pick<CodigoPozoParseado, 'campo' | 'numero'>): string {
  return `${p.campo}|${p.numero}`
}

const ORDEN_REEMPLAZO: Record<string, number> = { '': 0, A: 1, B: 2, C: 3, D: 4 }

/** Compara dos pozos del mismo grupo por letra de reemplazo. Mayor = más reciente/activo. */
export function compararReemplazo(a: CodigoPozoParseado['reemplazo'], b: CodigoPozoParseado['reemplazo']): number {
  return ORDEN_REEMPLAZO[a ?? ''] - ORDEN_REEMPLAZO[b ?? '']
}

/**
 * Dado un grupo de filas del mismo pozo físico (mismo campo+número), determina cuál
 * está activo: el de letra de reemplazo más alta. Los demás quedan como reemplazados.
 */
export function elegirActivo<T extends { reemplazo: CodigoPozoParseado['reemplazo'] }>(filas: readonly T[]): T {
  return filas.reduce((mejor, actual) => (compararReemplazo(actual.reemplazo, mejor.reemplazo) > 0 ? actual : mejor))
}

// --- Normalización y cruce de códigos EF / MG contra el catálogo de Instalaciones ---
//
// Validado contra los datos reales (archivo corregido por el usuario):
//   EF: Pozos.EF = "BA-17"   <->  Instalaciones = "EF-BA-17"  (prefijo EF- solo del lado catálogo)
//   MG: Pozos.MG = "BA 1-02" <->  Instalaciones = "BA 1-02"   (coinciden directo tras limpieza)
//   Formatos VLC/VLG/VLD ("VLC-27-3") y LGT ("LGT-3/7") coinciden directo en ambas hojas.
// La normalización ignora mayúsculas, espacios y guiones sueltos del catálogo
// ("BA -1-36", "BA 1111", "EF-BA- 8" son variantes reales observadas).

function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/[\s-]+/g, '')
}

/** Valores conocidos que significan "sin EF/MG asignado", no un código real. */
const VALORES_NULOS_CONOCIDOS = new Set(['NOLINEA'])

export function esValorNulo(valor: string | null | undefined): boolean {
  if (!valor) return true
  return VALORES_NULOS_CONOCIDOS.has(valor.trim().toUpperCase())
}

/** Clave normalizada para cruzar un código de EF de la hoja Pozos contra Instalaciones. */
export function claveNormalizadaEF(ef: string): string {
  const s = ef.trim()
  if (/^VL[CGD]-/i.test(s)) return normalizarCodigo(s)
  return normalizarCodigo(`EF-${s}`)
}

/** Clave normalizada para cruzar un código de MG de la hoja Pozos contra Instalaciones. */
export function claveNormalizadaMG(mg: string): string {
  return normalizarCodigo(mg)
}

/** Clave normalizada de un código tal como aparece en la hoja Instalaciones. */
export function claveNormalizadaInstalacion(codigo: string): string {
  return normalizarCodigo(codigo)
}
