import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const MENSAJE_FALTA_CONFIG =
  'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Definilas en .env.local (ver .env.local.example).'

/**
 * Cliente único de Supabase. Es null si falta configuración: la app muestra la
 * pantalla de login con ese aviso en vez de reventar en el import.
 * La clave anónima es pública por diseño (va embebida en el bundle); la
 * seguridad real la impone RLS en cada tabla, nunca esta clave. Nunca usar la
 * service_role key en el frontend.
 */
export const supabase = url && anonKey ? createClient<Database>(url, anonKey) : null
