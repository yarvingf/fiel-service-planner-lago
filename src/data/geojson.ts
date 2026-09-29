import type { FeatureCollection } from 'geojson'
import { calcularDerivadosPozo, type PozoConCompletaciones } from '@/domain/pozo'
import { esTipoInstalacionConocido, type Instalacion } from '@/domain/instalacion'

/**
 * Convierte el dominio a FeatureCollections para MapLibre. Todas las propiedades
 * que los filtros/colores necesitan van aplanadas en `properties` — MapLibre
 * solo ve primitivas (string/number/boolean), nunca objetos anidados.
 */

export interface PropsPozo {
  kind: 'pozo'
  id: string
  codigo: string
  campo: string
  estatus: 'Abierto' | 'Cerrado' | 'Indeterminado'
  bnpdActivo: number
  potDifConfirmado: number
  potDifPosible: number
  diferidoIncompleto: boolean
  metodos: string
  cats: string
  ef: string
  mg: string
  /** Reservado para asignaciones (id de cuadrilla o ''). */
  cuadrilla: string
  /** Días desde la última visita GL/BES; 9999 si nunca fue visitado. */
  diasSinVisita: number
}

export function pozosAGeoJSON(
  pozos: readonly PozoConCompletaciones[],
  instalaciones: readonly Instalacion[],
  diasSinVisita?: ReadonlyMap<string, number>,
): FeatureCollection {
  const instPorId = new Map(instalaciones.map((i) => [i.id, i]))
  return {
    type: 'FeatureCollection',
    features: pozos
      .filter((p) => p.activo && !p.reemplazado && p.lat !== null && p.lon !== null)
      .map((p) => {
        const d = calcularDerivadosPozo(p.completaciones)
        const props: PropsPozo = {
          kind: 'pozo',
          id: p.id,
          codigo: p.codigo,
          campo: p.campo,
          estatus: d.estatus,
          bnpdActivo: d.bnpdActivo,
          potDifConfirmado: d.potencialDiferidoConfirmado,
          potDifPosible: d.potencialDiferidoPosible,
          diferidoIncompleto: d.diferidoIncompleto,
          metodos: d.metodos.join(','),
          cats: d.categorias.join(','),
          ef: (p.efId && instPorId.get(p.efId)?.codigo) ?? '',
          mg: (p.mgId && instPorId.get(p.mgId)?.codigo) ?? '',
          cuadrilla: '',
          diasSinVisita: diasSinVisita?.get(p.id) ?? 9999,
        }
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [p.lon!, p.lat!] },
          properties: props,
        }
      }),
  }
}

export interface PropsLinea {
  /** A qué tipo de instalación conecta esta línea (para color/filtro). */
  tipoLinea: 'EF' | 'MG'
  campo: string
  estatus: 'Abierto' | 'Cerrado' | 'Indeterminado'
  metodos: string
  potDifConfirmado: number
  bnpdActivo: number
  ef: string
  mg: string
  /** Código del pozo en este extremo — permite resaltar al pasar el mouse por él. */
  pozoCodigo: string
  /** Días desde la última visita del pozo de este extremo; 9999 si nunca. */
  diasSinVisita: number
}

/**
 * Una línea por cada asociación pozo→EF y pozo→MG existente. Lleva las mismas
 * propiedades que el pozo para poder reutilizar exactamente el mismo filtro
 * (expresionPozos): una línea solo se ve si el pozo en su extremo es visible.
 */
export function lineasAsociacionAGeoJSON(
  pozos: readonly PozoConCompletaciones[],
  instalaciones: readonly Instalacion[],
  diasSinVisita?: ReadonlyMap<string, number>,
): FeatureCollection {
  const instPorId = new Map(instalaciones.map((i) => [i.id, i]))
  const features: FeatureCollection['features'] = []
  for (const p of pozos) {
    if (p.reemplazado || !p.activo || p.lat === null || p.lon === null) continue
    const d = calcularDerivadosPozo(p.completaciones)
    const ef = (p.efId && instPorId.get(p.efId)) || null
    const mg = (p.mgId && instPorId.get(p.mgId)) || null
    const base = {
      campo: p.campo,
      estatus: d.estatus,
      metodos: d.metodos.join(','),
      potDifConfirmado: d.potencialDiferidoConfirmado,
      bnpdActivo: d.bnpdActivo,
      ef: ef?.codigo ?? '',
      mg: mg?.codigo ?? '',
      pozoCodigo: p.codigo,
      diasSinVisita: diasSinVisita?.get(p.id) ?? 9999,
    }
    for (const [tipoLinea, inst] of [['EF', ef], ['MG', mg]] as const) {
      if (!inst || inst.lat === null || inst.lon === null) continue
      const props: PropsLinea = { tipoLinea, ...base }
      features.push({
        type: 'Feature' as const,
        // Instalación → pozo: las flechas del indicador de asociación (símbolo
        // repetido a lo largo de la línea) apuntan en el sentido de recorrido,
        // así que el orden de los vértices define hacia dónde señalan.
        geometry: { type: 'LineString' as const, coordinates: [[inst.lon, inst.lat], [p.lon!, p.lat!]] },
        properties: props,
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

export interface PropsInstalacion {
  kind: 'instalacion'
  id: string
  codigo: string
  tipo: string
  /** Clave del icono registrado en el mapa: "inst-EF", "inst-MG", ..., "inst-OTRO". */
  icono: string
  campo: string
  cuadrilla: string
}

export function instalacionesAGeoJSON(instalaciones: readonly Instalacion[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: instalaciones
      .filter((i) => i.activo && !i.esStub && i.lat !== null && i.lon !== null)
      .map((i) => {
        const props: PropsInstalacion = {
          kind: 'instalacion',
          id: i.id,
          codigo: i.codigo,
          tipo: i.tipo,
          icono: esTipoInstalacionConocido(i.tipo) ? `inst-${i.tipo}` : 'inst-OTRO',
          campo: i.campo,
          cuadrilla: '',
        }
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [i.lon!, i.lat!] },
          properties: props,
        }
      }),
  }
}
