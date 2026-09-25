-- Agrega el checklist operativo por asignación que se exporta al Excel del
-- plan del día: prioridad (número libre) y 3 columnas Sí/No.
alter table public.asignaciones
  add column if not exists prioridad integer null,
  add column if not exists validar_ajuste boolean not null default false,
  add column if not exists requiere_manometro boolean not null default false,
  add column if not exists requiere_nivel boolean not null default false;
