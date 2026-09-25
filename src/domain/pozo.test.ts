import { describe, expect, it } from 'vitest'
import { calcularDerivadosPozo, debeAlertarPorFaltaDeMg, type PozoCompletacion } from './pozo'

function completacion(overrides: Partial<PozoCompletacion>): PozoCompletacion {
  return {
    id: 'c1',
    pozoId: 'p1',
    nbYacimiento: 'ARENA-1',
    coa: 'Abierto',
    metodo: 'GL',
    cat: 2,
    bnpd: 100,
    bnpdFecha: null,
    pot: 150,
    edo: null,
    ...overrides,
  }
}

describe('calcularDerivadosPozo', () => {
  it('un pozo con al menos una arena abierta queda como Abierto', () => {
    const d = calcularDerivadosPozo([
      completacion({ coa: 'Abierto', bnpd: 50 }),
      completacion({ coa: 'Cerrado', pot: 200 }),
    ])
    expect(d.estatus).toBe('Abierto')
    expect(d.bnpdActivo).toBe(50)
    expect(d.potencialDiferidoConfirmado).toBe(200)
  })

  it('un pozo con todas las arenas cerradas queda Cerrado', () => {
    const d = calcularDerivadosPozo([completacion({ coa: 'Cerrado', pot: 100 }), completacion({ coa: 'Cerrado', pot: 50 })])
    expect(d.estatus).toBe('Cerrado')
    expect(d.bnpdActivo).toBe(0)
    expect(d.potencialDiferidoConfirmado).toBe(150)
  })

  it('sin arenas abiertas ni cerradas (solo indeterminadas) queda Indeterminado', () => {
    const d = calcularDerivadosPozo([completacion({ coa: 'Indeterminado', pot: null })])
    expect(d.estatus).toBe('Indeterminado')
  })

  it('el diferido posible suma cerradas + indeterminadas; el confirmado solo cerradas', () => {
    const d = calcularDerivadosPozo([
      completacion({ coa: 'Cerrado', pot: 100 }),
      completacion({ coa: 'Indeterminado', pot: 40 }),
    ])
    expect(d.potencialDiferidoConfirmado).toBe(100)
    expect(d.potencialDiferidoPosible).toBe(140)
  })

  it('POT nulo en una arena cerrada marca el diferido como incompleto y no cuenta como 0 silenciosamente', () => {
    const d = calcularDerivadosPozo([completacion({ coa: 'Cerrado', pot: null }), completacion({ coa: 'Cerrado', pot: 80 })])
    expect(d.potencialDiferidoConfirmado).toBe(80)
    expect(d.diferidoIncompleto).toBe(true)
  })

  it('métodos y categorías se toman de las arenas abiertas cuando existen', () => {
    const d = calcularDerivadosPozo([
      completacion({ coa: 'Abierto', metodo: 'GL', cat: 2 }),
      completacion({ coa: 'Cerrado', metodo: 'BES', cat: 3 }),
    ])
    expect(d.metodos).toEqual(['GL'])
    expect(d.categorias).toEqual([2])
  })
})

describe('debeAlertarPorFaltaDeMg', () => {
  it('alerta si no tiene MG y alguna arena usa GL', () => {
    expect(debeAlertarPorFaltaDeMg(null, [completacion({ metodo: 'GL' })])).toBe(true)
  })

  it('no alerta si el método es BES, aunque no tenga MG', () => {
    expect(debeAlertarPorFaltaDeMg(null, [completacion({ metodo: 'BES' })])).toBe(false)
  })

  it('no alerta si ya tiene MG asignado', () => {
    expect(debeAlertarPorFaltaDeMg('mg-1', [completacion({ metodo: 'GL' })])).toBe(false)
  })
})
