import { create } from 'zustand'
import type { PozoConCompletaciones } from '@/domain/pozo'
import type { Instalacion } from '@/domain/instalacion'
import type { AlertaImport } from '@/domain/alertasImport'
import type { VisitaCampo } from '@/domain/visitaCampo'
import { importarExcel } from '@/data/importadorExcel'
import { importarCsvPozos } from '@/data/importadorCsv'
import { calcularDiff, type DiffUniverso } from '@/data/sincronizarUniverso'
import { obtenerUniverso, aplicarDiffUniverso, actualizarCoaCompletaciones } from '@/data/persistencia'
import { supabase } from '@/data/supabaseClient'

export interface Seleccion {
  kind: 'pozo' | 'instalacion'
  id: string
}

/** Diff calculado y a la espera de confirmación del usuario (preview en modal). */
export interface SincronizacionPendiente {
  diff: DiffUniverso
  archivo: string
  nAlertas: number
  alertas: AlertaImport[]
  /** Universo nuevo completo — se aplica tal cual si el usuario confirma. */
  pozos: PozoConCompletaciones[]
  instalaciones: Instalacion[]
  visitas: VisitaCampo[]
}

interface EstadoDatos {
  pozos: PozoConCompletaciones[]
  instalaciones: Instalacion[]
  /** Bitácora de visitas GL/BES — no se muestra en el mapa, solo "última visita" en el detalle del pozo. */
  visitas: VisitaCampo[]
  alertas: AlertaImport[]
  cargando: boolean
  error: string | null
  /** Incrementa en cada carga/sync; el mapa lo usa para saber que debe re-sincronizar. */
  versionDatos: number
  seleccionado: Seleccion | null
  /** Diff pendiente de confirmación (preview) — no null mientras el modal está abierto. */
  sincPendiente: SincronizacionPendiente | null
  sincronizando: boolean
  /** Carga el universo ya persistido en Supabase (arranque de la app). */
  cargarDesdeSupabase: () => Promise<void>
  /** Punto de entrada del botón Importar: parsea el archivo y calcula el diff contra Supabase, sin escribir aún. */
  prepararSincronizacion: (file: File) => Promise<void>
  /** Aplica el diff calculado por prepararSincronizacion y recarga desde Supabase. */
  confirmarSincronizacion: () => Promise<void>
  cancelarSincronizacion: () => void
  /**
   * Aplica el estatus reportado por un mensaje COA: marca TODAS las
   * completaciones de cada pozo con el estatus dado, lo persiste en Supabase
   * con coa_origen='mensaje' y actualiza el estado local (recolorea el mapa).
   * Devuelve false si la base rechazó (el motivo queda en `error`).
   */
  aplicarEstatusCoa: (cambios: { pozoId: string; estatus: 'Abierto' | 'Cerrado' }[]) => Promise<boolean>
  seleccionar: (s: Seleccion | null) => void
}

