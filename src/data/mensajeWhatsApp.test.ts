import { describe, it, expect } from 'vitest'
import { construirMensajeWhatsApp } from './mensajeWhatsApp'
import type { AsignacionRec } from '@/state/asignacionesStore'
import type { Cuadrilla } from '@/domain/cuadrilla'
import type { DetalleObjetivo } from '@/domain/detalleAsignacion'

const FECHA = '2026-09-24'

const asig = (over: Partial<AsignacionRec>): AsignacionRec => ({
  id: 'a1',
  fecha: FECHA,
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

const cuad = (id: string, nombre: string): Cuadrilla => ({ id, nombre, color: '#000', activa: true })

const mapa = (pares: [string, DetalleObjetivo][]) => new Map(pares)

describe('mensajeWhatsApp', () => {
  it('devuelve null si no hay pozos asignados ese día', () => {
    expect(construirMensajeWhatsApp(FECHA, [], [], new Map())).toBeNull()
    // Solo instalaciones → tampoco hay mensaje
    const a = asig({ objetivoId: 'inst|i1', codigo: 'EF-BA-17' })
    expect(construirMensajeWhatsApp(FECHA, [], [a], new Map())).toBeNull()
    // Otro día → null
    const b = asig({ fecha: '2026-09-25' })
    expect(construirMensajeWhatsApp(FECHA, [], [b], new Map())).toBeNull()
  })

  it('encabezado fijo: caja "Acciones Gerencia Técnica" + título con fecha corta', () => {
    const a = asig({})
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'Cuadrilla 3')], [a], mapa([['pozo|p1', det({})]]))!
    const lineas = msg.split('\n')
    expect(lineas[0]).toBe('`*Acciones Gerencia Técnica*`')
    expect(lineas[1]).toBe('*Plan de revision Productividad 24-sept-2026*')
  })

  it('campos: BA → Bachaquero Lago, VLG/VLC → Ceuta-Treco, Bachaquero primero', () => {
    const items = [
      asig({ id: 'a1', objetivoId: 'pozo|p1', codigo: 'VLG 3909' }),
      asig({ id: 'a2', objetivoId: 'pozo|p2', codigo: 'BA 1745' }),
    ]
    const detalles = mapa([
      ['pozo|p1', det({ campo: 'VLG' })],
      ['pozo|p2', det({ campo: 'BA' })],
    ])
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'Cuadrilla 3')], items, detalles)!
    expect(msg).toContain('*【Bachaquero Lago】*')
    expect(msg).toContain('*【Ceuta-Treco】*')
    expect(msg.indexOf('*【Bachaquero Lago】*')).toBeLessThan(msg.indexOf('*【Ceuta-Treco】*'))
  })

  it('cuadrilla se encabeza con 🚢 y "Cuadrilla: nombre"; huérfanas → Sin cuadrilla', () => {
    const items = [
      asig({ id: 'a1', objetivoId: 'pozo|p1', cuadrillaId: 'c1' }),
      asig({ id: 'a2', objetivoId: 'pozo|p2', codigo: 'BA 2', cuadrillaId: 'fantasma' }),
    ]
    const detalles = mapa([
      ['pozo|p1', det({})],
      ['pozo|p2', det({})],
    ])
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'Lago 7')], items, detalles)!
    expect(msg).toContain('🚢*`Cuadrilla: Lago 7`*')
    expect(msg).toContain('🚢*`Cuadrilla: Sin cuadrilla`*')
  })

  it('pozos GL/NF se agrupan por par MG/EF con 3 espacios y sombra en cada uno', () => {
    const items = [
      asig({ id: 'a1', objetivoId: 'pozo|p1', codigo: 'BA 1745', actividad: 'Medición' }),
      asig({ id: 'a2', objetivoId: 'pozo|p2', codigo: 'BA 2711', actividad: 'Medición' }),
    ]
    const detalles = mapa([
      ['pozo|p1', det({ metodos: ['GL'], mg: 'BA 1-02', ef: 'EF-BA-17', estatus: 'Cerrado' })],
      ['pozo|p2', det({ metodos: ['GL'], mg: 'BA 1-02', ef: 'EF-BA-17', estatus: 'Abierto' })],
    ])
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'C')], items, detalles)!
    expect(msg).toContain('*`BA 1-02`*   *`EF-BA-17`*')
    expect(msg).toContain('✓ Medición a los pozos: *BA 1745*, *BA 2711*')
  })

  it('pozos BES/BM/BCP se agrupan bajo el método, no por MG/EF', () => {
    const items = [
      asig({ id: 'a1', objetivoId: 'pozo|p1', codigo: 'BA 900', actividad: 'Medición' }),
      asig({ id: 'a2', objetivoId: 'pozo|p2', codigo: 'BA 912', actividad: 'Medición' }),
    ]
    const detalles = mapa([
      // BES con MG/EF distintos: igual deben quedar juntos bajo "BES"
      ['pozo|p1', det({ metodos: ['BES'], mg: 'BA 1-02', ef: 'EF-BA-17' })],
      ['pozo|p2', det({ metodos: ['BES'], mg: 'BA 9-09', ef: 'EF-BA-30' })],
    ])
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'C')], items, detalles)!
    expect(msg).toContain('*`BES`*')
    expect(msg).toContain('✓ Medición a los pozos: *BA 900*, *BA 912*')
    expect(msg).not.toContain('BA 1-02')
  })

  it('pozo sin método usa MG/EF; sin ninguno → "Sin EF/MG asociado"', () => {
    const items = [
      asig({ id: 'a1', objetivoId: 'pozo|p1', actividad: 'X' }),
      asig({ id: 'a2', objetivoId: 'pozo|p2', codigo: 'BA 2', actividad: 'X' }),
    ]
    const detalles = mapa([
      ['pozo|p1', det({ metodos: [], mg: 'BA 1-02' })],
      ['pozo|p2', det({ metodos: [] })],
    ])
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'C')], items, detalles)!
    expect(msg).toContain('*`BA 1-02`*')
    expect(msg).toContain('*`Sin EF/MG asociado`*')
  })

  it('pozos sin actividad van bajo "Actividad por definir" y los códigos salen sin bolita de estatus', () => {
    const items = [asig({ id: 'a1', objetivoId: 'pozo|p1' })]
    const detalles = mapa([['pozo|p1', det({ estatus: 'Indeterminado' })]])
    const msg = construirMensajeWhatsApp(FECHA, [cuad('c1', 'C')], items, detalles)!
    expect(msg).toContain('✓ Actividad por definir a los pozos: *BA 1*')
  })
})
