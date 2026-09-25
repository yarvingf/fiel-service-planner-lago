import { describe, it, expect } from 'vitest'
import { agruparCambiosLote } from './loteCambios'
import type { CamposAsignacion } from './persistencia'

describe('agruparCambiosLote — batching de ediciones pendientes', () => {
  it('vacío → sin grupos', () => {
    expect(agruparCambiosLote(new Map())).toEqual([])
  })

  it('filas con el mismo cambio comparten un solo grupo', () => {
    const cambios = new Map<string, CamposAsignacion>([
      ['a', { requiereNivel: true }],
      ['b', { requiereNivel: true }],
      ['c', { requiereNivel: true }],
    ])
    const grupos = agruparCambiosLote(cambios)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].ids.sort()).toEqual(['a', 'b', 'c'])
    expect(grupos[0].campos).toEqual({ requiereNivel: true })
  })

  it('cambios distintos generan grupos separados', () => {
    const cambios = new Map<string, CamposAsignacion>([
      ['a', { actividad: 'Medición' }],
      ['b', { actividad: 'Inspección' }],
      ['c', { actividad: 'Medición' }],
    ])
    const grupos = agruparCambiosLote(cambios)
    expect(grupos).toHaveLength(2)
    const medicion = grupos.find((g) => g.campos.actividad === 'Medición')!
    expect(medicion.ids.sort()).toEqual(['a', 'c'])
  })

  it('el orden de las keys del objeto no afecta la agrupación', () => {
    const cambios = new Map<string, CamposAsignacion>([
      ['a', { actividad: 'X', prioridad: 1 }],
      ['b', { prioridad: 1, actividad: 'X' }],
    ])
    const grupos = agruparCambiosLote(cambios)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].ids.sort()).toEqual(['a', 'b'])
  })

  it('null y false son valores distintos (no se fusionan)', () => {
    const cambios = new Map<string, CamposAsignacion>([
      ['a', { nota: null }],
      ['b', { nota: '' }],
    ])
    expect(agruparCambiosLote(cambios)).toHaveLength(2)
  })
})
