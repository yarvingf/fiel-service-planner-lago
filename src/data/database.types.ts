/**
 * Tipos generados a mano a partir de supabase/migrations/*.sql, con la forma
 * que espera supabase-js v2 (Row/Insert/Update/Relationships por tabla;
 * Views/Functions por schema). Una vez aplicado el esquema al proyecto real,
 * se puede reemplazar por la salida oficial de:
 *   npx supabase gen types typescript --project-id <ref> > src/data/database.types.ts
 */

export type Campo = 'BA' | 'VLC' | 'VLG'
export type Reemplazo = '' | 'A' | 'B' | 'C' | 'D'
export type EstatusCoaDb = 'Abierto' | 'Cerrado' | 'Indeterminado'
export type MetodoDb = 'GL' | 'BES' | 'NF' | 'BM' | 'BCP'
export type RolUsuario = 'planificador' | 'consulta'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; nombre: string; rol: RolUsuario; creado_en: string }
        Insert: { id: string; nombre: string; rol: RolUsuario; creado_en?: string }
        Update: Partial<{ nombre: string; rol: RolUsuario }>
        Relationships: []
      }
      tipos_instalacion: {
        Row: { codigo: string; descripcion: string }
        Insert: { codigo: string; descripcion: string }
        Update: Partial<{ descripcion: string }>
        Relationships: []
      }
      instalaciones: {
        Row: {
          id: string
          tipo: string
          codigo: string
          campo: Campo
          lat: number | null
          lon: number | null
          es_stub: boolean
          activo: boolean
          actualizado_en: string
        }
        Insert: {
          id?: string
          tipo: string
          codigo: string
          campo: Campo
          lat?: number | null
          lon?: number | null
          es_stub?: boolean
          activo?: boolean
          actualizado_en?: string
        }
        Update: Partial<Database['public']['Tables']['instalaciones']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'instalaciones_tipo_fkey'
            columns: ['tipo']
            isOneToOne: false
            referencedRelation: 'tipos_instalacion'
            referencedColumns: ['codigo']
          },
        ]
      }
      pozos: {
        Row: {
          id: string
          campo: Campo
          numero: number
          reemplazo: Reemplazo
          codigo: string
          lat: number
          lon: number
          ef_id: string | null
          mg_id: string | null
          pc_id: string | null
          pbes_id: string | null
          reemplazado: boolean
          activo: boolean
          actualizado_en: string
        }
        Insert: {
          id?: string
          campo: Campo
          numero: number
          reemplazo?: Reemplazo
          codigo: string
          lat: number
          lon: number
          ef_id?: string | null
          mg_id?: string | null
          pc_id?: string | null
          pbes_id?: string | null
          reemplazado?: boolean
          activo?: boolean
          actualizado_en?: string
        }
        Update: Partial<Database['public']['Tables']['pozos']['Insert']>
        Relationships: []
      }
      pozo_completaciones: {
        Row: {
          id: string
          pozo_id: string
          nb_yacimiento: string
          coa: EstatusCoaDb
          metodo: MetodoDb | null
          cat: number | null
          bnpd: number | null
          bnpd_fecha: string | null
          pot: number | null
        }
        Insert: {
          id?: string
          pozo_id: string
          nb_yacimiento: string
          coa: EstatusCoaDb
          metodo?: MetodoDb | null
          cat?: number | null
          bnpd?: number | null
          bnpd_fecha?: string | null
          pot?: number | null
        }
        Update: Partial<Database['public']['Tables']['pozo_completaciones']['Insert']>
        Relationships: []
      }
      cuadrillas: {
        Row: { id: string; nombre: string; color: string; activa: boolean; creado_en: string }
        Insert: { id?: string; nombre: string; color: string; activa?: boolean; creado_en?: string }
        Update: Partial<Database['public']['Tables']['cuadrillas']['Insert']>
        Relationships: []
      }
      asignaciones: {
        Row: {
          id: string
          fecha: string
          cuadrilla_id: string
          objetivo_id: string
          objetivo_codigo: string
          actividad: string | null
          nota: string | null
          prioridad: number | null
          validar_ajuste: boolean
          requiere_manometro: boolean
          requiere_nivel: boolean
          asignado_por: string
          creado_en: string
        }
        Insert: {
          id?: string
          fecha: string
          cuadrilla_id: string
          objetivo_id: string
          objetivo_codigo: string
          actividad?: string | null
          nota?: string | null
          prioridad?: number | null
          validar_ajuste?: boolean
          requiere_manometro?: boolean
          requiere_nivel?: boolean
          asignado_por?: string
          creado_en?: string
        }
        Update: Partial<Database['public']['Tables']['asignaciones']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'asignaciones_cuadrilla_id_fkey'
            columns: ['cuadrilla_id']
            isOneToOne: false
            referencedRelation: 'cuadrillas'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
