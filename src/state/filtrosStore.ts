import { create } from 'zustand'
import { calcularDerivadosPozo, type EstatusCoa, type Metodo, type PozoConCompletaciones } from '@/domain/pozo'
import type { Instalacion } from '@/domain/instalacion'
import type { Campo } from '@/domain/codigos'

export interface Filtros {
  /** Estatus incluidos; vacío = ninguno visible. */
  estatus: EstatusCoa[]
  /** Métodos incluidos (un pozo con cualquiera de estos métodos pasa). */
  metodos: Metodo[]
  campos: Campo[]
  /** EF/MG a incluir (código de instalación); null = todos, sin filtrar. */
  efFiltro: string[] | null
  mgFiltro: string[] | null
  /** Mínimos de producción. 0 = sin mínimo. */
  diferidoMin: number
  bnpdMin: number
  /**
   * Tipos de instalación visibles; null = todos, [] = ninguno (por defecto:
   * empieza en [] — el mismo mecanismo de filtro tipo Excel que EF/MG).
   */
  tiposInst: string[] | null
  /** Líneas finas pozo→EF y pozo→MG según la asociación real. */
  mostrarLineas: boolean
  /**
   * Técnica visual para indicar el sentido instalación→pozo sin recalcular
   * geometría ni redibujar: 'gradiente' usa line-gradient (color GPU-side
   * según avance en la línea); 'animado' cicla line-dasharray (marcha de
   * guiones). Ambas son solo cambios de `paint`, no de datos.
   */
  estiloLineas: 'gradiente' | 'animado'
  /**
   * Filtra pozos/instalaciones según si tienen asignación en la fecha del
   * plan actual (`useAsignacionesStore.fecha`). 'todos' no filtra por esto.
   */
  asignacionFiltro: 'todos' | 'asignado' | 'noAsignado'
  /**
   * Si es true, solo se dibujan instalaciones asociadas (via efId/mgId) a
   * algún pozo que pase los demás filtros — ej. filtrar Cerrados muestra
   * solo las EF/MG de pozos cerrados. false = todas las instalaciones.
   */
  soloInstAsociadas: boolean
  /**
   * Antigüedad mínima de la última visita GL/BES, en días: el pozo pasa si
   * hace ≥N días de su última visita — o si nunca ha sido visitado. 0 = off.
   */
  sinVisitaDias: number
}

const TODOS_ESTATUS: EstatusCoa[] = ['Abierto', 'Cerrado', 'Indeterminado']
const TODOS_METODOS: Metodo[] = ['GL', 'BES', 'NF', 'BM', 'BCP']
const TODOS_CAMPOS: Campo[] = ['BA', 'VLC', 'VLG']

export const FILTROS_DEFAULT: Filtros = {
  estatus: [...TODOS_ESTATUS],
  metodos: [...TODOS_METODOS],
  campos: [...TODOS_CAMPOS],
  efFiltro: null,
  mgFiltro: null,
  diferidoMin: 0,
  bnpdMin: 0,
  tiposInst: [],
  mostrarLineas: true,
  estiloLineas: 'gradiente',
  asignacionFiltro: 'todos',
  soloInstAsociadas: false,
  sinVisitaDias: 0,
}

interface EstadoFiltros {
  filtros: Filtros
  setFiltros: (parcial: Partial<Filtros>) => void
  alternarEn: <K extends 'estatus' | 'metodos' | 'campos'>(clave: K, valor: Filtros[K][number]) => void
  limpiar: () => void
}

function alternar<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]
}

export const useFiltrosStore = create<EstadoFiltros>((set) => ({
  filtros: FILTROS_DEFAULT,
  setFiltros: (parcial) => set((s) => ({ filtros: { ...s.filtros, ...parcial } })),
  alternarEn: (clave, valor) =>
    set((s) => ({ filtros: { ...s.filtros, [clave]: alternar(s.filtros[clave] as unknown[], valor) } })),
  limpiar: () => set({ filtros: FILTROS_DEFAULT }),
}))

/**
 * Predicado único de visibilidad de pozo — réplica exacta de `expresionPozos`
 * (map/filtros.ts) en JavaScript. Lo usa el conteo "N / total" del panel y el
 * cálculo de instalaciones asociadas a pozos visibles: si algún día el filtro
 * del mapa cambia, hay que tocar los dos lados.
 */
export function pozoPasaFiltros(
  p: PozoConCompletaciones,
  f: Filtros,
  instPorId: ReadonlyMap<string, Instalacion>,
  idsAsignados: ReadonlySet<string>,
  diasSinVisita?: ReadonlyMap<string, number>,
): boolean {
  if (p.reemplazado || !p.activo || p.lat === null) return false
  const d = calcularDerivadosPozo(p.completaciones)
  if (!f.estatus.includes(d.estatus)) return false
  if (!f.campos.includes(p.campo)) return false
  if (!d.metodos.some((m) => f.metodos.includes(m))) return false
  if (d.potencialDiferidoConfirmado < f.diferidoMin) return false
  if (d.bnpdActivo < f.bnpdMin) return false
  const ef = (p.efId && instPorId.get(p.efId)?.codigo) ?? ''
  const mg = (p.mgId && instPorId.get(p.mgId)?.codigo) ?? ''
  if (f.efFiltro !== null && !f.efFiltro.includes(ef)) return false
  if (f.mgFiltro !== null && !f.mgFiltro.includes(mg)) return false
  if (f.asignacionFiltro !== 'todos') {
    const asignado = idsAsignados.has(`pozo|${p.id}`)
    if (f.asignacionFiltro === 'asignado' && !asignado) return false
    if (f.asignacionFiltro === 'noAsignado' && asignado) return false
  }
  // Sin visita registrada = "nunca visitado" → pasa cualquier umbral >0.
  if (f.sinVisitaDias > 0) {
    const dias = diasSinVisita?.get(p.id)
    if (dias !== undefined && dias < f.sinVisitaDias) return false
  }
  return true
}

export const OPCIONES_ESTATUS = TODOS_ESTATUS
export const OPCIONES_METODO = TODOS_METODOS
export const OPCIONES_CAMPO = TODOS_CAMPOS
