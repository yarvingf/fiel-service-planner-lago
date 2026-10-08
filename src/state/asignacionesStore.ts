import { create } from 'zustand'
import type { Cuadrilla } from '@/domain/cuadrilla'
import { useDatosStore } from './datosStore'
import { usuarioActualId } from './authStore'
import {
  listarCuadrillas,
  crearCuadrilla,
  desactivarCuadrilla,
  reactivarCuadrilla,
  listarAsignaciones,
  guardarAsignaciones,
  borrarAsignaciones,
  borrarAsignacionesCuadrilla,
  copiarAsignaciones,
  actualizarAsignacion as actualizarAsignacionDb,
  actualizarAsignaciones as actualizarAsignacionesDb,
  type CamposAsignacion,
  type ItemCopiaPlan,
} from '@/data/persistencia'
import { agruparCambiosLote } from '@/data/loteCambios'

/** Objetivo de asignación/selección: id prefijado con su kind ("pozo|x" / "inst|x"). */
export type IdObjetivo = string

export type ModoSeleccion = false | 'rectangle' | 'freehand' | 'multi'

/**
 * Qué tipos de objetivo puede capturar la selección (lazo/rectángulo/multi).
 * tiposInst null = todas las instalaciones; lista = solo esos tipos ("EF", "MG"...).
 */
export interface CapturaSeleccion {
  pozos: boolean
  tiposInst: string[] | null
}

export function capturaPermite(captura: CapturaSeleccion, kind: 'pozo' | 'instalacion', tipo?: string): boolean {
  if (kind === 'pozo') return captura.pozos
  if (captura.tiposInst === null) return true
  return tipo !== undefined && captura.tiposInst.includes(tipo)
}

export interface AsignacionRec {
  /** uuid de la fila en la base. */
  id: string
  fecha: string // YYYY-MM-DD
  objetivoId: IdObjetivo
  /** Código legible persistido junto al id: sirve cuando el pozo no está importado en esta sesión. */
  codigo: string
  cuadrillaId: string
  /** Qué va a hacer la cuadrilla en el objetivo (texto libre). */
  actividad: string | null
  nota: string | null
  /** Número libre de prioridad para el plan del día. */
  prioridad: number | null
  /** Checklist operativo que se exporta al Excel del plan. */
  validarAjuste: boolean
  requiereManometro: boolean
  requiereNivel: boolean
}

export type ResolucionConflicto = 'reasignar' | 'omitir'

/** Ítem del modal de conflictos: ya tiene dueño ese día en OTRA cuadrilla. */
export interface ConflictoAsignacion {
  objetivoId: IdObjetivo
  codigo: string
  cuadrillaActual: string
}

/** Asignación en espera de resolución de conflictos (modal global). */
export interface AsignacionPendiente {
  cuadrillaId: string
  objetivos: IdObjetivo[]
  conflictos: ConflictoAsignacion[]
}

export const PALETA_CUADRILLAS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
]

