import { describe, it, expect } from 'vitest'
import { compararPlan } from './exportarPlanExcel'
import { etiquetaCampo } from '@/domain/detalleAsignacion'
import type { AsignacionRec } from '@/state/asignacionesStore'
import type { DetalleObjetivo } from '@/domain/detalleAsignacion'
import type { Campo } from '@/domain/codigos'

const asig = (over: Partial<AsignacionRec>): AsignacionRec => ({
  id: Math.random().toString(36).slice(2),
  fecha: '2026-09-24',
  objetivoId: 'pozo|p1',
  codigo: 'BA 1',
  cuadrillaId: 'c1',
  actividad: null,
  nota: null,
  prioridad: null,
  validarAjuste: false,
  requiereManometro: false,
  requiereNivel: false,
  ...over,
})

const det = (over: Partial<DetalleObjetivo>): DetalleObjetivo => ({
  tipo: 'pozo',
  ef: '',
  mg: '',
  pot: null,
  bnpd: null,
  campo: 'BA',
  estatus: 'Abierto',
  metodos: [],
  ...over,
})

/** Ordena con el comparador y devuelve los códigos resultantes. */
const ordenCodigos = (items: AsignacionRec[], detalles: Map<string, DetalleObjetivo>) =>
  [...items].sort((a, b) => compararPlan(a, b, detalles)).map((a) => a.codigo)

describe('compararPlan — orden del Excel', () => {
  it('prioridad ascendente primero; sin prioridad al final', () => {
    const items = [
      asig({ codigo: 'SIN', prioridad: null }),
      asig({ codigo: 'P3', prioridad: 3 }),
      asig({ codigo: 'P1', prioridad: 1 }),
    ]
    expect(ordenCodigos(items, new Map())).toEqual(['P1', 'P3', 'SIN'])
  })

  it('a igual prioridad ordena por método, luego actividad, luego MG', () => {
    const items = [
      asig({ codigo: 'X', objetivoId: 'pozo|x', prioridad: 1, actividad: 'B' }),
      asig({ codigo: 'Y', objetivoId: 'pozo|y', prioridad: 1, actividad: 'A' }),
      asig({ codigo: 'Z', objetivoId: 'pozo|z', prioridad: 1, actividad: 'A' }),
    ]
    const detalles = new Map([
      ['pozo|x', det({ metodos: ['GL'], mg: 'MG2' })],
      ['pozo|y', det({ metodos: ['GL'], mg: 'MG9' })],
      // Z es BES → va antes que los GL a igual actividad/prioridad
      ['pozo|z', det({ metodos: ['BES'] })],
    ])
    expect(ordenCodigos(items, detalles)).toEqual(['Z', 'Y', 'X'])
  })

  it('a igual todo lo demás: BNPD descendente y código como desempate final', () => {
    const items = [
      asig({ codigo: 'BA 2', objetivoId: 'pozo|b2', prioridad: 1, actividad: 'A' }),
      asig({ codigo: 'BA 1', objetivoId: 'pozo|b1', prioridad: 1, actividad: 'A' }),
      asig({ codigo: 'BA 3', objetivoId: 'pozo|b3', prioridad: 1, actividad: 'A' }),
    ]
    const detalles = new Map([
      ['pozo|b2', det({ metodos: ['GL'], mg: 'M', bnpd: 50 })],
      ['pozo|b1', det({ metodos: ['GL'], mg: 'M', bnpd: 200 })],
      ['pozo|b3', det({ metodos: ['GL'], mg: 'M', bnpd: 200 })],
    ])
    // BA 1 (200) y BA 3 (200) antes que BA 2 (50); empate → código
    expect(ordenCodigos(items, detalles)).toEqual(['BA 1', 'BA 3', 'BA 2'])
  })
})

describe('etiquetaCampo — convención de campos', () => {
  const etiqueta = (...campos: Campo[]) => etiquetaCampo(new Set(campos))

  it('sin pozos → vacío', () => expect(etiqueta()).toBe(''))
  it('solo VLG, solo VLC o VLG+VLC → Ceuta-Treco', () => {
    expect(etiqueta('VLG')).toBe('Ceuta-Treco')
    expect(etiqueta('VLC')).toBe('Ceuta-Treco')
    expect(etiqueta('VLC', 'VLG')).toBe('Ceuta-Treco')
  })
  it('solo BA → Bachaquero Lago', () => expect(etiqueta('BA')).toBe('Bachaquero Lago'))
  it('BA mezclado con VLC o VLG → etiqueta combinada', () => {
    expect(etiqueta('BA', 'VLC')).toBe('Ceuta-Treco & Bachaquero Lago')
    expect(etiqueta('BA', 'VLG')).toBe('Ceuta-Treco & Bachaquero Lago')
    expect(etiqueta('BA', 'VLC', 'VLG')).toBe('Ceuta-Treco & Bachaquero Lago')
  })
})
