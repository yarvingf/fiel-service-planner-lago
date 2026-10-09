import { create } from 'zustand'
import type { PozoConCompletaciones } from '@/domain/pozo'
import type { Instalacion } from '@/domain/instalacion'
import type { AlertaImport } from '@/domain/alertasImport'
import { ultimaVisitaPorPozo, type VisitaCampo } from '@/domain/visitaCampo'
import { calcularIndicadores, type IndicadorPozo } from '@/domain/indicadores'
import { importarExcel } from '@/data/importadorExcel'
import { importarCsvPozos } from '@/data/importadorCsv'
import { calcularDiff, type DiffUniverso } from '@/data/sincronizarUniverso'
import { obtenerUniverso, aplicarDiffUniverso, actualizarCoaCompletaciones, listarIndicadores } from '@/data/persistencia'
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
  /** Indicadores derivados de `visitas` — se persisten juntos al confirmar. */
  indicadores: IndicadorPozo[]
}

interface EstadoDatos {
  pozos: PozoConCompletaciones[]
  instalaciones: Instalacion[]
  /**
   * Última visita GL/BES por pozo (NO el historial completo — el arranque
   * solo consume esa; el historial de un pozo se pide bajo demanda con
   * `listarVisitasPozo`). El diff de sync compara contra el set completo
   * que `prepararSincronizacion` pide aparte a la base.
   */
  visitas: VisitaCampo[]
  /**
   * Proyección reducida de `pozo_indicadores` (pozo|fecha|indicador|valor) —
   * es lo que alimenta el filtro de eventos del historial sin escanear
   * decenas de miles de visitas. Se regenera en cada import.
   */
  indicadores: IndicadorPozo[]
  alertas: AlertaImport[]
  cargando: boolean
  error: string | null
  /** Incrementa en cada carga/sync; el mapa lo usa para saber que debe re-sincronizar. */
  versionDatos: number
  seleccionado: Seleccion | null
  /**
   * La ficha de detalle es cerrable y solo se abre a demanda ("Ver detalle"
   * del menú contextual) — el clic simple sobre un marcador selecciona (anillo)
   * sin abrir la ficha, para no tapar el mapa.
   */
  detalleAbierto: boolean
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
  /** Selecciona el objetivo Y abre la ficha de detalle. */
  verDetalle: (s: Seleccion) => void
  /** Cierra la ficha y suelta la selección (el × del panel). */
  cerrarDetalle: () => void
}

export const useDatosStore = create<EstadoDatos>((set, get) => ({
  pozos: [],
  instalaciones: [],
  visitas: [],
  indicadores: [],
  alertas: [],
  cargando: false,
  error: null,
  versionDatos: 0,
  seleccionado: null,
  detalleAbierto: false,
  sincPendiente: null,
  sincronizando: false,

  cargarDesdeSupabase: async () => {
    if (!supabase) return
    set({ cargando: true, error: null })
    try {
      const { pozos, instalaciones, visitas } = await obtenerUniverso()
      // Tabla nueva (migración 0012): si aún no está aplicada el filtro por
      // indicadores queda vacío, pero el resto de la app no debe caer.
      const indicadores = await listarIndicadores().catch(() => [] as IndicadorPozo[])
      set((s) => ({ pozos, instalaciones, visitas, indicadores, cargando: false, versionDatos: s.versionDatos + 1 }))
    } catch (e) {
      set({ cargando: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  prepararSincronizacion: async (file) => {
    set({ cargando: true, error: null })
    try {
      const esCsv = file.name.toLowerCase().endsWith('.csv')
      // El diff se calcula SIEMPRE contra el estado real de Supabase, nunca
      // contra el store local: si la app cayó al fallback de desarrollo
      // (Excel local en memoria, sin persistir) o si otro planificador ya
      // sincronizó algo, comparar contra `get().pozos` mostraría "0 nuevos"
      // de forma engañosa y el upsert de completaciones referenciaría pozos
      // que en realidad no existen en la base (viola la FK).
      // `visitasCompletas`: el historial entero — el diff compara visitas por
      // llave de negocio y el store solo guarda la última por pozo.
      const actual = supabase
        ? await obtenerUniverso({ visitasCompletas: true })
        : { pozos: get().pozos, instalaciones: get().instalaciones, visitas: get().visitas }
      let pozos: PozoConCompletaciones[], instalaciones: Instalacion[], visitas: VisitaCampo[], alertas: AlertaImport[], indicadores: IndicadorPozo[]
      if (esCsv) {
        const r = importarCsvPozos(await file.text(), get().instalaciones)
        pozos = r.pozos
        alertas = r.alertas
        instalaciones = get().instalaciones
        // El CSV no trae hojas GL/BES → las visitas no cambian. `nuevo` toma
        // el set actual tal cual para que el diff reporte 0 en vez de
        // actualizaciones fantasma (el store solo guarda la última por pozo).
        visitas = actual.visitas
        // Los indicadores derivan de visitas: se recomputan igual para que el
        // rebuild de la tabla quede consistente con lo que se confirma.
        indicadores = calcularIndicadores(visitas)
      } else {
        const r = await importarExcel(await file.arrayBuffer())
        pozos = r.pozos
        instalaciones = r.instalaciones
        visitas = r.visitas
        alertas = r.alertas
        indicadores = r.indicadores
      }
      const diff = calcularDiff({ pozos, instalaciones, visitas }, actual)
      set({
        cargando: false,
        sincPendiente: { diff, archivo: file.name, nAlertas: alertas.length, alertas, pozos, instalaciones, visitas, indicadores },
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
        // El store conserva solo la última visita por pozo — el historial
        // completo ya quedó persistido y no hace falta en memoria.
        visitas: [...ultimaVisitaPorPozo(pend.visitas).values()],
        indicadores: pend.indicadores,
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
  verDetalle: (s) => set({ seleccionado: s, detalleAbierto: true }),
  cerrarDetalle: () => set({ detalleAbierto: false, seleccionado: null }),
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
    const { pozos, instalaciones, visitas, indicadores, alertas } = await importarExcel(await res.arrayBuffer())
    // En dev sin Supabase se conserva el historial completo en memoria: es la
    // única fuente para el "historial bajo demanda" del detalle del pozo.
    useDatosStore.setState((s) => ({ pozos, instalaciones, visitas, indicadores, alertas, versionDatos: s.versionDatos + 1 }))
  } catch {
    // Sin archivo local: el mapa arranca vacío y los datos vendrán de Supabase.
  }
}
