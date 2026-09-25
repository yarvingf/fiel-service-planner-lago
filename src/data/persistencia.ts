import { supabase, MENSAJE_FALTA_CONFIG } from './supabaseClient'
import type { Cuadrilla } from '@/domain/cuadrilla'
import type { Database } from './database.types'

type FilaCuadrilla = Database['public']['Tables']['cuadrillas']['Row']
type FilaAsignacion = Database['public']['Tables']['asignaciones']['Row']
type InsertAsignacion = Database['public']['Tables']['asignaciones']['Insert']
type UpdateAsignacion = Database['public']['Tables']['asignaciones']['Update']

/** Una asignación ya traducida al modelo de la app (fecha en YYYY-MM-DD). */
export interface AsignacionRemota {
  /** uuid de la fila en la base — necesario para actualizar nota/actividad. */
  id: string
  fecha: string
  objetivoId: string
  codigo: string
  cuadrillaId: string
  actividad: string | null
  nota: string | null
  /** Número libre de prioridad para ordenar el plan del día. */
  prioridad: number | null
  /** Checklist operativo del plan (se exporta al Excel). */
  validarAjuste: boolean
  requiereManometro: boolean
  requiereNivel: boolean
}

/** Campos editables de una asignación (nombres en camelCase del modelo de la app). */
export interface CamposAsignacion {
  actividad?: string | null
  nota?: string | null
  prioridad?: number | null
  validarAjuste?: boolean
  requiereManometro?: boolean
  requiereNivel?: boolean
}

/** Traduce los campos camelCase a nombres de columna de la tabla. */
function camposAFila(campos: CamposAsignacion): UpdateAsignacion {
  const fila: UpdateAsignacion = {}
  if (campos.actividad !== undefined) fila.actividad = campos.actividad
  if (campos.nota !== undefined) fila.nota = campos.nota
  if (campos.prioridad !== undefined) fila.prioridad = campos.prioridad
  if (campos.validarAjuste !== undefined) fila.validar_ajuste = campos.validarAjuste
  if (campos.requiereManometro !== undefined) fila.requiere_manometro = campos.requiereManometro
  if (campos.requiereNivel !== undefined) fila.requiere_nivel = campos.requiereNivel
  return fila
}

export function filaACuadrilla(f: FilaCuadrilla): Cuadrilla {
  return { id: f.id, nombre: f.nombre, color: f.color, activa: f.activa }
}

export function filaAAsignacion(f: FilaAsignacion): AsignacionRemota {
  return {
    id: f.id,
    fecha: f.fecha,
    objetivoId: f.objetivo_id,
    codigo: f.objetivo_codigo,
    cuadrillaId: f.cuadrilla_id,
    actividad: f.actividad,
    nota: f.nota,
    prioridad: f.prioridad,
    validarAjuste: f.validar_ajuste,
    requiereManometro: f.requiere_manometro,
    requiereNivel: f.requiere_nivel,
  }
}

/** Traduce errores frecuentes de Postgres/RLS a mensajes accionables. */
function traducirError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('Ya existe un registro con ese nombre u objetivo')
  if (error.code === '42501' || /row-level security/i.test(error.message))
    return new Error('Tu usuario no tiene rol planificador: la base rechazó la escritura')
  return new Error(error.message)
}

function cliente() {
  if (!supabase) throw new Error(MENSAJE_FALTA_CONFIG)
  return supabase
}

export async function listarCuadrillas(): Promise<Cuadrilla[]> {
  const { data, error } = await cliente().from('cuadrillas').select('*').order('creado_en')
  if (error) throw traducirError(error)
  return (data ?? []).map(filaACuadrilla)
}

export async function crearCuadrilla(nombre: string, color: string): Promise<Cuadrilla> {
  const { data, error } = await cliente()
    .from('cuadrillas')
    .insert({ nombre, color })
    .select()
    .single()
  if (error) throw traducirError(error)
  return filaACuadrilla(data)
}

/** Eliminar la cuadrilla borra en cascada sus asignaciones de todas las fechas. */
export async function eliminarCuadrilla(id: string): Promise<void> {
  const { error } = await cliente().from('cuadrillas').delete().eq('id', id)
  if (error) throw traducirError(error)
}

export async function listarAsignaciones(fecha: string): Promise<AsignacionRemota[]> {
  const { data, error } = await cliente()
    .from('asignaciones')
    .select('*')
    .eq('fecha', fecha)
    .order('creado_en')
  if (error) throw traducirError(error)
  return (data ?? []).map(filaAAsignacion)
}

/**
 * Inserta o reasigna: el índice único (fecha, objetivo_id) hace que un segundo
 * upsert del mismo objetivo actualice cuadrilla_id en vez de duplicar.
 * Devuelve las filas escritas (con su id real) para poblar el estado local.
 */
export async function guardarAsignaciones(
  fecha: string,
  cuadrillaId: string,
  objetivos: { objetivoId: string; codigo: string }[],
  asignadoPor: string,
): Promise<AsignacionRemota[]> {
  if (objetivos.length === 0) return []
  const filas: InsertAsignacion[] = objetivos.map((o) => ({
    fecha,
    cuadrilla_id: cuadrillaId,
    objetivo_id: o.objetivoId,
    objetivo_codigo: o.codigo,
    asignado_por: asignadoPor,
  }))
  const { data, error } = await cliente()
    .from('asignaciones')
    .upsert(filas, { onConflict: 'fecha,objetivo_id' })
    .select()
  if (error) throw traducirError(error)
  return (data ?? []).map(filaAAsignacion)
}

/** Actualiza campos editables de una asignación existente (edición en el modal). */
export async function actualizarAsignacion(
  id: string,
  campos: CamposAsignacion,
): Promise<void> {
  const { error } = await cliente().from('asignaciones').update(camposAFila(campos)).eq('id', id)
  if (error) throw traducirError(error)
}

/** Aplica los mismos campos a varias asignaciones de golpe (copiar/pegar a la cuadrilla). */
export async function actualizarAsignaciones(
  ids: string[],
  campos: CamposAsignacion,
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await cliente().from('asignaciones').update(camposAFila(campos)).in('id', ids)
  if (error) throw traducirError(error)
}

export async function borrarAsignaciones(fecha: string, objetivoIds: string[]): Promise<void> {
  if (objetivoIds.length === 0) return
  const { error } = await cliente()
    .from('asignaciones')
    .delete()
    .eq('fecha', fecha)
    .in('objetivo_id', objetivoIds)
  if (error) throw traducirError(error)
}

/** Suelta TODO el día de una cuadrilla: borra sus asignaciones de `fecha`. */
export async function borrarAsignacionesCuadrilla(fecha: string, cuadrillaId: string): Promise<void> {
  const { error } = await cliente()
    .from('asignaciones')
    .delete()
    .eq('fecha', fecha)
    .eq('cuadrilla_id', cuadrillaId)
  if (error) throw traducirError(error)
}
