import { describe, expect, it } from 'vitest'
import { calcularDiff, type Universo } from './sincronizarUniverso'
import type { Instalacion } from '@/domain/instalacion'
import type { PozoCompletacion, PozoConCompletaciones } from '@/domain/pozo'
import type { VisitaCampo } from '@/domain/visitaCampo'

const visita = (over: Partial<VisitaCampo> = {}): VisitaCampo => ({
  id: 'visita-GL|2026-01-01|BA 1|1',
  tipo: 'GL',
  fecha: new Date('2026-01-01'),
  pozoTexto: 'BA 1',
  pozoId: 'pozo-BA_1',
  cuadrilla: '1',
  campo: 'BA',
  tipoActividad: 'Toma de parámetros',
  estadoInicial: 'Aportando',
  estadoFinal: 'Aportando',
  comentarios: null,
  horaInicio: null,
  horaFin: null,
  datosExtra: {},
  ...over,
})

const inst = (id: string, over: Partial<Instalacion> = {}): Instalacion => ({
  id,
  tipo: 'EF',
  codigo: `EF-${id}`,
  campo: 'BA',
  lat: 9.9,
  lon: -71.5,
  esStub: false,
  activo: true,
  ...over,
})

const comp = (pozoId: string, yac: string, over: Partial<PozoCompletacion> = {}): PozoCompletacion => ({
  id: `${pozoId}#0`,
  pozoId,
  nbYacimiento: yac,
  coa: 'Abierto',
  metodo: 'BES',
  cat: null,
  bnpd: 100,
  bnpdFecha: null,
  pot: null,
  edo: null,
  ...over,
})

const pozo = (id: string, over: Partial<PozoConCompletaciones> = {}): PozoConCompletaciones => ({
  id,
  campo: 'BA',
  numero: 1,
  reemplazo: null,
  codigo: id.replace('pozo-', '').replace(/_/g, ' '),
  lat: 9.9,
  lon: -71.5,
  efId: 'inst-ef1',
  mgId: null,
  pcId: null,
  pbesId: null,
  reemplazado: false,
  activo: true,
  completaciones: [],
  ...over,
})

const vacio: Universo = { instalaciones: [], pozos: [], visitas: [] }

