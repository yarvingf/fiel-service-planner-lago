import type { CamposAsignacion } from './persistencia'

/**
 * Agrupa las ediciones pendientes por combinación idéntica de campos: las
 * filas que recibieron el mismo cambio comparten un solo UPDATE ... IN en
 * Supabase en vez de un request por fila.
 *
 * La clave canónica serializa los campos con keys ordenadas, así dos objetos
 * `{a:1,b:2}` y `{b:2,a:1}` caen en el mismo grupo.
 */
export function agruparCambiosLote(
  cambios: ReadonlyMap<string, CamposAsignacion>,
): { ids: string[]; campos: CamposAsignacion }[] {
  const grupos = new Map<string, { ids: string[]; campos: CamposAsignacion }>()
  for (const [id, campos] of cambios) {
    const clave = JSON.stringify(
      Object.keys(campos)
        .sort()
        .map((k) => [k, (campos as Record<string, unknown>)[k]]),
    )
    const g = grupos.get(clave) ?? { ids: [], campos }
    g.ids.push(id)
    grupos.set(clave, g)
  }
  return [...grupos.values()]
}
