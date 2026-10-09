-- Indicadores operativos por pozo (0012).
-- Requiere 0001-0011 aplicados.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- Proyección reducida de `visitas_campo`: en vez de escanear decenas de miles
-- de visitas GL/BES en cada filtro, cada importación pre-calcula las señales
-- operativas (registro manométrico, ajuste de gas, niveles, chequeo físico,
-- visita a pozo real) y guarda una fila por (visita, indicador):
--
--   pozo_id | fecha      | indicador             | valor
--   BA-2455 | 2026-10-05 | registro_manometrico  | 1
--
-- `valor` es 1 para indicadores de evento ("sí ocurrió") y el valance
-- numérico (qg encontrado − ajustado) para 'ajuste_gl'; null cuando el ajuste
-- se marcó pero los caudales no venían en la fila.
--
-- Se reconstruye completa en cada import (delete + insert): es data derivada,
-- idempotente gracias a `id` = `${visita_id}|${indicador}` — reimportar el
-- mismo Excel no genera duplicados.

create table public.pozo_indicadores (
  id text primary key,
  pozo_id text not null references public.pozos (id) on delete cascade,
  pozo_codigo text not null default '',
  fecha date not null,
  indicador text not null check (indicador in (
    'registro_manometrico', 'ajuste_gl', 'niveles', 'chequeo_fisico', 'visita_pozo'
  )),
  valor double precision,
  visita_id text references public.visitas_campo (id) on delete cascade,
  actualizado_en timestamptz not null default now()
);

create index pozo_indicadores_pozo_idx on public.pozo_indicadores (pozo_id);
create index pozo_indicadores_ind_fecha_idx on public.pozo_indicadores (indicador, fecha);
create index pozo_indicadores_fecha_idx on public.pozo_indicadores (fecha);

alter table public.pozo_indicadores enable row level security;

create policy "pozo_indicadores_select" on public.pozo_indicadores
  for select to authenticated using (true);
create policy "pozo_indicadores_escritura" on public.pozo_indicadores
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());
