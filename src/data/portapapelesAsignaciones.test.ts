import { describe, it, expect } from 'vitest'
import { PARSEO_PEGADO, COPIA_PEGADO } from './portapapelesAsignaciones'

describe('portapapeles: parseo de pegado (Ctrl+V)', () => {
  it('texto: recorta y vacío → null (limpia el campo)', () => {
    expect(PARSEO_PEGADO.actividad('  Medición  ')).toEqual({ campo: 'actividad', valor: 'Medición' })
    expect(PARSEO_PEGADO.actividad('   ')).toEqual({ campo: 'actividad', valor: null })
    expect(PARSEO_PEGADO.nota('obs')).toEqual({ campo: 'nota', valor: 'obs' })
  })

  it('prioridad: enteros, vacío limpia, texto inválido se salta', () => {
    expect(PARSEO_PEGADO.prioridad('3')).toEqual({ campo: 'prioridad', valor: 3 })
    expect(PARSEO_PEGADO.prioridad('2.7')).toEqual({ campo: 'prioridad', valor: 2 })
    expect(PARSEO_PEGADO.prioridad('')).toEqual({ campo: 'prioridad', valor: null })
    expect(PARSEO_PEGADO.prioridad('alta')).toBeNull()
  })

  it('toggles SI/NO aceptan variantes y vacío = NO', () => {
    for (const v of ['SI', 'si', 'sí', '1', 'x', 'true']) {
      expect(PARSEO_PEGADO.validarAjuste(v)).toEqual({ campo: 'validarAjuste', valor: true })
    }
    for (const v of ['NO', 'no', '0', 'false', '']) {
      expect(PARSEO_PEGADO.requiereNivel(v)).toEqual({ campo: 'requiereNivel', valor: false })
    }
    expect(PARSEO_PEGADO.requiereManometro('quizás')).toBeNull()
  })

  it('copiar toggles produce SI/NO re-pegable', () => {
    expect(COPIA_PEGADO.validarAjuste(1)).toBe('SI')
    expect(COPIA_PEGADO.validarAjuste(0)).toBe('NO')
    // Round-trip: lo que copia se puede pegar de vuelta
    expect(PARSEO_PEGADO.validarAjuste(COPIA_PEGADO.validarAjuste(1))).toEqual({
      campo: 'validarAjuste',
      valor: true,
    })
  })
})
