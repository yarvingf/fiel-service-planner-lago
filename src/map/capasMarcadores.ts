import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'

export const ID_FUENTE_POZOS = 'src-pozos'
export const ID_FUENTE_INSTALACIONES = 'src-instalaciones'

export const ID_CAPA_POZOS = 'capa-pozos'
export const ID_CAPA_POZOS_ETIQUETAS = 'capa-pozos-etiquetas'
export const ID_CAPA_INSTALACIONES = 'capa-instalaciones'
export const ID_CAPA_INSTALACIONES_ETIQUETAS = 'capa-instalaciones-etiquetas'
export const ID_CAPA_INST_HALO = 'capa-inst-halo'
export const ID_FUENTE_LINEAS = 'src-lineas-asociacion'
export const ID_CAPA_LINEAS_HALO = 'capa-lineas-halo'
/**
 * Líneas del modo "gradiente": una por tipo (EF/MG) porque `line-gradient`
 * no admite expresiones que lean propiedades del feature (data expressions)
 * — los stops deben ser literales, así que el color va fijo por capa.
 * Las de grosor (el doble de anchas, transparente→opaca hacia el pozo) van
 * debajo y simulan el engrosamiento 100%→200% sin variar line-width.
 */
export const ID_CAPA_LINEAS_EF = 'capa-lineas-ef'
export const ID_CAPA_LINEAS_MG = 'capa-lineas-mg'
export const ID_CAPA_LINEAS_EF_GROSOR = 'capa-lineas-ef-grosor'
export const ID_CAPA_LINEAS_MG_GROSOR = 'capa-lineas-mg-grosor'
export const ID_CAPA_LINEAS = 'capa-lineas-asociacion'
/** Banda breve y brillante que recorre la línea (solo modo "animado") — marca el sentido instalación→pozo además del guión. */
export const ID_CAPA_LINEAS_CABEZA = 'capa-lineas-cabeza-animada'
export const ID_CAPA_POZOS_HALO = 'capa-pozos-halo'
export const COLOR_SELECCION = '#06b6d4'

/**
 * `false` a secas (literal booleano) es una expresión inequívoca y sirve como
 * filtro "nada pasa". El array ['==', true, false] revienta la validación de
 * addLayer(): MapLibre lo interpreta como filtro LEGACY, donde el 2º elemento
 * debe ser un nombre de propiedad (string), no un booleano — lanza y la capa
 * nunca se crea.
 */
export const FILTRO_OCULTO: FilterSpecification = false

/**
 * Color por tipo de asociación: EF naranja, MG verde (distinguen mejor del
 * fondo satelital/azul que un tono similar a otras capas). Exportados para
 * que `estiloLineas.ts` arme el gradiente con los mismos colores.
 */
export const COLOR_EF = '#f97316'
export const COLOR_MG = '#22c55e'
export const COLOR_LINEA_OTRO = '#94a3b8'
const COLOR_LINEA_POR_TIPO: ExpressionSpecification = [
  'match', ['get', 'tipoLinea'], 'EF', COLOR_EF, 'MG', COLOR_MG, COLOR_LINEA_OTRO,
]
const ANCHO_LINEA_DEFECTO: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1, 15, 1.6]
/** El doble del ancho base — es el "200%" que se revela hacia el pozo en el modo gradiente. */
const ANCHO_LINEA_GROSOR: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 8, 1.2, 12, 2, 15, 3.2]

function conAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/**
 * Gradientes por tipo (stops literales — line-gradient no admite ['get']):
 * progreso 0 = extremo instalación (apagado), 1 = extremo pozo (vistoso);
 * el orden de vértices en geojson.ts pone la instalación primero.
 */
const gradienteLinea = (hex: string): ExpressionSpecification => [
  'interpolate', ['linear'], ['line-progress'], 0, conAlpha(hex, 0.05), 1, conAlpha(hex, 0.95),
]
const gradienteGrosor = (hex: string): ExpressionSpecification => [
  'interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, conAlpha(hex, 0.6),
]

