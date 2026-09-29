-- Universo pozos/instalaciones persistido en Supabase (0005).
-- Requiere 0001-0004 aplicados (usa public.tipos_instalacion y public.es_planificador).
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- Recrea instalaciones/pozos/pozo_completaciones (vacías desde 0001) con PK
-- texto = id determinista del importador ("inst-EFBA17", "pozo-BA_0345",
-- "pozo-BA_0345#2"). Ventaja directa: asignaciones.objetivo_id
-- ("pozo|pozo-BA_0345") calza con pozos.id sin joins ni columnas puente, y el
-- sync desde Excel es un upsert por PK + diff sobre la llave natural.
--
-- Semántica de activo: 'presente en el último Excel aplicado'. Un pozo que
-- desaparece del archivo queda activo=false (soft-delete) — nunca se borra,
-- para preservar historial de asignaciones y de reemplazos.

drop table if exists public.pozo_completaciones;
drop table if exists public.pozos;
drop table if exists public.instalaciones;

-- ---------------------------------------------------------------------------
-- instalaciones
-- ---------------------------------------------------------------------------
create table public.instalaciones (
  -- "inst-<clave normalizada del código>" (mismo id que genera el importador).
  id text primary key,
  tipo text not null references public.tipos_instalacion (codigo),
  codigo text not null,
  campo text not null check (campo in ('BA', 'VLC', 'VLG')),
  lat double precision,
  lon double precision,
  -- stub: la creó el cruce EF/MG de un pozo sin existir en la hoja
  -- Instalaciones; queda sin coordenadas hasta aparecer definida.
  es_stub boolean not null default false,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

create index instalaciones_tipo_idx on public.instalaciones (tipo);
create index instalaciones_campo_idx on public.instalaciones (campo);
create index instalaciones_activo_idx on public.instalaciones (activo);

-- ---------------------------------------------------------------------------
-- pozos: una fila por código completo (campo + número + letra de reemplazo).
-- ---------------------------------------------------------------------------
create table public.pozos (
  -- "pozo-<codigo con _>" ej. "pozo-BA_0345" (mismo id del importador).
  id text primary key,
  campo text not null check (campo in ('BA', 'VLC', 'VLG')),
  numero integer not null,
  -- '' = pozo original; 'A'-'D' = reemplazo. '' en vez de null por la
  -- unicidad parcial de abajo (NULL no colisiona con NULL).
  reemplazo text not null default '' check (reemplazo in ('', 'A', 'B', 'C', 'D')),
  codigo text not null, -- código tal como en el Excel, ej. "BA 345A"
  -- nullable: el Excel a veces no trae coords — el pozo existe pero no se dibuja.
  lat double precision,
  lon double precision,
  ef_id text references public.instalaciones (id),
  mg_id text references public.instalaciones (id),
  pc_id text references public.instalaciones (id),
  pbes_id text references public.instalaciones (id),
  -- true si existe otro pozo del mismo (campo, numero) con letra mayor.
  reemplazado boolean not null default false,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

-- Un solo pozo "vigente" por pozo físico: activo y no reemplazado.
create unique index pozos_vigente_unico_idx
  on public.pozos (campo, numero)
  where activo and not reemplazado;
create index pozos_campo_idx on public.pozos (campo);
create index pozos_ef_idx on public.pozos (ef_id);
create index pozos_mg_idx on public.pozos (mg_id);
create index pozos_activo_idx on public.pozos (activo);

-- ---------------------------------------------------------------------------
-- pozo_completaciones: una fila por arena/yacimiento (NB_YACIMIENTO).
-- El id es posicional ("pozo-X#n") — la llave de negocio real para el diff
-- es unique(pozo_id, nb_yacimiento); el upsert se hace sobre esa constraint
-- para que reordenamientos de filas del Excel no dupliquen arenas.
-- ---------------------------------------------------------------------------
create table public.pozo_completaciones (
  id text primary key,
  pozo_id text not null references public.pozos (id) on delete cascade,
  nb_yacimiento text not null,
  coa text not null check (coa in ('Abierto', 'Cerrado', 'Indeterminado')),
  metodo text check (metodo in ('GL', 'BES', 'NF', 'BM', 'BCP')),
  cat numeric,
  bnpd numeric,          -- null = dato no reportado, distinto de 0
  bnpd_fecha date,       -- fecha de la última medición de BNPD
  pot numeric,           -- potencial BPD para producción diferida
  edo text,              -- código de estado/condición (columna EDO)
  unique (pozo_id, nb_yacimiento)
);

create index pozo_completaciones_pozo_idx on public.pozo_completaciones (pozo_id);
create index pozo_completaciones_coa_idx on public.pozo_completaciones (coa);

-- ---------------------------------------------------------------------------
-- importaciones: una fila por sync aplicado (auditoría de quién cargó qué).
-- ---------------------------------------------------------------------------
create table public.importaciones (
  id uuid primary key default gen_random_uuid(),
  importado_por uuid not null default auth.uid() references auth.users (id),
  archivo text, -- nombre del archivo subido
  inst_nuevas integer not null default 0,
  inst_actualizadas integer not null default 0,
  inst_desactivadas integer not null default 0,
  pozos_nuevos integer not null default 0,
  pozos_actualizados integer not null default 0,
  pozos_desactivados integer not null default 0,
  comps_nuevas integer not null default 0,
  comps_actualizadas integer not null default 0,
  comps_eliminadas integer not null default 0,
  n_alertas integer not null default 0, -- alertas que generó el parseo del Excel
  creado_en timestamptz not null default now()
);

create index importaciones_fecha_idx on public.importaciones (creado_en);

-- ---------------------------------------------------------------------------
-- import_cambios: detalle campo-a-campo del diff aplicado (qué cambió).
-- Una fila por campo modificado; los 'nuevo'/'desactivado' van con campo null.
-- ---------------------------------------------------------------------------
create table public.import_cambios (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.importaciones (id) on delete cascade,
  entidad text not null check (entidad in ('instalacion', 'pozo', 'completacion')),
  tipo text not null check (tipo in ('nuevo', 'actualizado', 'desactivado', 'eliminado')),
  -- Identificador legible: "BA 0345", "EF-BA-17", "BA 0345 · ARENA-12".
  clave text not null,
  campo text,          -- columna que cambió (solo en 'actualizado')
  valor_antes text,
  valor_despues text
);

create index import_cambios_import_idx on public.import_cambios (import_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (mismo patrón que 0001): lectura a todo autenticado;
-- escritura solo planificador — el sync corre con su sesión.
-- ---------------------------------------------------------------------------
alter table public.instalaciones enable row level security;
alter table public.pozos enable row level security;
alter table public.pozo_completaciones enable row level security;
alter table public.importaciones enable row level security;
alter table public.import_cambios enable row level security;

create policy "instalaciones_select" on public.instalaciones
  for select to authenticated using (true);
create policy "instalaciones_escritura" on public.instalaciones
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());

create policy "pozos_select" on public.pozos
  for select to authenticated using (true);
create policy "pozos_escritura" on public.pozos
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());

create policy "pozo_completaciones_select" on public.pozo_completaciones
  for select to authenticated using (true);
create policy "pozo_completaciones_escritura" on public.pozo_completaciones
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());

create policy "importaciones_select" on public.importaciones
  for select to authenticated using (true);
create policy "importaciones_escritura" on public.importaciones
  for insert to authenticated with check (public.es_planificador());

create policy "import_cambios_select" on public.import_cambios
  for select to authenticated using (true);
create policy "import_cambios_escritura" on public.import_cambios
  for insert to authenticated with check (public.es_planificador());
