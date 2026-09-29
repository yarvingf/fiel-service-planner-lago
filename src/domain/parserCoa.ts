/**
 * Parser de mensajes COA (estatus de pozos pegados, formato WhatsApp).
 * Port del módulo independiente "PozosA-C COA" a TypeScript — mismas reglas.
 *
 * Reglas:
 * - Solo cuentan líneas que EMPIEZAN con 🟢 (Abierto) o 🔴 (Cerrado).
 * - VLC/VLG + 4 dígitos + letra opcional (solo A o B) → "VLG3301A".
 * - BA + número (pegado, separado o con guion): el número termina en el
 *   primer espacio o guion ("BA 793 - 300" → solo "793"). Una letra final
 *   solo cuenta pegada al número. Se rellena con ceros a la izquierda
 *   hasta 4 caracteres (la letra cuenta) → "BA 0011", "BA 011A".
 * - Si el número ya tiene 4+ dígitos la letra nunca se recorta.
 */

export type EstatusMensaje = 'Abierto' | 'Cerrado'

export interface PozoCoaDetectado {
  /** Código normalizado tal como lo emite el parser ("BA 0011", "VLG3301A"). */
  codigo: string
  estatus: EstatusMensaje
}

const VERDE = '🟢'
const ROJO = '🔴'

const RE_VL = /\b(VL[CG])\s*-?\s*(\d{4})([AB])?/gi
const RE_BA = /\bBA[ \t-]*(\d+[A-Za-z]?)/gi

/** Regla de oro: solo cuenta si la línea EMPIEZA con círculo verde o rojo. */
function estadoDeLinea(linea: string): EstatusMensaje | null {
  const t = linea.trimStart()
  if (t.startsWith(VERDE)) return 'Abierto'
  if (t.startsWith(ROJO)) return 'Cerrado'
  return null
}

function normalizarBA(token: string): string {
  // token ya viene aislado por el regex (número + letra pegada, si tiene).
  const m = /^(\d+)([A-Za-z]?)$/.exec(token)
  const numero = m ? m[1] : token
  const letra = m ? m[2].toUpperCase() : ''
  return `BA ${numero.padStart(4 - letra.length, '0')}${letra}`
}

function extraerPozos(linea: string): string[] {
  const pozos: string[] = []
  const ocupados: [number, number][] = []

  for (const m of linea.matchAll(RE_VL)) {
    pozos.push(m[1].toUpperCase() + m[2] + (m[3] ? m[3].toUpperCase() : ''))
    ocupados.push([m.index, m.index + m[0].length])
  }
  for (const m of linea.matchAll(RE_BA)) {
    // Ignorar un "BA" dentro de un match VL (improbable, pero por seguridad).
    if (ocupados.some(([s, e]) => m.index >= s && m.index < e)) continue
    pozos.push(normalizarBA(m[1]))
    ocupados.push([m.index, m.index + m[0].length])
  }
  return pozos
}

/**
 * Procesa el mensaje completo: pozo → estatus, deduplicado conservando orden
 * (si el mismo pozo aparece dos veces, manda el primero — igual que el original).
 */
export function parsearMensajeCoa(texto: string): PozoCoaDetectado[] {
  const vistos = new Map<string, EstatusMensaje>()
  for (const linea of texto.split('\n')) {
    const estatus = estadoDeLinea(linea)
    if (!estatus) continue
    for (const codigo of extraerPozos(linea)) {
      if (!vistos.has(codigo)) vistos.set(codigo, estatus)
    }
  }
  return [...vistos.entries()].map(([codigo, estatus]) => ({ codigo, estatus }))
}