/** Fecha local (no UTC: a las 8pm en Venezuela toISOString ya dice "mañana"). */
function hoy(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Mapa objetivoId → código legible, según lo que haya importado en la sesión. */
function mapaCodigos(): Map<string, string> {
  const { pozos, instalaciones } = useDatosStore.getState()
  const m = new Map<string, string>()
  for (const p of pozos) m.set(`pozo|${p.id}`, p.codigo)
  for (const i of instalaciones) m.set(`inst|${i.id}`, i.codigo)
  return m
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface EstadoAsignaciones {
  cuadrillas: Cuadrilla[]
  /** Asignaciones de la fecha seleccionada únicamente (se recargan al cambiar de día). */
  asignaciones: AsignacionRec[]
  /** Fecha del plan que se está editando/visualizando. */
  fecha: string
  /** Ids seleccionados con el lazo/rectángulo/multi ("pozo|id", "inst|id"). */
  seleccion: IdObjetivo[]
  /** Modo de selección efectivo (lo que consume el mapa), o false = navegación normal. */
  modoSeleccion: ModoSeleccion
  /** Modo "pegajoso" elegido en la barra de herramientas; a él se vuelve al soltar una tecla o tras un uso único. */
  modoBase: ModoSeleccion
  /** true si `modoSeleccion` debe revertir a `modoBase` en cuanto se complete una selección (clic derecho → una vez). */
  modoUnaVez: boolean
  /** Qué tipos de objetivo captura la selección. */
  captura: CapturaSeleccion
  /** 'estatus' colorea por estatus, 'cuadrilla' colorea por cuadrilla asignada. */
  colorPor: 'estatus' | 'cuadrilla'
  /**
   * Cuadrilla elegida en el panel (chip activo). Vive en el store para que
   * otros accesos directos (ej. el botón → de cada resultado de búsqueda)
   * sepan a quién asignar.
   */
  cuadrillaActiva: string | null
  /** Asignación que espera resolución de conflictos en el modal, o null. */
  asignacionPendiente: AsignacionPendiente | null
  /** Elección por objetivo conflictivo (por defecto 'omitir'). */
  resoluciones: Record<IdObjetivo, ResolucionConflicto>

  /** true mientras carga cuadrillas/plan de la fecha desde Supabase. */
  cargandoPlan: boolean
  /** true mientras hay una escritura (crear/eliminar/asignar) en vuelo. */
  guardando: boolean
  /** Último error de persistencia, para mostrarlo en el HUD. */
  errorPlan: string | null
  /** Usuario dueño de los datos cargados; si cambia la sesión se recarga. */
  usuarioId: string | null

  /** Carga cuadrillas + plan de la fecha actual. Idempotente por usuario. */
  inicializar: () => Promise<void>
  /** Limpia todo al cerrar sesión. */
  reiniciar: () => void

  agregarCuadrilla: (nombre: string, color?: string) => Promise<void>
  quitarCuadrilla: (id: string) => Promise<void>
  setFecha: (fecha: string) => void
  setColorPor: (m: 'estatus' | 'cuadrilla') => void
  /** Botón de la barra: fija el modo pegajoso y lo activa de inmediato. */
  setModoSeleccion: (v: ModoSeleccion) => void
  /** Tecla mantenida presionada: activa un modo sin tocar el modo pegajoso. */
  activarModoTemporal: (v: ModoSeleccion) => void
  /** Se soltó la tecla: vuelve al modo pegajoso. */
  restaurarModoBase: () => void
  /** Clic derecho → elegir herramienta para un solo uso; se autoconsume tras completarse. */
  activarModoUnaVez: (v: ModoSeleccion) => void
  /** Llamado tras completarse una selección (dibujo terminado o clic en multi). */
  consumirUnaVez: () => void
  setCaptura: (c: CapturaSeleccion) => void
  setSeleccion: (ids: IdObjetivo[]) => void
  /** Multi: clic suma el objetivo, clic de nuevo lo quita. */
  alternarObjetivo: (id: IdObjetivo) => void
  agregarASeleccion: (ids: IdObjetivo[]) => void
  limpiarSeleccion: () => void
  setCuadrillaActiva: (id: string | null) => void
  /**
   * Inicia la asignación a `cuadrillaActiva`. Sin `objetivos` usa la
   * selección completa (panel de asignación); con `objetivos` asigna solo
   * esos ids sin tocar la selección (ej. botón → de la búsqueda). Si hay
   * conflictos abre el modal global en vez de escribir.
   */
  iniciarAsignacion: (objetivos?: IdObjetivo[]) => void
  setResolucion: (id: IdObjetivo, r: ResolucionConflicto) => void
  resolverTodos: (r: ResolucionConflicto) => void
  cancelarAsignacionPendiente: () => void
  /** Confirma el modal de conflictos: escribe y cierra solo si la base acepta. */
  confirmarAsignacionPendiente: () => Promise<void>
  /**
   * Asigna `objetivos` a una cuadrilla en `fecha` y lo persiste.
   * `resoluciones[id]` = 'reasignar' | 'omitir' para los que ya tenían dueño.
   * Quita de `seleccion` solo los ids efectivamente procesados.
   * Devuelve false si la base rechazó la operación (el estado local no cambia).
   */
  asignar: (
    cuadrillaId: string,
    objetivos: IdObjetivo[],
    resoluciones: Record<IdObjetivo, ResolucionConflicto>,
  ) => Promise<boolean>
  desasignar: (ids: IdObjetivo[]) => Promise<boolean>
  /** Suelta todas las asignaciones de una cuadrilla en la fecha actual. */
  desasignarCuadrilla: (cuadrillaId: string) => Promise<boolean>
  /** Guarda campos editables de una asignación (edición desde el modal del plan). */
  actualizarAsignacion: (
    id: string,
    campos: CamposAsignacion,
  ) => Promise<boolean>
  /** Copia los mismos campos a varias asignaciones de golpe. */
  actualizarAsignaciones: (
    ids: string[],
    campos: CamposAsignacion,
  ) => Promise<boolean>
  /**
   * Aplica campos DISTINTOS por asignación en un solo lote (el modal acumula
   * ediciones locales y las manda todas con "Aplicar"). Agrupa por
   * combinación idéntica de campos: un UPDATE por grupo, en paralelo.
   */
  actualizarLote: (
    cambios: ReadonlyMap<string, CamposAsignacion>,
  ) => Promise<boolean>
  asignacionDe: (objetivoId: IdObjetivo) => AsignacionRec | undefined
  /**
   * Escribe en la fecha actual los ítems de una plantilla copiada de otro
   * día (ya filtrados por el usuario en el preview). Upsert por objetivo:
   * pisa la asignación existente si la había. Devuelve false si la base
   * rechazó (error visible en `errorPlan`).
   */
  aplicarCopiaPlan: (items: ItemCopiaPlan[]) => Promise<boolean>
}

export const useAsignacionesStore = create<EstadoAsignaciones>((set, get) => ({
  cuadrillas: [],
  asignaciones: [],
  fecha: hoy(),
  seleccion: [],
  modoSeleccion: false,
  modoBase: false,
  modoUnaVez: false,
  captura: { pozos: true, tiposInst: [] },
  colorPor: 'estatus',
  cuadrillaActiva: null,
  asignacionPendiente: null,
  resoluciones: {},
  cargandoPlan: false,
  guardando: false,
  errorPlan: null,
  usuarioId: null,

  inicializar: async () => {
    const uid = usuarioActualId()
    if (!uid) return
    const s = get()
    if (s.cargandoPlan || (s.usuarioId === uid && s.cuadrillas.length > 0)) return
    set({ cargandoPlan: true, errorPlan: null, usuarioId: uid })
    try {
      const fecha = get().fecha
      const [cuadrillas, remotas] = await Promise.all([listarCuadrillas(), listarAsignaciones(fecha)])
      // Si el usuario cambió de fecha mientras cargaba, no pisar con datos viejos.
      if (get().fecha === fecha) {
        set({ cuadrillas, asignaciones: remotas, cargandoPlan: false })
      } else {
        set({ cuadrillas, cargandoPlan: false })
        get().setFecha(get().fecha)
      }
    } catch (e) {
      set({ cargandoPlan: false, errorPlan: mensaje(e) })
    }
  },

  reiniciar: () =>
    set({
      cuadrillas: [],
      asignaciones: [],
      seleccion: [],
      cuadrillaActiva: null,
      asignacionPendiente: null,
      resoluciones: {},
      cargandoPlan: false,
      guardando: false,
      errorPlan: null,
      usuarioId: null,
    }),

  agregarCuadrilla: async (nombre, colorElegido) => {
    const color = colorElegido ?? PALETA_CUADRILLAS[get().cuadrillas.length % PALETA_CUADRILLAS.length]
    set({ guardando: true, errorPlan: null })
    try {
      // Si existe una cuadrilla archivada con ese nombre se reactiva (mismo
      // id → su historial de asignaciones se reconecta automáticamente).
      const archivada = get().cuadrillas.find(
        (c) => !c.activa && c.nombre.toUpperCase() === nombre.trim().toUpperCase(),
      )
      if (archivada) {
        await reactivarCuadrilla(archivada.id, color)
        set((s) => ({
          guardando: false,
          cuadrillas: s.cuadrillas.map((c) =>
            c.id === archivada.id ? { ...c, activa: true, color } : c,
          ),
        }))
        return
      }
      const creada = await crearCuadrilla(nombre.trim(), color)
      set((s) => ({ guardando: false, cuadrillas: [...s.cuadrillas, creada] }))
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
    }
  },

  quitarCuadrilla: async (id) => {
    set({ guardando: true, errorPlan: null })
    try {
      // Borrado lógico: activa=false. Las asignaciones quedan intactas —
      // el historial conserva que el objetivo estuvo con esta cuadrilla.
      await desactivarCuadrilla(id)
      set((s) => ({
        guardando: false,
        cuadrillas: s.cuadrillas.map((c) => (c.id === id ? { ...c, activa: false } : c)),
        cuadrillaActiva: s.cuadrillaActiva === id ? null : s.cuadrillaActiva,
      }))
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
    }
  },

  setFecha: (fecha) => {
    if (!fecha || fecha === get().fecha) return
    set({ fecha, cargandoPlan: true, errorPlan: null })
    void (async () => {
      try {
        const remotas = await listarAsignaciones(fecha)
        if (get().fecha !== fecha) return // cambió de fecha mientras cargaba
        set({ asignaciones: remotas, cargandoPlan: false })
      } catch (e) {
        if (get().fecha !== fecha) return
        set({ asignaciones: [], cargandoPlan: false, errorPlan: mensaje(e) })
      }
    })()
  },

  setColorPor: (colorPor) => set({ colorPor }),
  setModoSeleccion: (v) => set({ modoSeleccion: v, modoBase: v, modoUnaVez: false }),
  activarModoTemporal: (v) => set({ modoSeleccion: v }),
  restaurarModoBase: () => set((s) => ({ modoSeleccion: s.modoBase, modoUnaVez: false })),
  activarModoUnaVez: (v) => set({ modoSeleccion: v, modoUnaVez: true }),
  consumirUnaVez: () => set((s) => (s.modoUnaVez ? { modoSeleccion: s.modoBase, modoUnaVez: false } : {})),
  setCaptura: (captura) => set({ captura }),
  setSeleccion: (seleccion) => set({ seleccion }),

  alternarObjetivo: (id) =>
    set((s) => ({
      seleccion: s.seleccion.includes(id) ? s.seleccion.filter((x) => x !== id) : [...s.seleccion, id],
    })),

  agregarASeleccion: (ids) =>
    set((s) => ({ seleccion: [...new Set([...s.seleccion, ...ids])] })),

  limpiarSeleccion: () => set({ seleccion: [] }),

  setCuadrillaActiva: (cuadrillaActiva) => set({ cuadrillaActiva }),

  iniciarAsignacion: (objetivos) => {
    const s = get()
    const cuadrillaId = s.cuadrillaActiva
    const ids = objetivos ?? s.seleccion
    if (!cuadrillaId || ids.length === 0) return
    const sel = new Set(ids)
    const conf = s.asignaciones.filter(
      (a) => a.fecha === s.fecha && sel.has(a.objetivoId) && a.cuadrillaId !== cuadrillaId,
    )
    if (conf.length === 0) {
      void s.asignar(cuadrillaId, ids, {})
      return
    }
    const codigos = mapaCodigos()
    const nombres = new Map(s.cuadrillas.map((c) => [c.id, c.nombre]))
    set({
      asignacionPendiente: {
        cuadrillaId,
        objetivos: ids,
        conflictos: conf.map((a) => ({
          objetivoId: a.objetivoId,
          codigo: codigos.get(a.objetivoId) ?? a.codigo,
          cuadrillaActual: nombres.get(a.cuadrillaId) ?? 'otra cuadrilla',
        })),
      },
      // Por defecto se omiten: nadie pierde su plan sin confirmarlo explícitamente.
      resoluciones: Object.fromEntries(conf.map((a) => [a.objetivoId, 'omitir' as const])),
    })
  },

  setResolucion: (id, r) => set((s) => ({ resoluciones: { ...s.resoluciones, [id]: r } })),

  resolverTodos: (r) =>
    set((s) => ({
      resoluciones: Object.fromEntries(
        (s.asignacionPendiente?.conflictos ?? []).map((c) => [c.objetivoId, r]),
      ),
    })),

  cancelarAsignacionPendiente: () => set({ asignacionPendiente: null }),

  confirmarAsignacionPendiente: async () => {
    const s = get()
    const p = s.asignacionPendiente
    if (!p) return
    // Si la base rechaza, el modal queda abierto para reintentar.
    if (await s.asignar(p.cuadrillaId, p.objetivos, s.resoluciones)) {
      set({ asignacionPendiente: null })
    }
  },

  asignar: async (cuadrillaId, objetivos, resoluciones) => {
    const s = get()
    const sel = new Set(objetivos)
    // Objetivos cuya asignación previa de ese día se conserva (omitir)
    const conservar = new Set(
      s.asignaciones
        .filter(
          (a) =>
            a.fecha === s.fecha &&
            sel.has(a.objetivoId) &&
            a.cuadrillaId !== cuadrillaId &&
            resoluciones[a.objetivoId] === 'omitir',
        )
        .map((a) => a.objetivoId),
    )
    const escribir = objetivos.filter((id) => !conservar.has(id))
    if (escribir.length === 0) {
      set((st) => ({ seleccion: st.seleccion.filter((id) => !sel.has(id)) }))
      return true
    }

    const codigos = mapaCodigos()
    const items = escribir.map((objetivoId) => ({
      objetivoId,
      codigo: codigos.get(objetivoId) ?? objetivoId,
    }))

    set({ guardando: true, errorPlan: null })
    try {
      const escritas = await guardarAsignaciones(s.fecha, cuadrillaId, items, usuarioActualId() ?? '')
      const escritos = new Set(escribir)
      set((st) => ({
        guardando: false,
        // Solo se sueltan de la selección los ids que se procesaron — una
        // asignación directa desde la búsqueda no barre la selección del mapa.
        seleccion: st.seleccion.filter((id) => !sel.has(id)),
        // Regla 1 cuadrilla/objetivo/día: se reemplaza cualquier dueño anterior.
        // Las filas devueltas por la base traen su id real para editarlas luego.
        asignaciones: [...st.asignaciones.filter((a) => !escritos.has(a.objetivoId)), ...escritas],
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },

  desasignar: async (ids) => {
    const s = get()
    const propios = ids.filter((id) =>
      s.asignaciones.some((a) => a.fecha === s.fecha && a.objetivoId === id),
    )
    if (propios.length === 0) return true
    set({ guardando: true, errorPlan: null })
    try {
      await borrarAsignaciones(s.fecha, propios)
      const borrados = new Set(propios)
      set((st) => ({
        guardando: false,
        asignaciones: st.asignaciones.filter((a) => !borrados.has(a.objetivoId)),
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },

  desasignarCuadrilla: async (cuadrillaId) => {
    const s = get()
    if (!s.asignaciones.some((a) => a.fecha === s.fecha && a.cuadrillaId === cuadrillaId)) return true
    set({ guardando: true, errorPlan: null })
    try {
      await borrarAsignacionesCuadrilla(s.fecha, cuadrillaId)
      set((st) => ({
        guardando: false,
        asignaciones: st.asignaciones.filter(
          (a) => !(a.fecha === st.fecha && a.cuadrillaId === cuadrillaId),
        ),
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },

  actualizarAsignacion: async (id, campos) => {
    set({ guardando: true, errorPlan: null })
    try {
      await actualizarAsignacionDb(id, campos)
      set((st) => ({
        guardando: false,
        asignaciones: st.asignaciones.map((a) => (a.id === id ? { ...a, ...campos } : a)),
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },

  actualizarAsignaciones: async (ids, campos) => {
    if (ids.length === 0) return true
    set({ guardando: true, errorPlan: null })
    try {
      await actualizarAsignacionesDb(ids, campos)
      const idset = new Set(ids)
      set((st) => ({
        guardando: false,
        asignaciones: st.asignaciones.map((a) => (idset.has(a.id) ? { ...a, ...campos } : a)),
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },

  actualizarLote: async (cambios) => {
    if (cambios.size === 0) return true
    // Las filas que recibieron el mismo cambio comparten un solo UPDATE ... IN.
    const grupos = agruparCambiosLote(cambios)
    set({ guardando: true, errorPlan: null })
    try {
      await Promise.all(
        grupos.map((g) => actualizarAsignacionesDb(g.ids, g.campos)),
      )
      set((st) => ({
        guardando: false,
        asignaciones: st.asignaciones.map((a) => {
          const c = cambios.get(a.id)
          return c ? { ...a, ...c } : a
        }),
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },

  asignacionDe: (objetivoId) =>
    get().asignaciones.find((a) => a.fecha === get().fecha && a.objetivoId === objetivoId),

  aplicarCopiaPlan: async (items) => {
    if (items.length === 0) return true
    set({ guardando: true, errorPlan: null })
    try {
      const escritas = await copiarAsignaciones(get().fecha, items, usuarioActualId() ?? '')
      const escritos = new Set(items.map((i) => i.objetivoId))
      set((st) => ({
        guardando: false,
        asignaciones: [...st.asignaciones.filter((a) => !escritos.has(a.objetivoId)), ...escritas],
      }))
      return true
    } catch (e) {
      set({ guardando: false, errorPlan: mensaje(e) })
      return false
    }
  },
}))

/**
 * Ids de objetivos con asignación en la fecha del plan actual. Función de
 * lectura directa del store (no hook) — la usan módulos fuera de React como
 * `resaltado.ts`, que reaccionan a eventos del mapa (hover), no a renders.
 */
export function idsAsignadosActuales(): Set<IdObjetivo> {
  const { asignaciones, fecha } = useAsignacionesStore.getState()
  const ids = new Set<IdObjetivo>()
  for (const a of asignaciones) if (a.fecha === fecha) ids.add(a.objetivoId)
  return ids
}
