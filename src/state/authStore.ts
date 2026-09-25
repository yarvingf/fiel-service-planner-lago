import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase, MENSAJE_FALTA_CONFIG } from '@/data/supabaseClient'

export interface Perfil {
  nombre: string
  rol: 'planificador' | 'consulta'
}

interface EstadoAuth {
  /** null = sin sesión. Se resuelve una sola vez al arrancar (`listo`). */
  sesion: Session | null
  perfil: Perfil | null
  /** true cuando ya se consultó la sesión inicial (no mostrar login antes de eso). */
  listo: boolean
  entrando: boolean
  errorAuth: string | null
  inicializar: () => Promise<void>
  entrar: (email: string, password: string) => Promise<void>
  salir: () => Promise<void>
}

async function cargarPerfil(usuarioId: string): Promise<Perfil | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('profiles')
    .select('nombre, rol')
    .eq('id', usuarioId)
    .maybeSingle()
  return data ?? null
}

let suscripcionIniciada = false

export const useAuthStore = create<EstadoAuth>((set) => ({
  sesion: null,
  perfil: null,
  listo: false,
  entrando: false,
  errorAuth: null,

  inicializar: async () => {
    if (!supabase) {
      set({ listo: true, errorAuth: MENSAJE_FALTA_CONFIG })
      return
    }
    if (!suscripcionIniciada) {
      suscripcionIniciada = true
      supabase.auth.onAuthStateChange((_evento, sesion) => {
        set({ sesion })
        if (sesion) {
          void cargarPerfil(sesion.user.id).then((perfil) => set({ perfil }))
        } else {
          set({ perfil: null })
        }
      })
    }
    const { data } = await supabase.auth.getSession()
    const sesion = data.session
    set({ sesion, listo: true })
    if (sesion) set({ perfil: await cargarPerfil(sesion.user.id) })
  },

  entrar: async (email, password) => {
    if (!supabase) {
      set({ errorAuth: MENSAJE_FALTA_CONFIG })
      return
    }
    set({ entrando: true, errorAuth: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({
        entrando: false,
        errorAuth:
          error.message === 'Invalid login credentials'
            ? 'Correo o contraseña incorrectos'
            : error.message,
      })
      return
    }
    // La sesión y el perfil llegan por onAuthStateChange; aquí solo apagamos el spinner.
    set({ entrando: false })
  },

  salir: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    set({ sesion: null, perfil: null })
  },
}))

/** userId del usuario autenticado, o null. Atajo para persistencia. */
export function usuarioActualId(): string | null {
  return useAuthStore.getState().sesion?.user.id ?? null
}

/** true si el perfil cargado es planificador (único rol con permiso de escritura). */
export function esPlanificador(): boolean {
  return useAuthStore.getState().perfil?.rol === 'planificador'
}
