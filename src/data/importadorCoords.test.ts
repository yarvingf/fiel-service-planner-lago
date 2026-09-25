import { describe, it, expect } from 'vitest'
import { normalizarCoordenadas } from './importadorExcel'

describe('normalizarCoordenadas — saneo lat/lon del importador', () => {
  it('par válido dentro del lago pasa intacto', () => {
    expect(normalizarCoordenadas(10.2, -71.5)).toEqual({
      lat: 10.2,
      lon: -71.5,
      invertidas: false,
      fuera: false,
    })
  })

  it('par invertido se intercambia si el cruce cae dentro del rango', () => {
    // Columnas cambiadas: lat recibió el -71.5 y lon el 10.2
    expect(normalizarCoordenadas(-71.5, 10.2)).toEqual({
      lat: 10.2,
      lon: -71.5,
      invertidas: true,
      fuera: false,
    })
  })

  it('par fuera de rango sin remedio → descartado a null', () => {
    const r = normalizarCoordenadas(50, 50)
    expect(r.fuera).toBe(true)
    expect(r.lat).toBeNull()
    expect(r.lon).toBeNull()
  })

  it('faltantes pasan tal cual sin marcar error', () => {
    expect(normalizarCoordenadas(null, -71.5)).toEqual({
      lat: null,
      lon: -71.5,
      invertidas: false,
      fuera: false,
    })
    expect(normalizarCoordenadas(null, null).fuera).toBe(false)
  })
})
