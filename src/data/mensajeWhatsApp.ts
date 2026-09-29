import type { Cuadrilla } from '@/domain/cuadrilla'
import type { AsignacionRec } from '@/state/asignacionesStore'
import type { EstatusCoa } from '@/domain/pozo'
import { formatearFechaCorta } from '@/domain/fecha'
import type { DetalleObjetivo } from '@/domain/detalleAsignacion'

/** Bolita de estatus dentro de la negrita de cada pozo (rojo cerrado, verde abierto). */
export const EMOJI_ESTATUS: Record<EstatusCoa, string> = {
  Abierto: '🟢',
  Cerrado: '🔴',
  Indeterminado: '⚪',
}

/** Títulos con "sombra": `*` fuera y ` dentro → negrita real + backtick visible. */
const sombra = (s: string) => `*\`${s}\`*`

/** Encabezado de campo: negrita con corchetes 【 】. */
const rotuloCampo = (s: string) => `*【${s}】*`

/** Sección del mensaje por campo: BA → Bachaquero Lago, VLC/VLG → Ceuta-Treco. */
function seccionCampo(campo: DetalleObjetivo['campo']): string {
  if (campo === 'BA') return 'Bachaquero Lago'
  if (campo === 'VLC' || campo === 'VLG') return 'Ceuta-Treco'
  return 'Sin campo'
}

type NivelActividad = Map<string, AsignacionRec[]>
type NivelInstalacion = Map<string, NivelActividad>
type NivelCuadrilla = Map<string, NivelInstalacion>

/** Línea de instalación: MG, 3 espacios, EF — cada uno con su sombra. */
function lineaInstalacion(mg: string, ef: string): string {
  if (mg && ef) return `${sombra(mg)}   ${sombra(ef)}`
  if (mg || ef) return sombra(mg || ef)
  return sombra('Sin EF/MG asociado')
}

/**
 * Nivel de agrupación bajo la cuadrilla. El par MG/EF solo aplica a pozos
 * GL y NF (son los que dependen de múltiple de gas / estación de flujo);
 * pozos de otros métodos se agrupan bajo el nombre del método — "BES",
 * "BM", "BCP" — tal como se comunican los planes de revisión.
 */
function grupoDe(d: DetalleObjetivo | undefined): { clave: string; etiqueta: string } {
  const metodos = d?.metodos ?? []
  const usaMgEf = metodos.length === 0 || metodos.some((m) => m === 'GL' || m === 'NF')
  if (usaMgEf) {
    const clave = `mg|${d?.mg ?? ''}|${d?.ef ?? ''}`
    return { clave, etiqueta: lineaInstalacion(d?.mg ?? '', d?.ef ?? '') }
  }
  const clave = `metodo|${metodos.join('+')}`
  return { clave, etiqueta: sombra(metodos.join('   ')) }
}

/**
 * Construye el mensaje de WhatsApp del plan del día (solo pozos):
 *
 *   `*Acciones Gerencia Técnica*`
 *   *Plan de revision Productividad 22-sept-2026*
 *
 *   *【Bachaquero Lago】*
 *   🚢*`Cuadrilla: Cuadrilla 3`*
 *   *`BA 1-02`*   *`EF-BA-17`*
 *   ✓ Toma de Parámetros/Nivel a los pozos: *🔴 BA 1745*, *🟢 BA 2711*, …
 *   *`BES`*
 *   ✓ Otra actividad a los pozos: *🟢 BA 900*, …
 *
 * Agrupación: campo → cuadrilla → par MG/EF (solo GL/NF; otros métodos se
 * agrupan bajo su nombre: BES, BM, BCP) → actividad. Los títulos llevan
 * sombra (monoespaciado) y los pozos negrita con bolita de estatus.
 * Devuelve null si no hay pozos asignados ese día.
 */
export function construirMensajeWhatsApp(
  fecha: string,
  cuadrillas: readonly Cuadrilla[],
  asignaciones: readonly AsignacionRec[],
  detalleDe: ReadonlyMap<string, DetalleObjetivo>,
): string | null {
  const delDia = asignaciones.filter(
    (a) => a.fecha === fecha && a.objetivoId.startsWith('pozo|'),
  )
  if (delDia.length === 0) return null

  const nombreCuadrilla = new Map(cuadrillas.map((c) => [c.id, c.nombre]))

  // La llave de instalación es el PAR (mg, ef): un pozo pertenece a ambos.
  const arbol = new Map<string, NivelCuadrilla>()
  const etiquetaInst = new Map<string, string>()
  for (const a of delDia) {
    const d = detalleDe.get(a.objetivoId)
    const campo = seccionCampo(d?.campo ?? null)
    const cuadrilla = nombreCuadrilla.get(a.cuadrillaId) ?? 'Sin cuadrilla'
    const g = grupoDe(d)
    const inst = g.clave
    etiquetaInst.set(inst, g.etiqueta)
    const act = a.actividad?.trim() || 'Actividad por definir'
    let nC = arbol.get(campo)
    if (!nC) arbol.set(campo, (nC = new Map()))
    let nI = nC.get(cuadrilla)
    if (!nI) nC.set(cuadrilla, (nI = new Map()))
    let nA = nI.get(inst)
    if (!nA) nI.set(inst, (nA = new Map()))
    let items = nA.get(act)
    if (!items) nA.set(act, (items = []))
    items.push(a)
  }

  const pesoCampo = (s: string) =>
    s === 'Bachaquero Lago' ? 0 : s === 'Ceuta-Treco' ? 1 : 2
  const ordenado = <T>(m: Map<string, T>, peso?: (k: string) => number) =>
    [...m.entries()].sort((a, b) => (peso ? peso(a[0]) - peso(b[0]) : 0) || a[0].localeCompare(b[0]))

  const lineas: string[] = [
    '`*Acciones Gerencia Técnica*`',
    `*Plan de revision Productividad ${formatearFechaCorta(fecha)}*`,
  ]
  for (const [campo, nCuadrillas] of ordenado(arbol, pesoCampo)) {
    lineas.push('', rotuloCampo(campo))
    for (const [cuadrilla, nInsts] of ordenado(nCuadrillas)) {
      lineas.push(`🚢${sombra(`Cuadrilla: ${cuadrilla}`)}`)
      for (const [inst, nActs] of ordenado(nInsts)) {
        lineas.push(etiquetaInst.get(inst)!)
        for (const [act, items] of ordenado(nActs)) {
          const pozos = items
            .sort((x, y) => x.codigo.localeCompare(y.codigo))
            .map((p) => {
              const e = detalleDe.get(p.objetivoId)?.estatus
              return `*${e ? EMOJI_ESTATUS[e] : '⚪'} ${p.codigo}*`
            })
            .join(', ')
          lineas.push(`✓ ${act} a los pozos: ${pozos}`)
        }
      }
    }
  }
  return lineas.join('\n')
}
