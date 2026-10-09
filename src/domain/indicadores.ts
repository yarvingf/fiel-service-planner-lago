import type { VisitaCampo } from './visitaCampo'

/**
 * Indicadores operativos por pozo — estadísticas pre-calculadas desde las
 * visitas GL/BES en el momento de la importación y persistidas en la tabla
 * `pozo_indicadores`. Reemplazan a las fórmulas de la hoja "Pozos" del Excel:
 * en vez de recalcular sobre decenas de miles de visitas en cada filtro, se
 * guarda una fila por (visita, indicador) y el filtrado consulta la tabla
 * reducida (~miles de filas).
 *
 * Formato persistido: pozo_id | fecha | indicador | valor
 *   ej. BA-2455, 2026-10-05, 'registro_manometrico', 1
 */

export type Indicador =
  /** GL: "POZOS CON ESTUDIOS MANOMETRICOS (SI / NO)" = SI. */
  | 'registro_manometrico'
  /** GL: "AJUSTO GAS (SI / NO)" = SI. Valor = valance QG ENCONTRADO − AJUSTADO. */
  | 'ajuste_gl'
  /** BES: columna NIVEL = SI. */
  | 'niveles'
  /** GL y BES: CHEQUEO FISICO = SI (en vías de deprecation, se conserva). */
  | 'chequeo_fisico'
  /** GL y BES: el pozo se visitó de verdad — CHP o THP con valor ≠ S/I. */
  | 'visita_pozo'

export const NOMBRES_INDICADOR: Record<Indicador, string> = {
  registro_manometrico: 'Registro manométrico',
  ajuste_gl: 'Ajuste de gas (GL)',
  niveles: 'Niveles (BES)',
  chequeo_fisico: 'Chequeo físico',
  visita_pozo: 'Visita a pozo',
}

export interface IndicadorPozo {
  /** `${visitaId}|${indicador}` — determinista, idempotente entre imports. */
  id: string
  pozoId: string
  /** ISO YYYY-MM-DD (la fecha de la visita que lo originó). */
  fecha: string
  indicador: Indicador
  /** 1 para indicadores de evento; el valance numérico para ajuste_gl. */
  valor: number | null
  visitaId: string
}

/** 'Si', 'SI', 'Sí', 'si.' → verdadero. */
function esSi(v: unknown): boolean {
  if (v === null || v === undefined) return false
  const t = String(v).trim().toUpperCase().replace(/\./g, '').replace(/Í/g, 'I')
  return t === 'SI'
}

/** Valor real registrado (≠ vacío, ≠ 'S/I' sin información, ≠ 'N/A', ≠ '-'). */
function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false
  const t = String(v).trim().toUpperCase()
  return t !== '' && t !== 'S/I' && t !== 'N/A' && t !== '-'
}

function aNumero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v === null || v === undefined) return null
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Claves de `datosExtra` → mapa con nombres de columna normalizados para
 * búsqueda: los encabezados del Excel traen saltos de línea y espacios raros
 * ("AJUSTO GAS\n(SI / NO)"), así que se colapsan a un espacio.
 */
function extrasNormalizados(v: VisitaCampo): Map<string, string | number | boolean> {
  const m = new Map<string, string | number | boolean>()
  for (const [k, val] of Object.entries(v.datosExtra)) {
    m.set(k.replace(/\s+/g, ' ').trim().toUpperCase(), val)
  }
  return m
}

const ES_HOY_MS = 86_400_000

/**
 * Recorre las visitas y produce una fila por indicador que se cumple.
 * Solo visitas vinculadas a un pozo conocido generan indicadores — una
 * fila sin pozo_id no se podría filtrar contra el universo.
 */
export function calcularIndicadores(visitas: readonly VisitaCampo[]): IndicadorPozo[] {
  const out: IndicadorPozo[] = []
  const agregar = (v: VisitaCampo, indicador: Indicador, valor: number | null) => {
    out.push({
      id: `${v.id}|${indicador}`,
      pozoId: v.pozoId!,
      fecha: v.fecha.toISOString().slice(0, 10),
      indicador,
      valor,
      visitaId: v.id,
    })
  }

  for (const v of visitas) {
    if (!v.pozoId) continue
    const ex = extrasNormalizados(v)

    // Visita a pozo: CHP o THP con lectura real (ambas en S/I = no se visitó).
    const chp = v.tipo === 'GL' ? ex.get('CHP (PSIG)') : ex.get('CHP')
    const thp = v.tipo === 'GL' ? ex.get('THP (PSIG)') : ex.get('THP')
    if (tieneValor(chp) || tieneValor(thp)) agregar(v, 'visita_pozo', 1)

    // Chequeo físico: existe en ambas hojas con el mismo nombre base.
    if (esSi(ex.get(v.tipo === 'GL' ? 'CHEQUEO FISICO (SI /NO)' : 'CHEQUEO FISICO'))) {
      agregar(v, 'chequeo_fisico', 1)
    }

    if (v.tipo === 'GL') {
      if (esSi(ex.get('POZOS CON ESTUDIOS MANOMETRICOS (SI / NO)'))) {
        agregar(v, 'registro_manometrico', 1)
      }
      if (esSi(ex.get('AJUSTO GAS (SI / NO)'))) {
        const encontrado = aNumero(ex.get('QG INY ENCONTRADO'))
        const ajustado = aNumero(ex.get('QG INY AJUSTADO'))
        // Valance: gas encontrado − gas ajustado (positivo = excedente
        // inyectado sobre el ajuste, negativo = déficit).
        agregar(v, 'ajuste_gl', encontrado !== null && ajustado !== null ? encontrado - ajustado : null)
      }
    } else {
      // BES: columna NIVEL (medición de nivel de fluido acústico).
      if (esSi(ex.get('NIVEL'))) agregar(v, 'niveles', 1)
    }
  }
  return out
}

