-- Asignaciones por código de objetivo (0002).
-- Requiere 0001 aplicado (usa public.cuadrillas y public.es_planificador).
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- Por qué reemplaza la tabla de 0001:
-- La versión original referenciaba pozos/instalaciones por UUID, lo que exigía
-- sincronizar TODO el Excel a la base antes de poder guardar un plan. En la
-- práctica el Excel vive en el navegador y los ids que genera el importador son
-- deterministas ("pozo-BA_0345", "inst-EFBA17"), así que persistir el objetivo
-- como texto da el mismo resultado sin esa sincronización: el plan se recarga
-- y se cruza contra los pozos que el usuario tenga importados en esa sesión.
-- La tabla anterior nunca pudo tener filas (pozos vacía), así que el DROP es
-- seguro.

drop table if exists public.asignaciones;

create table public.asignaciones (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cuadrilla_id uuid not null references public.cuadrillas (id) on delete cascade,
  -- Id completo del objetivo tal como lo usa la app: "pozo|pozo-BA_0345" o
  -- "inst|inst-EFBA17". Determinista respecto al Excel, sobrevive re-imports.
  objetivo_id text not null,
  -- Código legible para mostrar/reportes ("BA 0345", "EF-BA-17").
  objetivo_codigo text not null,
  asignado_por uuid not null default auth.uid() references auth.users (id),
  creado_en timestamptz not null default now()
);

-- Regla de negocio: un objetivo no puede tener dos cuadrillas el mismo día.
-- Reasignar = upsert sobre esta constraint.
create unique index asignaciones_objetivo_fecha_idx on public.asignaciones (fecha, objetivo_id);
create index asignaciones_fecha_idx on public.asignaciones (fecha);
create index asignaciones_cuadrilla_idx on public.asignaciones (cuadrilla_id);

alter table public.asignaciones enable row level security;

-- Mismas políticas que tenía: cualquier autenticado lee el plan;
-- solo un planificador asigna/reasigna/desasigna.
create policy "asignaciones_select" on public.asignaciones
  for select to authenticated using (true);
create policy "asignaciones_escritura" on public.asignaciones
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());
