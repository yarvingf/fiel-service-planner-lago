/**
 * Ruta de lancha para las asignaciones de una cuadrilla.
 *
 * Modelo: las líneas rectas sobre el lago son una aproximación razonable del
 * recorrido real (agua abierta, sin obstáculos). Distancia = haversine en
 * millas náuticas; tiempo = nm ÷ velocidad en nudos.
 *
 * Algoritmo: vecino más cercano desde el muelle + pulido 2-opt (intercambios
 * de arcos). Para ~5-15 paradas por cuadrilla llega a rutas prácticamente
 * óptimas en microsegundos — no hace falta un solver TSP completo.
 */

export interface PuntoRuta {
  lon: number
  lat: number
}

export interface ParadaRuta extends PuntoRuta {
  codigo: string
}

export interface TramoRuta {
  /** Nombre del punto de llegada (el de salida es el anterior de la ruta). */
  hasta: string
  nm: number
}

export interface RutaCalculada {
  /** Paradas en orden de visita (sin el origen). */
  orden: ParadaRuta[]
  /** Tramos en orden: origen→1, 1→2, ..., (última→origen si `cerrada`). */
  tramos: TramoRuta[]
  totalNm: number
}

const NM_POR_METRO = 1 / 1852
const RADIO_TIERRA_M = 6371e3

/** Distancia gran círculo en millas náuticas. */
export function distanciaNm(a: PuntoRuta, b: PuntoRuta): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h)) * NM_POR_METRO
}

/**
 * Orden de visita: indices en `paradas`, comenzando por la más cercana al
 * origen (vecino más cercano) y pulido por 2-opt.
 */
export function ordenarRuta(origen: PuntoRuta, paradas: readonly PuntoRuta[], cerrada: boolean): number[] {
  const n = paradas.length
  if (n <= 1) return paradas.map((_, i) => i)

  // Vecino más cercano
  const restante = new Set(paradas.map((_, i) => i))
  const orden: number[] = []
  let actual = origen
  while (restante.size > 0) {
    let mejor = -1
    let mejorD = Infinity
    for (const i of restante) {
      const d = distanciaNm(actual, paradas[i])
      if (d < mejorD) {
        mejorD = d
        mejor = i
      }
    }
    restante.delete(mejor)
    orden.push(mejor)
    actual = paradas[mejor]
  }

  // Pulido 2-opt: pts[0] = origen, pts[k] = paradas[orden[k-1]]
  const pts = [origen, ...orden.map((i) => paradas[i])]
  const costo = distanciaNm
  // El arco de cierre (última → origen) solo existe si la ruta es cerrada.
  const arcoCierre = (desde: PuntoRuta) => (cerrada ? costo(desde, origen) : 0)

  let mejoro = true
  let guardia = 0
  while (mejoro && guardia++ < 50) {
    mejoro = false
    for (let i = 1; i < pts.length - 1; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i - 1]
        const b = pts[i]
        const c = pts[j]
        const e = j + 1 < pts.length ? pts[j + 1] : null
        const antes = costo(a, b) + (e ? costo(c, e) : arcoCierre(c))
        const despues = costo(a, c) + (e ? costo(b, e) : arcoCierre(b))
        if (despues < antes - 1e-9) {
          pts.splice(i, j - i + 1, ...pts.slice(i, j + 1).reverse())
          orden.splice(i - 1, j - i + 1, ...orden.slice(i - 1, j).reverse())
          mejoro = true
        }
      }
    }
  }
  return orden
}

/** Arma la ruta completa (orden + tramos + total) para una cuadrilla. */
export function calcularRuta(origen: ParadaRuta, paradas: readonly ParadaRuta[], cerrada: boolean): RutaCalculada {
  const ordenIdx = ordenarRuta(origen, paradas, cerrada)
  const orden = ordenIdx.map((i) => paradas[i])

  const tramos: TramoRuta[] = []
  let totalNm = 0
  let previo: PuntoRuta = origen
  for (const p of orden) {
    const nm = distanciaNm(previo, p)
    tramos.push({ hasta: p.codigo, nm })
    totalNm += nm
    previo = p
  }
  if (cerrada && orden.length > 0) {
    const nm = distanciaNm(previo, origen)
    tramos.push({ hasta: origen.codigo, nm })
    totalNm += nm
  }
  return { orden, tramos, totalNm }
}

/**
 * Minutos de navegación de un tramo.
 *
 * - `nudos`: velocidad propia de la lancha (1 nudo = 1 nm/h).
 * - `corrienteKn`: corriente/marea en CONTRA en nudos — se resta de la
 *   velocidad propia (negativo = a favor). Piso de 0.5 kn efectivos: una
 *   corriente que anula el avance no puede dar tiempo infinito, se trata
 *   como avance mínimo de maniobra.
 * - `margenPct`: buffer porcentual sobre el tiempo (maniobra de
 *   atraque/desatraque, oleaje, espera) — 10 = +10% en cada tramo.
 */
export function minutosDe(nm: number, nudos: number, corrienteKn = 0, margenPct = 0): number {
  const efectivos = Math.max(nudos - corrienteKn, 0.5)
  if (!(efectivos > 0)) return 0
  return (nm / efectivos) * 60 * (1 + margenPct / 100)
}

/** Velocidad efectiva de avance con corriente (para mostrarla en la UI). */
export function velocidadEfectiva(nudos: number, corrienteKn = 0): number {
  return Math.max(nudos - corrienteKn, 0.5)
}

/** "1h 25m" o "45 min" para los tiempos por tramo y totales. */
export function fmtDuracion(minutos: number): string {
  const m = Math.round(minutos)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  return resto === 0 ? `${h}h` : `${h}h ${resto}m`
}
