import { create } from 'zustand'
import type { PozoConCompletaciones } from '@/domain/pozo'
import type { Instalacion } from '@/domain/instalacion'
import type { AlertaImport } from '@/domain/alertasImport'
import { importarExcel } from '@/data/importadorExcel'
import { importarCsvPozos } from '@/data/importadorCsv'

export interface Seleccion {
  kind: 'pozo' | 'instalacion'
  id: string
}

interface EstadoDatos {
  pozos: PozoConCompletaciones[]
  instalaciones: Instalacion[]
  alertas: AlertaImport[]
  cargando: boolean
  error: string | null
  /** Incrementa en cada import exitoso; el mapa lo usa para saber que debe re-sincronizar. */
  versionDatos: number
  seleccionado: Seleccion | null
  cargarDesdeExcel: (buffer: ArrayBuffer) => Promise<void>
  /** Punto de entrada del botón Importar: .xlsx completo o .csv de la hoja Pozos. */
  cargarDesdeArchivo: (file: File) => Promise<void>
  seleccionar: (s: Seleccion | null) => void
}

export const useDatosStore = create<EstadoDatos>((set, get) => ({
  pozos: [],
  instalaciones: [],
  alertas: [],
  cargando: false,
  error: null,
  versionDatos: 0,
  seleccionado: null,
  cargarDesdeExcel: async (buffer) => {
    set({ cargando: true, error: null })
    try {
      const resultado = await importarExcel(buffer)
      set((s) => ({ ...resultado, cargando: false, versionDatos: s.versionDatos + 1 }))
    } catch (e) {
      set({ cargando: false, error: e instanceof Error ? e.message : String(e) })
    }
  },
  cargarDesdeArchivo: async (file) => {
    if (file.name.toLowerCase().endsWith('.csv')) {
      set({ cargando: true, error: null })
      try {
        const { pozos, alertas } = importarCsvPozos(await file.text(), get().instalaciones)
        set((s) => ({ pozos, alertas, cargando: false, versionDatos: s.versionDatos + 1 }))
      } catch (e) {
        set({ cargando: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }
    await get().cargarDesdeExcel(await file.arrayBuffer())
  },
  seleccionar: (s) => set({ seleccionado: s }),
}))

/**
 * Carga en dev el Excel real colocado en public/ (gitignored). En producción el
 * origen será Supabase; esta función no debe correr allí.
 */
export async function cargarExcelDev(): Promise<void> {
  if (!import.meta.env.DEV) return
  try {
    const res = await fetch('/Excel%20Data.xlsx')
    if (!res.ok) return
    await useDatosStore.getState().cargarDesdeExcel(await res.arrayBuffer())
  } catch {
    // Sin archivo local: el mapa arranca vacío y los datos vendrán de Supabase.
  }
}
