import { describe, it, expect } from 'vitest'
import { filaACuadrilla, filaAAsignacion } from './persistencia'

describe('persistencia: mapeo fila → modelo de app', () => {
  it('cuadrilla conserva id uuid, nombre, color y activa', () => {
    const c = filaACuadrilla({
      id: 'a3f1c2d4-0000-4000-8000-000000000001',
      nombre: 'Cuadrilla Norte',
      color: '#2563eb',
      activa: true,
      creado_en: '2025-01-10T12:00:00Z',
    })
    expect(c).toEqual({
      id: 'a3f1c2d4-0000-4000-8000-000000000001',
      nombre: 'Cuadrilla Norte',
      color: '#2563eb',
      activa: true,
    })
  })

  it('asignación devuelve el objetivo_id tal cual para round-trip con la UI', () => {
    const a = filaAAsignacion({
      id: 'b8e2d3f4-0000-4000-8000-000000000002',
      fecha: '2025-01-15',
      cuadrilla_id: 'a3f1c2d4-0000-4000-8000-000000000001',
      objetivo_id: 'pozo|pozo-BA_0345',
      objetivo_codigo: 'BA 0345',
      actividad: 'Medición',
      nota: null,
      prioridad: 2,
      validar_ajuste: true,
      requiere_manometro: false,
      requiere_nivel: true,
      asignado_por: 'c9f3e4a5-0000-4000-8000-000000000003',
      creado_en: '2025-01-10T12:00:00Z',
    })
    expect(a.id).toBe('b8e2d3f4-0000-4000-8000-000000000002')
    expect(a.fecha).toBe('2025-01-15')
    expect(a.objetivoId).toBe('pozo|pozo-BA_0345')
    expect(a.codigo).toBe('BA 0345')
    expect(a.cuadrillaId).toBe('a3f1c2d4-0000-4000-8000-000000000001')
    expect(a.actividad).toBe('Medición')
    expect(a.nota).toBeNull()
    expect(a.prioridad).toBe(2)
    expect(a.validarAjuste).toBe(true)
    expect(a.requiereManometro).toBe(false)
    expect(a.requiereNivel).toBe(true)
  })

  it('asignación de instalación round-trips igual que la de pozo', () => {
    const a = filaAAsignacion({
      id: 'b8e2d3f4-0000-4000-8000-000000000004',
      fecha: '2025-01-15',
      cuadrilla_id: 'a3f1c2d4-0000-4000-8000-000000000001',
      objetivo_id: 'inst|inst-EFBA17',
      objetivo_codigo: 'EF-BA-17',
      actividad: null,
      nota: 'Revisar válvula',
      prioridad: null,
      validar_ajuste: false,
      requiere_manometro: false,
      requiere_nivel: false,
      asignado_por: 'c9f3e4a5-0000-4000-8000-000000000003',
      creado_en: '2025-01-10T12:00:00Z',
    })
    expect(a.objetivoId.startsWith('inst|')).toBe(true)
    expect(a.codigo).toBe('EF-BA-17')
    expect(a.nota).toBe('Revisar válvula')
  })
})
