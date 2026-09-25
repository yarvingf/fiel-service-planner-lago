import { create } from 'zustand'
import type { EstatusCoa, Metodo } from '@/domain/pozo'
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

export const OPCIONES_ESTATUS = TODOS_ESTATUS
export const OPCIONES_METODO = TODOS_METODOS
export const OPCIONES_CAMPO = TODOS_CAMPOS
