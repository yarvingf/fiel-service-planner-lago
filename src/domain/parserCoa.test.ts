import { describe, it, expect } from 'vitest'
import { parsearMensajeCoa, extraerCodigosPozos } from './parserCoa'

// Casos portados de PozosA-C COA/test_parser.py y web/test.js (mismo comportamiento).
const MENSAJE =
  '🟢 VLG3301A produccion\n' +
  '🔴 VLC 1234\n' +
  '🟢 BA 11A\n' +
  '🔴 BA-11\n' +
  '🟢 BA- 235\n' +
  '🔴 BA235X extra\n' +
  '🟢 VLG3301B otra cosa\n' +
  'linea sin pozo\n' +
  '🟢 BA 793 - 300\n' +
  '🔴 BA 793A - 300\n' +
  '🟢 BA 793 A\n' +
  '🔴 BA 1075A\n' +
  '🟢 BA1075\n' +
  '🔴 BA 12345A'

describe('parsearMensajeCoa', () => {
  it('extrae y normaliza pozos con su estatus (casos del módulo original)', () => {
    const r = parsearMensajeCoa(MENSAJE)
    const mapa = new Map(r.map((p) => [p.codigo, p.estatus]))

    expect(mapa.get('VLG3301A')).toBe('Abierto')
    expect(mapa.get('VLC1234')).toBe('Cerrado')
    expect(mapa.get('BA 011A')).toBe('Abierto')
    expect(mapa.get('BA 0011')).toBe('Cerrado')
    expect(mapa.get('BA 0235')).toBe('Abierto')   // "BA- 235"
    expect(mapa.get('BA 235X')).toBe('Cerrado')   // "BA235X": letra pegada cuenta aunque no sea A-D
    expect(mapa.get('VLG3301B')).toBe('Abierto')
    expect(mapa.get('BA 0793')).toBe('Abierto')  // "BA 793 - 300" corta en el guion
    expect(mapa.get('BA 793A')).toBe('Cerrado')  // "BA 793A - 300"
    expect(mapa.get('BA 1075')).toBe('Abierto')  // "BA1075"
    expect(mapa.get('BA 1075A')).toBe('Cerrado')
    expect(mapa.get('BA 12345A')).toBe('Cerrado') // 4+ dígitos: la letra no se recorta
    // "BA 793 A": la letra suelta no cuenta → BA 0793, ya visto → dedup.
    expect(r.filter((p) => p.codigo === 'BA 0793')).toHaveLength(1)
  })

  it('ignora líneas que no empiezan con 🟢/🔴', () => {
    const r = parsearMensajeCoa(
      'VLG9999 sin icono se ignora\n' +
      'texto con 🟢 en el medio BA77, se ignora\n' +
      '   🔴 BA 0050\n',
    )
    expect(r).toEqual([{ codigo: 'BA 0050', estatus: 'Cerrado' }])
  })

  it('la primera aparición gana si el pozo se repite con otro estatus', () => {
    const r = parsearMensajeCoa('🟢 BA 0050\n🔴 BA 0050\n')
    expect(r).toEqual([{ codigo: 'BA 0050', estatus: 'Abierto' }])
  })

  it('sin iconos válidos devuelve lista vacía', () => {
    expect(parsearMensajeCoa('mensaje cualquiera BA 345')).toEqual([])
  })
})

describe('extraerCodigosPozos (lista libre)', () => {
  it('extrae códigos de cualquier línea, sin exigir 🟢/🔴', () => {
    const r = extraerCodigosPozos(
      'BA 2644, BA-11\n' +
      'VLG3301A y VLC 1234\n' +
      'fila copiada de excel\tBA 0050\n' +
      '🟢 BA 1075A\n' +
      'texto sin pozos\n',
    )
    expect(r).toEqual(['BA 2644', 'BA 0011', 'VLG3301A', 'VLC1234', 'BA 0050', 'BA 1075A'])
  })

  it('deduplica conservando el orden y no detecta números sueltos', () => {
    const r = extraerCodigosPozos('BA 0050\n2644\nBA 0050 otra vez\n12345\n')
    expect(r).toEqual(['BA 0050'])
  })
})
