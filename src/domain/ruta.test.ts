import { describe, expect, it } from 'vitest'
import { calcularRuta, distanciaNm, fmtDuracion, minutosDe, ordenarRuta, type ParadaRuta } from './ruta'

const origen: ParadaRuta = { codigo: 'Muelle', lon: -71.3, lat: 9.83 }

const paradas: ParadaRuta[] = [
  { codigo: 'Lejos', lon: -71.15, lat: 9.9 },
  { codigo: 'Cerca', lon: -71.29, lat: 9.84 },
  { codigo: 'Medio', lon: -71.2, lat: 9.88 },
]

describe('distanciaNm', () => {
  it('un grado de latitud ≈ 60 millas náuticas', () => {
    const nm = distanciaNm({ lon: -71, lat: 10 }, { lon: -71, lat: 11 })
    expect(nm).toBeGreaterThan(59)
    expect(nm).toBeLessThan(61)
  })

  it('distancia al mismo punto es 0', () => {
    expect(distanciaNm(origen, origen)).toBe(0)
  })
})

describe('ordenarRuta', () => {
  it('visita todas las paradas una sola vez y empieza por la más cercana', () => {
    const orden = ordenarRuta(origen, paradas, true)
    expect(orden).toHaveLength(paradas.length)
    expect(new Set(orden).size).toBe(paradas.length)
    // 'Cerca' está a ~1 km del muelle; debe ser la primera parada.
    expect(paradas[orden[0]].codigo).toBe('Cerca')
  })

  it('2-opt evita ir y volver (Cerca → Medio → Lejos, no intercalado)', () => {
    const orden = ordenarRuta(origen, paradas, true).map((i) => paradas[i].codigo)
    expect(orden).toEqual(['Cerca', 'Medio', 'Lejos'])
  })

  it('con 0 o 1 parada devuelve el orden trivial', () => {
    expect(ordenarRuta(origen, [], true)).toEqual([])
    expect(ordenarRuta(origen, [paradas[0]], true)).toEqual([0])
  })
})

describe('calcularRuta', () => {
  it('ruta abierta tiene N tramos; cerrada tiene N+1 (con regreso al muelle)', () => {
    const abierta = calcularRuta(origen, paradas, false)
    const cerrada = calcularRuta(origen, paradas, true)
    expect(abierta.tramos).toHaveLength(paradas.length)
    expect(cerrada.tramos).toHaveLength(paradas.length + 1)
    expect(cerrada.tramos.at(-1)!.hasta).toBe('Muelle')
    expect(cerrada.totalNm).toBeCloseTo(cerrada.tramos.reduce((s, t) => s + t.nm, 0))
  })
})

describe('tiempos', () => {
  it('a 12 nudos, 12 nm son 60 minutos', () => {
    expect(minutosDe(12, 12)).toBeCloseTo(60)
  })
  it('corriente en contra resta velocidad efectiva (15kn − 3kn = 12kn)', () => {
    // 12 nm a 12 kn efectivos = 60 min — igual que antes pero con corriente.
    expect(minutosDe(12, 15, 3)).toBeCloseTo(60)
  })
  it('corriente a favor (negativa) acelera', () => {
    expect(minutosDe(12, 12, -3)).toBeCloseTo(48) // 12nm a 15kn efectivos
  })
  it('corriente que iguala la velocidad deja piso de 0.5 kn', () => {
    // 1 nm a 0.5 kn efectivos = 120 min — no infinito.
    expect(minutosDe(1, 10, 10)).toBeCloseTo(120)
  })
  it('el margen % escala el tiempo', () => {
    expect(minutosDe(12, 12, 0, 10)).toBeCloseTo(66)
  })
  it('fmtDuracion formatea horas y minutos', () => {
    expect(fmtDuracion(45)).toBe('45 min')
    expect(fmtDuracion(85)).toBe('1h 25m')
    expect(fmtDuracion(120)).toBe('2h')
  })
})