/** Color de pozo según estatus derivado (visible también en el panel/filtros). */
export const COLORES_ESTATUS = {
  Abierto: '#16a34a',
  Cerrado: '#dc2626',
  Indeterminado: '#9ca3af',
} as const

/**
 * Iconos por tipo de instalación, generados en canvas (sin sprites externos).
 * Familia por pictograma: EF = separador/estación, M* = manifold de tubería,
 * P* = fábrica, PBES = plataforma jack-up del lago. Color distintivo por tipo.
 */
type Familia = 'estacion' | 'multiple' | 'planta' | 'plataforma' | 'otro'

const ICONOS: Record<string, { familia: Familia; color: string }> = {
  EF: { familia: 'estacion', color: '#f59e0b' },
  MG: { familia: 'multiple', color: '#2563eb' },
  MLPR: { familia: 'multiple', color: '#60a5fa' },
  MAP: { familia: 'multiple', color: '#dc2626' },
  MB: { familia: 'multiple', color: '#16a34a' },
  MIA: { familia: 'multiple', color: '#0891b2' },
  MP: { familia: 'multiple', color: '#7c3aed' },
  MR: { familia: 'multiple', color: '#64748b' },
  PBES: { familia: 'plataforma', color: '#7c3aed' },
  PC: { familia: 'planta', color: '#0891b2' },
  PIA: { familia: 'planta', color: '#16a34a' },
  OTRO: { familia: 'otro', color: '#6b7280' },
}

/** Siluetas en blanco (~24px) dentro del disco de color, centrado en (c, c). */
function pintarPictograma(ctx: CanvasRenderingContext2D, familia: Familia, c: number): void {
  const x = c, y = c
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (familia === 'estacion') {
    // EF: separador/tanque horizontal con stubs arriba y patas
    ctx.beginPath()
    ctx.roundRect(x - 11, y - 4, 22, 10, 5)
    ctx.stroke()
    ctx.beginPath()
    for (const dx of [-6, 0, 6]) {
      ctx.moveTo(x + dx, y - 4)
      ctx.lineTo(x + dx, y - 9)
    }
    ctx.moveTo(x - 7, y + 6)
    ctx.lineTo(x - 7, y + 10)
    ctx.moveTo(x + 7, y + 6)
    ctx.lineTo(x + 7, y + 10)
    ctx.stroke()
  } else if (familia === 'multiple') {
    // Múltiple: línea principal con 4 risers
    ctx.beginPath()
    ctx.moveTo(x - 11, y + 5)
    ctx.lineTo(x + 11, y + 5)
    for (const dx of [-8, -3, 3, 8]) {
      ctx.moveTo(x + dx, y + 5)
      ctx.lineTo(x + dx, y - 7)
      ctx.moveTo(x + dx - 2.5, y - 7)
      ctx.lineTo(x + dx + 2.5, y - 7)
    }
    ctx.stroke()
  } else if (familia === 'planta') {
    // Planta: edificio con techo aserrado y chimenea
    ctx.beginPath()
    ctx.moveTo(x - 11, y + 10)
    ctx.lineTo(x - 11, y - 1)
    ctx.lineTo(x - 6, y - 5)
    ctx.lineTo(x - 6, y - 1)
    ctx.lineTo(x - 1, y - 5)
    ctx.lineTo(x - 1, y - 1)
    ctx.lineTo(x + 4, y - 5)
    ctx.lineTo(x + 4, y - 1)
    ctx.lineTo(x + 11, y - 1)
    ctx.lineTo(x + 11, y + 10)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(x + 6, y - 11, 4.5, 10)
  } else if (familia === 'plataforma') {
    // PBES: jack-up — deck, torre de perforación y patas
    ctx.fillRect(x - 11, y - 3, 22, 4)
    ctx.beginPath()
    ctx.moveTo(x - 6, y - 3)
    ctx.lineTo(x - 2.5, y - 11)
    ctx.lineTo(x + 1, y - 3)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(x - 7, y + 1)
    ctx.lineTo(x - 7, y + 10)
    ctx.moveTo(x + 7, y + 1)
    ctx.lineTo(x + 7, y + 10)
    ctx.moveTo(x - 9, y + 10)
    ctx.lineTo(x - 5, y + 10)
    ctx.moveTo(x + 5, y + 10)
    ctx.lineTo(x + 9, y + 10)
    ctx.stroke()
  } else {
    // Otro: pin de mapa
    ctx.beginPath()
    ctx.arc(x, y - 4, 6, Math.PI * 0.7, Math.PI * 2.3)
    ctx.lineTo(x, y + 10)
    ctx.closePath()
    ctx.fill()
  }
}

