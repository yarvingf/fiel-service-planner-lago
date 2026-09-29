-- Visitas de campo: bitácora GL/BES persistida en Supabase (0007).
-- Requiere 0001-0006 aplicados.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- Historial de visitas/inspecciones a pozos (hojas "GL" y "BES" del Excel).
-- Distinto de pozo_completaciones: aquello es una foto del estado actual del
-- pozo; esto es un registro histórico por evento que solo crece, y donde una
-- corrección posterior actualiza la fila existente (misma llave de negocio),
-- nunca la reemplaza por una fila nueva.
--
-- Llave de negocio: (tipo, fecha, pozo_texto, cuadrilla) — decisión operativa
-- confirmada: una visita se identifica por cuándo, a qué pozo y qué cuadrilla
-- la hizo. `id` es determinista a partir de esa llave (ver domain/visitaCampo.ts).
--
-- Solo se modelan como columnas propias los campos comunes útiles para
-- filtrar/mostrar resumen; las decenas de lecturas específicas de cada
-- método (presiones de GL, lecturas eléctricas de VSD en BES, etc.) se
-- conservan íntegras en `datos_extra` (jsonb) para no perder fidelidad sin
-- necesitar una columna por cada una.

create table public.visitas_campo (
  id text primary key,
  tipo text not null check (tipo in ('GL', 'BES')),
  fecha date not null,
  -- Código del pozo tal como venía en la hoja (puede no calzar con pozos.id).
  pozo_texto text not null,
  pozo_id text references public.pozos (id),
  cuadrilla text not null default '',
  campo text check (campo in ('BA', 'VLC', 'VLG')),
  tipo_actividad text,
  estado_inicial text,
  estado_final text,
  comentarios text,
  hora_inicio text,
  hora_fin text,
  datos_extra jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  unique (tipo, fecha, pozo_texto, cuadrilla)
);

create index visitas_campo_pozo_idx on public.visitas_campo (pozo_id);
create index visitas_campo_fecha_idx on public.visitas_campo (fecha);
create index visitas_campo_tipo_idx on public.visitas_campo (tipo);

alter table public.visitas_campo enable row level security;

create policy "visitas_campo_select" on public.visitas_campo
  for select to authenticated using (true);
create policy "visitas_campo_escritura" on public.visitas_campo
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());
