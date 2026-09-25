/**
 * Formato de fecha de la app: DD/MM/YYYY para todo lo que se muestra al
 * usuario (la capa de datos sigue usando ISO YYYY-MM-DD internamente).
 */
export function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

/** Formato para el encabezado del mensaje de WhatsApp: 24-sept-2026. */
export function formatearFechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const mes = MESES_CORTOS[parseInt(m, 10) - 1]
  return `${parseInt(d, 10)}-${mes ?? m}-${y}`
}