function crearImagenIcono(familia: Familia, color: string): ImageData {
  const TAM = 40 // px del lienzo; se escala con icon-size
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TAM
  const ctx = canvas.getContext('2d')!
  const c = TAM / 2
  ctx.beginPath()
  ctx.arc(c, c, 16, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  pintarPictograma(ctx, familia, c)
  return ctx.getImageData(0, 0, TAM, TAM)
}

export function registrarIconosInstalaciones(map: MaplibreMap): void {
  for (const [tipo, { familia, color }] of Object.entries(ICONOS)) {
    const id = `inst-${tipo}`
    if (!map.hasImage(id)) map.addImage(id, crearImagenIcono(familia, color))
  }
}

const FC_VACIA: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Crea fuentes GeoJSON vacías y todas las capas de marcadores. Los datos llegan
 * después vía setData() cuando el store termine de importar.
 */
export function agregarCapasMarcadores(map: MaplibreMap): void {
  registrarIconosInstalaciones(map)

  if (!map.getSource(ID_FUENTE_INSTALACIONES)) {
    map.addSource(ID_FUENTE_INSTALACIONES, { type: 'geojson', data: FC_VACIA, promoteId: 'id' })
  }
  if (!map.getSource(ID_FUENTE_POZOS)) {
    map.addSource(ID_FUENTE_POZOS, { type: 'geojson', data: FC_VACIA, promoteId: 'id' })
  }
  if (!map.getSource(ID_FUENTE_LINEAS)) {
    // lineMetrics: true habilita ['line-progress'] — lo necesita el modo
    // "gradiente" de estiloLineas.ts (color GPU-side según avance en la
    // línea, sin tocar geometría ni redibujar nada por nuestra parte).
    map.addSource(ID_FUENTE_LINEAS, { type: 'geojson', data: FC_VACIA, lineMetrics: true })
  }

  // Las 3 capas de instalación nacen ocultas (filter: false) — el efecto de
  // filtros las revela según los tipos elegidos en `tiposInst`. Evita que,
  // por una carrera de timing entre el primer render y el efecto de React,
  // se vean instalaciones sin filtrar durante un instante al cargar el mapa.

  // Líneas de asociación pozo→EF / pozo→MG: finas para no saturar la
  // pantalla, debajo de todo lo demás (se agregan primero). El color/patrón
  // exacto (gradiente vs. animado) lo decide `estiloLineas.ts` vía
  // setPaintProperty — aquí solo el layer base con un color sólido de
  // arranque. El halo blanco va DEBAJO de la línea de color y nace sin nada
  // seleccionado (filter: false) — el hover lo revela solo para el grupo
  // resaltado (ver `resaltarLineas`), simulando una sombra/glow en vez de
  // jugar con la opacidad del resto.
  if (!map.getLayer(ID_CAPA_LINEAS_HALO)) {
    map.addLayer({
      id: ID_CAPA_LINEAS_HALO,
      type: 'line',
      source: ID_FUENTE_LINEAS,
      filter: FILTRO_OCULTO,
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 4.5,
        'line-blur': 2.5,
        'line-opacity': 0.9,
      },
    })
  }
  // Capas del modo "gradiente" (una por tipo EF/MG): el gradiente va horneado
  // en el paint porque line-gradient no admite expresiones con ['get']. Las
  // de grosor son el doble de anchas y nacen transparentes en la instalación —
  // sus bordes asoman a los lados de la línea principal a medida que ganan
  // opacidad hacia el pozo ("engrosa 100%→200%"). Su visibilidad y el filtro
  // por tipo los decide `aplicarFiltros` (mostrarLineas && estilo === 'gradiente').
  for (const [id, hex] of [
    [ID_CAPA_LINEAS_EF_GROSOR, COLOR_EF],
    [ID_CAPA_LINEAS_MG_GROSOR, COLOR_MG],
  ] as const) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: 'line',
        source: ID_FUENTE_LINEAS,
        filter: FILTRO_OCULTO,
        layout: { visibility: 'none' },
        paint: { 'line-width': ANCHO_LINEA_GROSOR, 'line-gradient': gradienteGrosor(hex) },
      })
    }
  }
  for (const [id, hex] of [
    [ID_CAPA_LINEAS_EF, COLOR_EF],
    [ID_CAPA_LINEAS_MG, COLOR_MG],
  ] as const) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: 'line',
        source: ID_FUENTE_LINEAS,
        filter: FILTRO_OCULTO,
        layout: { visibility: 'none' },
        paint: { 'line-width': ANCHO_LINEA_DEFECTO, 'line-gradient': gradienteLinea(hex) },
      })
    }
  }
  if (!map.getLayer(ID_CAPA_LINEAS)) {
    map.addLayer({
      id: ID_CAPA_LINEAS,
      type: 'line',
      source: ID_FUENTE_LINEAS,
      filter: FILTRO_OCULTO,
      layout: { visibility: 'none' },
      paint: {
        'line-color': COLOR_LINEA_POR_TIPO,
        'line-width': ANCHO_LINEA_DEFECTO,
        'line-opacity': 0.55,
      },
    })
  }

  // "Cabecita" animada (solo modo "animado"): una banda breve y brillante que
  // recorre la línea instalación→pozo, encima del guión, para distinguir el
  // rumbo. Se anima junto al dasharray en el mismo intervalo (ver
  // estiloLineas.ts) moviendo solo un `line-gradient` — un setPaintProperty
  // por tick, nada de geometría ni recálculo ligado al zoom.
  if (!map.getLayer(ID_CAPA_LINEAS_CABEZA)) {
    map.addLayer({
      id: ID_CAPA_LINEAS_CABEZA,
      type: 'line',
      source: ID_FUENTE_LINEAS,
      filter: FILTRO_OCULTO,
      layout: { visibility: 'none' },
      paint: {
        'line-width': ANCHO_LINEA_GROSOR,
      },
    })
  }

  // Halo bajo los iconos de instalación: anillo de selección (cian) o color de cuadrilla
  if (!map.getLayer(ID_CAPA_INST_HALO)) {
    map.addLayer({
      id: ID_CAPA_INST_HALO,
      type: 'circle',
      source: ID_FUENTE_INSTALACIONES,
      filter: FILTRO_OCULTO,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 6, 15, 8],
        'circle-color': [
          'case',
          ['boolean', ['feature-state', 'seleccionado'], false],
          '#06b6d4',
          ['coalesce', ['feature-state', 'colorCuadrilla'], 'rgba(0,0,0,0)'],
        ],
        'circle-opacity': 0.85,
      },
    })
  }

  // Instalaciones: icono por tipo + etiqueta
  if (!map.getLayer(ID_CAPA_INSTALACIONES)) {
    map.addLayer({
      id: ID_CAPA_INSTALACIONES,
      type: 'symbol',
      source: ID_FUENTE_INSTALACIONES,
      filter: FILTRO_OCULTO,
      layout: {
        'icon-image': ['get', 'icono'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 0.5, 15, 0.65],
        'icon-allow-overlap': true,
      },
    })
  }
  if (!map.getLayer(ID_CAPA_INSTALACIONES_ETIQUETAS)) {
    map.addLayer({
      id: ID_CAPA_INSTALACIONES_ETIQUETAS,
      type: 'symbol',
      source: ID_FUENTE_INSTALACIONES,
      filter: FILTRO_OCULTO,
      minzoom: 11,
      layout: {
        'text-field': ['get', 'codigo'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
      },
    })
  }

  // Sombra blanca detrás del pozo cuando forma parte del grupo resaltado en
  // hover (mismo mecanismo que el halo de las líneas, sin tocar el color ni
  // la opacidad normal del pozo).
  if (!map.getLayer(ID_CAPA_POZOS_HALO)) {
    map.addLayer({
      id: ID_CAPA_POZOS_HALO,
      type: 'circle',
      source: ID_FUENTE_POZOS,
      filter: FILTRO_OCULTO,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 9, 15, 12],
        'circle-color': '#ffffff',
        'circle-blur': 0.8,
        'circle-opacity': 0.9,
      },
    })
  }

  // Pozos: círculo coloreado por estatus + etiqueta con el código completo
  if (!map.getLayer(ID_CAPA_POZOS)) {
    map.addLayer({
      id: ID_CAPA_POZOS,
      type: 'circle',
      source: ID_FUENTE_POZOS,
      paint: {
        'circle-color': EXPRESION_COLOR_ESTATUS,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 4.5, 15, 6.5],
        'circle-stroke-color': [
          'case',
          ['boolean', ['feature-state', 'seleccionado'], false],
          COLOR_SELECCION,
          '#ffffff',
        ],
        'circle-stroke-width': [
          'case',
          ['boolean', ['feature-state', 'seleccionado'], false],
          2.5,
          1.2,
        ],
        'circle-opacity': 0.92,
      },
    })
  }
  if (!map.getLayer(ID_CAPA_POZOS_ETIQUETAS)) {
    map.addLayer({
      id: ID_CAPA_POZOS_ETIQUETAS,
      type: 'symbol',
      source: ID_FUENTE_POZOS,
      minzoom: 10.5,
      layout: {
        'text-field': ['get', 'codigo'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
        // Prioriza etiquetas de pozos con mayor potencial diferido al colisionar
        'symbol-sort-key': ['get', 'potDifConfirmado'],
      },
      paint: {
        'text-color': '#111827',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
      },
    })
  }
}

