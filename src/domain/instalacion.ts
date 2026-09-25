import type { Campo } from './codigos'

/**
 * Tipos de instalación de interés para esta app (solo Lago; LOCACIÓN se excluye
 * porque es un área a perforar, sin producción ni pozo asociado todavía).
 */
export type TipoInstalacion =
  | 'EF' // Estación de Flujo
  | 'MG' // Múltiple de Gas
  | 'MLPR' // Múltiple de... (confirmar significado exacto con el usuario)
  | 'MAP' // Múltiple de Alta Presión
  | 'MB' // Múltiple de Baja Presión (por confirmar)
  | 'MIA' // Múltiple de Inyección de Agua (por confirmar)
  | 'MP' // Múltiple de Producción
  | 'MR' // Múltiple de Recolección (por confirmar)
  | 'PBES' // Plataforma BES
  | 'PC' // Planta Compresora
  | 'PIA' // Planta de Inyección de Agua (por confirmar)

export const TIPOS_INSTALACION_VISIBLES: readonly TipoInstalacion[] = [
  'EF',
  'MG',
  'MLPR',
  'MAP',
  'MB',
  'MIA',
  'MP',
  'MR',
  'PBES',
  'PC',
  'PIA',
]

/** Nombre legible de cada tipo para tooltips y leyenda. */
export const NOMBRES_TIPO_INSTALACION: Record<string, string> = {
  EF: 'Estación de Flujo',
  MG: 'Múltiple de Gas',
  MLPR: 'Múltiple de Línea de Producción',
  MAP: 'Múltiple de Alta Presión',
  MB: 'Múltiple de Baja Presión',
  MIA: 'Múltiple de Inyección de Agua',
  MP: 'Múltiple de Producción',
  MR: 'Múltiple de Recolección',
  PBES: 'Plataforma BES',
  PC: 'Planta Compresora',
  PIA: 'Planta de Inyección de Agua',
}

export function esTipoInstalacionConocido(tipo: string): tipo is TipoInstalacion {
  return (TIPOS_INSTALACION_VISIBLES as readonly string[]).includes(tipo)
}

export interface Instalacion {
  id: string
  /** Tipo declarado en la hoja. Puede ser un código desconocido (se alerta y se dibuja con icono genérico). */
  tipo: string
  /** Código tal como aparece en la hoja Instalaciones (p. ej. "EF-BA-17"). */
  codigo: string
  campo: Campo
  lat: number | null
  lon: number | null
  /**
   * true si esta instalación fue creada automáticamente porque un pozo la
   * referenciaba y no existía en el catálogo (queda sin coordenadas hasta
   * que se agregue manualmente o aparezca en un import posterior).
   */
  esStub: boolean
  activo: boolean
}
