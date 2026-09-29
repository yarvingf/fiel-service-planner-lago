/**
 * Alertas generadas durante el import del Excel. Se acumulan en una lista y se
 * exportan como reporte en Excel; nada se descarta en silencio.
 */
export type TipoAlerta =
  | 'codigo_pozo_invalido'
  | 'ef_sin_match'
  | 'mg_sin_match'
  | 'coordenadas_discrepantes_entre_arenas'
  | 'ef_discrepante_entre_arenas'
  | 'falta_mg_para_gl'
  | 'valor_no_numerico'
  | 'coa_vacio'
  | 'coa_desconocido'
  | 'metodo_desconocido'
  | 'fecha_invalida'
  | 'coordenadas_ausentes'
  | 'coordenadas_fuera_de_rango'
  | 'coordenadas_invertidas'
  | 'espacios_irregulares'
  | 'duplicado_completacion'
  | 'duplicado_instalacion'
  | 'tipo_instalacion_desconocido'
  | 'campo_desconocido_instalacion'
  | 'instalacion_sin_coordenadas'
  | 'visita_sin_fecha'
  | 'visita_pozo_sin_match'
  | 'duplicado_visita'

export interface AlertaImport {
  tipo: TipoAlerta
  /** Fila del Excel (1-indexada, tal como la vería el usuario abriendo el archivo). */
  fila: number
  hoja: string
  pozo: string | null
  mensaje: string
}

export function crearAlerta(
  tipo: TipoAlerta,
  hoja: string,
  fila: number,
  mensaje: string,
  pozo: string | null = null,
): AlertaImport {
  return { tipo, hoja, fila, pozo, mensaje }
}

/** Rango aproximado del Lago de Maracaibo, usado para detectar coordenadas invertidas o con signo equivocado. */
export const RANGO_LAGO = {
  lat: [9, 11] as const,
  lon: [-72, -70.8] as const,
}

export function coordenadasFueraDeRango(lat: number, lon: number): boolean {
  return lat < RANGO_LAGO.lat[0] || lat > RANGO_LAGO.lat[1] || lon < RANGO_LAGO.lon[0] || lon > RANGO_LAGO.lon[1]
}