describe('calcularDiff', () => {
  it('universo vacío en la base → todo es nuevo', () => {
    const nuevo: Universo = {
      instalaciones: [inst('inst-ef1')],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1')] })],
      visitas: [],
    }
    const d = calcularDiff(nuevo, vacio)
    expect(d.instNuevas).toHaveLength(1)
    expect(d.pozosNuevos).toHaveLength(1)
    expect(d.compsNuevas).toHaveLength(1)
    expect(d.vacio).toBe(false)
  })

  it('universos idénticos → diff vacío', () => {
    const u: Universo = {
      instalaciones: [inst('inst-ef1')],
      pozos: [pozo('pozo-BA_1', { efId: 'inst-ef1', completaciones: [comp('pozo-BA_1', 'A1')] })],
      visitas: [visita()],
    }
    const d = calcularDiff(u, u)
    expect(d.vacio).toBe(true)
    expect(d.cambios).toHaveLength(0)
  })

  it('detecta cambio de estatus COA en una completación', () => {
    const previo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1', { coa: 'Abierto' })] })],
      visitas: [],
    }
    const nuevo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1', { coa: 'Cerrado', pot: 80 })] })],
      visitas: [],
    }
    const d = calcularDiff(nuevo, previo)
    expect(d.compsActualizadas).toHaveLength(1)
    const campos = d.compsActualizadas[0].campos.map((c) => c.campo)
    expect(campos).toContain('COA')
    expect(campos).toContain('POT')
  })

  it('detecta cambio de EF del pozo', () => {
    const previo: Universo = {
      instalaciones: [inst('inst-ef1'), inst('inst-ef2')],
      pozos: [pozo('pozo-BA_1', { efId: 'inst-ef1' })],
      visitas: [],
    }
    const nuevo: Universo = {
      instalaciones: [inst('inst-ef1'), inst('inst-ef2')],
      pozos: [pozo('pozo-BA_1', { efId: 'inst-ef2' })],
      visitas: [],
    }
    const d = calcularDiff(nuevo, previo)
    expect(d.pozosActualizados).toHaveLength(1)
    expect(d.pozosActualizados[0].campos[0]).toEqual({
      campo: 'EF', antes: 'inst-ef1', despues: 'inst-ef2',
    })
  })

  it('pozo que deja de venir → desactivado; sus arenas NO se eliminan', () => {
    const previo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1')] })],
      visitas: [],
    }
    const d = calcularDiff(vacio, previo)
    expect(d.pozosDesactivados).toHaveLength(1)
    expect(d.compsEliminadas).toHaveLength(0)
  })

  it('arena que desaparece (pozo sigue) → completación eliminada', () => {
    const previo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', {
        completaciones: [comp('pozo-BA_1', 'A1'), comp('pozo-BA_1', 'A2', { id: 'pozo-BA_1#1' })],
      })],
      visitas: [],
    }
    const nuevo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1')] })],
      visitas: [],
    }
    const d = calcularDiff(nuevo, previo)
    expect(d.compsEliminadas).toHaveLength(1)
    expect(d.compsEliminadas[0].nbYacimiento).toBe('A2')
  })

  it('instalación inactiva que reaparece → actualizada con campo activo', () => {
    const previo: Universo = { instalaciones: [inst('inst-ef1', { activo: false })], pozos: [], visitas: [] }
    const nuevo: Universo = { instalaciones: [inst('inst-ef1')], pozos: [], visitas: [] }
    const d = calcularDiff(nuevo, previo)
    expect(d.instActualizadas).toHaveLength(1)
    expect(d.instActualizadas[0].campos[0].campo).toBe('activo')
    expect(d.instDesactivadas).toHaveLength(0)
  })

  it('comp clavea por (pozo_id, nb_yacimiento), no por id posicional', () => {
    const previo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1', { id: 'pozo-BA_1#0' })] })],
      visitas: [],
    }
    // Misma arena pero el importador le dio otro índice → no es "nuevo".
    const nuevo: Universo = {
      instalaciones: [],
      pozos: [pozo('pozo-BA_1', { completaciones: [comp('pozo-BA_1', 'A1', { id: 'pozo-BA_1#5' })] })],
      visitas: [],
    }
    const d = calcularDiff(nuevo, previo)
    expect(d.compsNuevas).toHaveLength(0)
    expect(d.compsActualizadas).toHaveLength(0)
  })

  it('visita nueva se detecta por su llave de negocio (tipo+fecha+pozo+cuadrilla)', () => {
    const d = calcularDiff({ instalaciones: [], pozos: [], visitas: [visita()] }, vacio)
    expect(d.visitasNuevas).toHaveLength(1)
    expect(d.vacio).toBe(false)
  })

  it('visita existente corregida (comentarios) → actualizada, no duplicada', () => {
    const previo: Universo = { instalaciones: [], pozos: [], visitas: [visita({ comentarios: null })] }
    const nuevo: Universo = { instalaciones: [], pozos: [], visitas: [visita({ comentarios: 'Se ajustó gas' })] }
    const d = calcularDiff(nuevo, previo)
    expect(d.visitasNuevas).toHaveLength(0)
    expect(d.visitasActualizadas).toHaveLength(1)
    expect(d.visitasActualizadas[0].campos).toEqual([
      { campo: 'comentarios', antes: null, despues: 'Se ajustó gas' },
    ])
  })

  it('visita idéntica → no genera cambios', () => {
    const u: Universo = { instalaciones: [], pozos: [], visitas: [visita()] }
    const d = calcularDiff(u, u)
    expect(d.visitasNuevas).toHaveLength(0)
    expect(d.visitasActualizadas).toHaveLength(0)
    expect(d.vacio).toBe(true)
  })

  it('datosExtra con mismas claves en distinto orden NO cuenta como cambio (JSONB no preserva orden)', () => {
    const previo: Universo = {
      instalaciones: [], pozos: [],
      visitas: [visita({ datosExtra: { EF: 'VLG 10-7', MG: 'LGT 30/7', BNPD: 235 } })],
    }
    const nuevo: Universo = {
      instalaciones: [], pozos: [],
      // Mismo contenido, orden de inserción distinto (como devuelve Postgres/JSONB).
      visitas: [visita({ datosExtra: { BNPD: 235, EF: 'VLG 10-7', MG: 'LGT 30/7' } })],
    }
    const d = calcularDiff(nuevo, previo)
    expect(d.visitasActualizadas).toHaveLength(0)
    expect(d.vacio).toBe(true)
  })

  it('datosExtra con un valor realmente distinto sí se detecta', () => {
    const previo: Universo = {
      instalaciones: [], pozos: [],
      visitas: [visita({ datosExtra: { BNPD: 235 } })],
    }
    const nuevo: Universo = {
      instalaciones: [], pozos: [],
      visitas: [visita({ datosExtra: { BNPD: 240 } })],
    }
    const d = calcularDiff(nuevo, previo)
    expect(d.visitasActualizadas).toHaveLength(1)
  })

  it('visita que ya no viene en el Excel no se toca (bitácora solo crece)', () => {
    const previo: Universo = { instalaciones: [], pozos: [], visitas: [visita()] }
    const d = calcularDiff(vacio, previo)
    expect(d.visitasNuevas).toHaveLength(0)
    expect(d.visitasActualizadas).toHaveLength(0)
    expect(d.vacio).toBe(true)
  })
})
