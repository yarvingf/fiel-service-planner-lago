import { describe, expect, it } from 'vitest'
import {
  claveNormalizadaEF,
  claveNormalizadaInstalacion,
  claveNormalizadaMG,
  clavePozoFisico,
  compararReemplazo,
  elegirActivo,
  esValorNulo,
  parsearCodigoPozo,
} from './codigos'

describe('parsearCodigoPozo', () => {
  it('parsea un pozo BA con relleno de ceros y sin reemplazo', () => {
    expect(parsearCodigoPozo('BA 0345', 'BA')).toEqual({
      campo: 'BA',
      numero: 345,
      reemplazo: null,
      codigoOriginal: 'BA 0345',
    })
  })

  it('parsea un pozo BA de 3 dígitos con letra de reemplazo (sin relleno de cero)', () => {
    expect(parsearCodigoPozo('BA 345A', 'BA')).toEqual({
      campo: 'BA',
      numero: 345,
      reemplazo: 'A',
      codigoOriginal: 'BA 345A',
    })
  })

  it('BA 0345 y BA 345A son el mismo pozo físico, distinto reemplazo', () => {
    const original = parsearCodigoPozo('BA 0345', 'BA')!
    const reemplazo = parsearCodigoPozo('BA 345A', 'BA')!
    expect(clavePozoFisico(original)).toBe(clavePozoFisico(reemplazo))
  })

  it('parsea un pozo VLG sin espacio entre prefijo y número', () => {
    expect(parsearCodigoPozo('VLG3804C', 'VLG')).toEqual({
      campo: 'VLG',
      numero: 3804,
      reemplazo: 'C',
      codigoOriginal: 'VLG3804C',
    })
  })

  it('rechaza un código que no calza con el patrón del campo', () => {
    expect(parsearCodigoPozo('XX 1234', 'BA')).toBeNull()
    expect(parsearCodigoPozo('VLC1234', 'VLG')).toBeNull()
  })
})

describe('elegirActivo / compararReemplazo', () => {
  it('el pozo sin letra es menor que cualquier reemplazo', () => {
    expect(compararReemplazo(null, 'A')).toBeLessThan(0)
  })

  it('elige la letra más alta como pozo activo', () => {
    const filas = [{ reemplazo: null }, { reemplazo: 'A' as const }, { reemplazo: 'B' as const }]
    expect(elegirActivo(filas).reemplazo).toBe('B')
  })

  it('si solo existe el original, ese es el activo', () => {
    const filas = [{ reemplazo: null }]
    expect(elegirActivo(filas).reemplazo).toBeNull()
  })
})

describe('cruce de códigos EF/MG contra Instalaciones', () => {
  it('EF corto de BA se cruza anteponiendo el prefijo EF-', () => {
    expect(claveNormalizadaEF('BA-17')).toBe(claveNormalizadaInstalacion('EF-BA-17'))
  })

  it('EF de VLC/VLG/VLD ya viene completo, se compara directo', () => {
    expect(claveNormalizadaEF('VLC-27-3')).toBe(claveNormalizadaInstalacion('VLC-27-3'))
  })

  it('MG de BA cruza directo tras las correcciones del usuario (sin prefijo MLAG-)', () => {
    expect(claveNormalizadaMG('BA 1-02')).toBe(claveNormalizadaInstalacion('BA 1-02'))
  })

  it('MG con formato LGT se compara directo', () => {
    expect(claveNormalizadaMG('LGT-14/3B')).toBe(claveNormalizadaInstalacion('LGT-14/3B'))
  })

  it('la normalización ignora espacios, guiones y mayúsculas inconsistentes del catálogo', () => {
    expect(claveNormalizadaMG('BA 1-36')).toBe(claveNormalizadaInstalacion('BA -1-36'))
    expect(claveNormalizadaMG('BA 1-40')).toBe(claveNormalizadaInstalacion('BA -1-40'))
  })
})

describe('esValorNulo', () => {
  it('reconoce NOLINEA como ausencia de MG, no como código faltante', () => {
    expect(esValorNulo('NOLINEA')).toBe(true)
    expect(esValorNulo('nolinea')).toBe(true)
  })

  it('celda vacía también cuenta como nula', () => {
    expect(esValorNulo(null)).toBe(true)
    expect(esValorNulo(undefined)).toBe(true)
    expect(esValorNulo('')).toBe(true)
  })

  it('un código real no es nulo', () => {
    expect(esValorNulo('BA 1-02')).toBe(false)
  })
})
