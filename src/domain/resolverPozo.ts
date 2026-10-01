import type { PozoConCompletaciones } from './pozo'
import { claveNormalizadaPozo, clavePozoFisico, parsearCodigoPozo, type Campo } from './codigos'

/**
 * Resolución de un código detectado (parser COA, lista pegada, etc.) contra
 * el universo de pozos: primero match exacto normalizado no-reemplazado; si
 * no, el pozo físico activo — los textos operativos suelen soltar la letra
 * de reemplazo ("BA 345" en un mensaje matchea el "BA 345A" vigente).
 */

export interface IndicePozos {
  porCodigo: Map<string, PozoConCompletaciones>
  porFisico: Map<string, PozoConCompletaciones[]>
}

export function construirIndicePozos(pozos: readonly PozoConCompletaciones[]): IndicePozos {
  const porCodigo = new Map<string, PozoConCompletaciones>()
  const porFisico = new Map<string, PozoConCompletaciones[]>()
  for (const p of pozos) {
    porCodigo.set(claveNormalizadaPozo(p.codigo), p)
    const k = clavePozoFisico(p)
    const arr = porFisico.get(k) ?? []
    arr.push(p)
    porFisico.set(k, arr)
  }
  return { porCodigo, porFisico }
}

export interface MatchPozo {
  pozo: PozoConCompletaciones
  /** 'exacto' = mismo código; 'fisico' = mismo pozo físico, otra letra de reemplazo. */
  via: 'exacto' | 'fisico'
}

function campoDeCodigo(codigo: string): Campo {
  return codigo.startsWith('VLC') ? 'VLC' : codigo.startsWith('VLG') ? 'VLG' : 'BA'
}

/**
 * Devuelve el pozo resuelto, o null si el código no existe en el universo.
 * Sin activo puede devolver el exacto aunque esté reemplazado (histórico) —
 * el llamador decide si eso es usable para su flujo.
 */
export function resolverPozoPorCodigo(codigo: string, indice: IndicePozos): MatchPozo | null {
  const exacto = indice.porCodigo.get(claveNormalizadaPozo(codigo))
  if (exacto && !exacto.reemplazado) return { pozo: exacto, via: 'exacto' }
  const parseado = parsearCodigoPozo(codigo, campoDeCodigo(codigo))
  const activo = parseado
    ? (indice.porFisico.get(clavePozoFisico(parseado)) ?? []).find((x) => !x.reemplazado)
    : undefined
  if (activo) return { pozo: activo, via: 'fisico' }
  return exacto ? { pozo: exacto, via: 'exacto' } : null
}