export const useDatosStore = create<EstadoDatos>((set, get) => ({
  pozos: [],
  instalaciones: [],
  visitas: [],
  alertas: [],
  cargando: false,
  error: null,
  versionDatos: 0,
  seleccionado: null,
  sincPendiente: null,
  sincronizando: false,

  cargarDesdeSupabase: async () => {
    if (!supabase) return
    set({ cargando: true, error: null })
    try {
      const { pozos, instalaciones, visitas } = await obtenerUniverso()
      set((s) => ({ pozos, instalaciones, visitas, cargando: false, versionDatos: s.versionDatos + 1 }))
    } catch (e) {
      set({ cargando: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  prepararSincronizacion: async (file) => {
    set({ cargando: true, error: null })
    try {
      const esCsv = file.name.toLowerCase().endsWith('.csv')
      // El CSV solo trae la hoja Pozos — sin visitas GL/BES, se conservan
      // las ya cargadas (el diff las compara igual, sin verse afectadas).
      let pozos: PozoConCompletaciones[], instalaciones: Instalacion[], visitas: VisitaCampo[], alertas: AlertaImport[]
      if (esCsv) {
        const r = importarCsvPozos(await file.text(), get().instalaciones)
        pozos = r.pozos
        alertas = r.alertas
        instalaciones = get().instalaciones
        visitas = get().visitas
      } else {
        const r = await importarExcel(await file.arrayBuffer())
        pozos = r.pozos
        instalaciones = r.instalaciones
        visitas = r.visitas
        alertas = r.alertas
      }
      // El diff se calcula SIEMPRE contra el estado real de Supabase, nunca
      // contra el store local: si la app cayó al fallback de desarrollo
      // (Excel local en memoria, sin persistir) o si otro planificador ya
      // sincronizó algo, comparar contra `get().pozos` mostraría "0 nuevos"
      // de forma engañosa y el upsert de completaciones referenciaría pozos
      // que en realidad no existen en la base (viola la FK).
      const actual = supabase
        ? await obtenerUniverso()
        : { pozos: get().pozos, instalaciones: get().instalaciones, visitas: get().visitas }
      const diff = calcularDiff({ pozos, instalaciones, visitas }, actual)
      set({
        cargando: false,
        sincPendiente: { diff, archivo: file.name, nAlertas: alertas.length, alertas, pozos, instalaciones, visitas },
      })
    } catch (e) {
      set({ cargando: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  confirmarSincronizacion: async () => {
    const pend = get().sincPendiente
    if (!pend) return
    set({ sincronizando: true, error: null })
    try {
      if (supabase) {
        await aplicarDiffUniverso(
          pend.diff,
          { pozos: pend.pozos, instalaciones: pend.instalaciones, visitas: pend.visitas },
          pend.archivo,
          pend.nAlertas,
        )
      }
      set((s) => ({
        pozos: pend.pozos,
        instalaciones: pend.instalaciones,
        visitas: pend.visitas,
        alertas: pend.alertas,
        sincPendiente: null,
        sincronizando: false,
        versionDatos: s.versionDatos + 1,
      }))
    } catch (e) {
      set({ sincronizando: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  cancelarSincronizacion: () => set({ sincPendiente: null }),

  aplicarEstatusCoa: async (cambios) => {
    const porPozo = new Map(cambios.map((c) => [c.pozoId, c.estatus]))
    // Ids de completaciones afectadas, agrupadas por estatus destino:
    // un UPDATE ... IN por grupo en vez de una escritura por pozo.
    const idsPorEstatus = new Map<'Abierto' | 'Cerrado', string[]>()
    for (const p of get().pozos) {
      const est = porPozo.get(p.id)
      if (!est) continue
      for (const c of p.completaciones) {
        const arr = idsPorEstatus.get(est) ?? []
        arr.push(c.id)
        idsPorEstatus.set(est, arr)
      }
    }
    if (idsPorEstatus.size === 0) return true
    set({ error: null })
    try {
      if (supabase) {
        await Promise.all(
          [...idsPorEstatus.entries()].map(([est, ids]) => actualizarCoaCompletaciones(ids, est)),
        )
      }
      set((st) => ({
        pozos: st.pozos.map((p) =>
          porPozo.has(p.id)
            ? { ...p, completaciones: p.completaciones.map((c) => ({ ...c, coa: porPozo.get(p.id)! })) }
            : p,
        ),
        versionDatos: st.versionDatos + 1,
      }))
      return true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return false
    }
  },

  seleccionar: (s) => set({ seleccionado: s }),
}))

/**
 * Carga en dev el Excel real colocado en public/ (gitignored) directo a
 * memoria, sin pasar por Supabase — atajo para iterar sin depender de la
 * base. En producción los datos vienen de `cargarDesdeSupabase`.
 */
export async function cargarExcelDev(): Promise<void> {
  if (!import.meta.env.DEV) return
  try {
    const res = await fetch('/Excel%20Data.xlsx')
    if (!res.ok) return
    const { pozos, instalaciones, visitas, alertas } = await importarExcel(await res.arrayBuffer())
    useDatosStore.setState((s) => ({ pozos, instalaciones, visitas, alertas, versionDatos: s.versionDatos + 1 }))
  } catch {
    // Sin archivo local: el mapa arranca vacío y los datos vendrán de Supabase.
  }
}
