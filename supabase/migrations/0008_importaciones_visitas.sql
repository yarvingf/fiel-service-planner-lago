-- Contadores de visitas de campo en el resumen de auditoría (0008).
-- Requiere 0001-0007 aplicados.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.

alter table public.importaciones
  add column visitas_nuevas integer not null default 0,
  add column visitas_actualizadas integer not null default 0;