// --- Filtrado ---

/** Periodo sobre el que se evalúa "el pozo tiene el indicador". */
export type PeriodoIndicador = 'todos' | 'mes' | 'ultimos30' | 'ultimos3m' | 'anio' | 'desde'

export const NOMBRES_PERIODO: Record<PeriodoIndicador, string> = {
  todos: 'Cualquier fecha',
  mes: 'Este mes',
  ultimos30: 'Últimos 30 días',
  ultimos3m: 'Últimos 3 meses',
  anio: 'Este año',
  desde: 'Desde fecha…',
}

/** Opciones del filtro por indicadores: `desde` solo aplica con periodo 'desde'. */
export interface OpcionesIndicador {
  /** YYYY-MM-DD — límite inferior manual (la cota superior siempre es hoy). */
  desde?: string | null
  hoy?: Date
}

function desdeDelPeriodo(periodo: PeriodoIndicador, hoy: Date, desde: string | null | undefined): number {
  switch (periodo) {
    case 'mes':
      return new Date(hoy.getFullYear(), hoy.getMonth(), 1).getTime()
    case 'ultimos30':
      return hoy.getTime() - 30 * ES_HOY_MS
    case 'ultimos3m':
      return new Date(hoy.getFullYear(), hoy.getMonth() - 3, hoy.getDate()).getTime()
    case 'anio':
      return new Date(hoy.getFullYear(), 0, 1).getTime()
    case 'desde':
      // Sin fecha elegida → sin cota (equivale a 'todos').
      return desde ? new Date(`${desde}T00:00:00`).getTime() : -Infinity
    default:
      return -Infinity
  }
}

/**
 * Set de pozo_ids que tienen ALGUNO de los indicadores elegidos dentro del
 * periodo. null = sin filtro de indicadores (no se eligió ninguno).
 * Comparte el patrón de `idsAsignadosHoy`: un Set JS que se traduce a una
 * lista literal 'in' en la expresión del mapa.
 */
export function pozosConIndicador(
  indicadores: readonly IndicadorPozo[],
  tipos: readonly Indicador[],
  periodo: PeriodoIndicador,
  opciones: OpcionesIndicador = {},
): Set<string> | null {
  if (tipos.length === 0) return null
  const desde = desdeDelPeriodo(periodo, opciones.hoy ?? new Date(), opciones.desde)
  const elegidos = new Set<string>(tipos)
  const out = new Set<string>()
  for (const i of indicadores) {
    if (!elegidos.has(i.indicador)) continue
    if (new Date(`${i.fecha}T00:00:00Z`).getTime() < desde) continue
    out.add(i.pozoId)
  }
  return out
}

// --- Defaults del checklist de asignación ---

/** Días hacia atrás que cuentan como "reciente" para el checklist (manómetro/nivel). */
export const DIAS_INDICADOR_RECIENTE = 30

export interface DefaultsChecklist {
  validarAjuste: boolean
  requiereManometro: boolean
  requiereNivel: boolean
}

/**
 * Checklist por defecto al asignar un pozo, derivado de sus indicadores
 * recientes (≤30 días):
 * - requiereManometro: Sí solo si NO tiene registro manométrico reciente.
 * - requiereNivel: Sí solo si NO tiene nivel medido reciente.
 * - validarAjuste: siempre No por defecto (se marca a mano).
 */
export function defaultsChecklistAsignacion(
  indicadores: readonly IndicadorPozo[],
  pozoId: string,
  hoy = new Date(),
): DefaultsChecklist {
  const desde = hoy.getTime() - DIAS_INDICADOR_RECIENTE * ES_HOY_MS
  const reciente = (ind: Indicador) =>
    indicadores.some(
      (i) =>
        i.pozoId === pozoId &&
        i.indicador === ind &&
        new Date(`${i.fecha}T00:00:00Z`).getTime() >= desde,
    )
  return {
    validarAjuste: false,
    requiereManometro: !reciente('registro_manometrico'),
    requiereNivel: !reciente('niveles'),
  }
}
