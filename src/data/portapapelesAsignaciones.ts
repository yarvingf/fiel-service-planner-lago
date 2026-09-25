import type { CamposAsignacion } from './persistencia'

/** Columnas SI/NO del checklist operativo. */
export type CampoChecklist = 'validarAjuste' | 'requiereManometro' | 'requiereNivel'

/**
 * Parseo de un valor crudo del portapapeles → campo de asignación.
 * Devuelve null cuando el texto no es interpretable para esa columna (la
 * celda se salta al pegar, igual que una columna inválida en Excel).
 */
export type ParseoPegado = (
  crudo: string,
) => { campo: keyof CamposAsignacion; valor: string | number | boolean | null } | null

const textoONulo = (campo: 'actividad' | 'nota'): ParseoPegado => (crudo) => {
  const t = crudo.trim()
  return { campo, valor: t === '' ? null : t }
}
const numeroONulo = (campo: 'prioridad'): ParseoPegado => (crudo) => {
  const t = crudo.trim()
  if (t === '') return { campo, valor: null }
  const n = Number(t)
  return Number.isFinite(n) ? { campo, valor: Math.trunc(n) } : null
}
const siNo = (campo: CampoChecklist): ParseoPegado => (crudo) => {
  const t = crudo.trim().toLowerCase()
  if (t === '') return { campo, valor: false }
  if (['si', 'sí', 's', '1', 'true', 'x', 'yes'].includes(t)) return { campo, valor: true }
  if (['no', 'n', '0', 'false'].includes(t)) return { campo, valor: false }
  return null
}

/** Columnas que aceptan pegar desde el portapapeles (colId → parseo). */
export const PARSEO_PEGADO: Record<string, ParseoPegado> = {
  actividad: textoONulo('actividad'),
  prioridad: numeroONulo('prioridad'),
  nota: textoONulo('nota'),
  validarAjuste: siNo('validarAjuste'),
  requiereManometro: siNo('requiereManometro'),
  requiereNivel: siNo('requiereNivel'),
}

/** Al copiar, los toggles salen como SI/NO (y así se pueden volver a pegar). */
export const COPIA_PEGADO: Record<string, (v: unknown) => string> = {
  validarAjuste: (v) => (v ? 'SI' : 'NO'),
  requiereManometro: (v) => (v ? 'SI' : 'NO'),
  requiereNivel: (v) => (v ? 'SI' : 'NO'),
}