const EXPRESION_COLOR_ESTATUS: ExpressionSpecification = [
  'match', ['get', 'estatus'],
  'Abierto', COLORES_ESTATUS.Abierto,
  'Cerrado', COLORES_ESTATUS.Cerrado,
  COLORES_ESTATUS.Indeterminado,
]

/**
 * 'cuadrilla': el color de la cuadrilla asignada ese día (feature-state) pisa el
 * de estatus; los sin asignar conservan su color de estatus.
 */
export function aplicarColorPor(map: MaplibreMap, modo: 'estatus' | 'cuadrilla'): void {
  if (!map.getLayer(ID_CAPA_POZOS)) return
  map.setPaintProperty(
    ID_CAPA_POZOS,
    'circle-color',
    modo === 'cuadrilla'
      ? ['coalesce', ['feature-state', 'colorCuadrilla'], EXPRESION_COLOR_ESTATUS]
      : EXPRESION_COLOR_ESTATUS,
  )
}

export function actualizarDatosMarcadores(
  map: MaplibreMap,
  pozos: FeatureCollection,
  instalaciones: FeatureCollection,
  lineas: FeatureCollection,
): void {
  const srcPozos = map.getSource(ID_FUENTE_POZOS) as GeoJSONSource | undefined
  const srcInst = map.getSource(ID_FUENTE_INSTALACIONES) as GeoJSONSource | undefined
  const srcLineas = map.getSource(ID_FUENTE_LINEAS) as GeoJSONSource | undefined
  srcPozos?.setData(pozos)
  srcInst?.setData(instalaciones)
  srcLineas?.setData(lineas)
}
