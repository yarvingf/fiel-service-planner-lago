-- Permite entidad='visita' en import_cambios (0009).
-- Requiere 0001-0008 aplicados.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- La restricción original (0005) solo permitía 'instalacion' | 'pozo' |
-- 'completacion' — al agregar la bitácora de visitas GL/BES (0007) el
-- código empezó a insertar filas con entidad='visita' en el detalle de
-- auditoría, y Postgres las rechazaba (400 Bad Request / check violation).

do $$
declare
  nombre_constraint text;
begin
  -- Busca el nombre real del check constraint sobre la columna `entidad`
  -- (Postgres lo autogenera; no asumimos el nombre exacto por si difiere).
  select con.conname into nombre_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'import_cambios'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%entidad%';

  if nombre_constraint is not null then
    execute format('alter table public.import_cambios drop constraint %I', nombre_constraint);
  end if;

  alter table public.import_cambios
    add constraint import_cambios_entidad_check
    check (entidad in ('instalacion', 'pozo', 'completacion', 'visita'));
end $$;
