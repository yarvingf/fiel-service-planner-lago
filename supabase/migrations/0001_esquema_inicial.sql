-- Esquema inicial de Fiel Service Planner - Lago.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- Decisiones de diseño (para referencia futura):
-- - RLS habilitado en TODAS las tablas desde el día uno: la clave anónima es
--   pública por diseño, así que RLS es el único perímetro de seguridad real.
-- - Roles: 'planificador' (crea cuadrillas, importa, asigna) y 'consulta' (solo lee).
-- - pozos: solo se guarda el pozo ACTIVO (letra de reemplazo más alta) como
--   fila con activo=true; los reemplazados quedan con activo=false para
--   conservar el historial sin aparecer en el mapa ni ser asignables.
-- - Instalaciones sin coordenadas en el Excel se crean igual como "stub"
--   (es_stub=true): sirven para filtrar aunque no se puedan dibujar.
-- - Asignación por día (fecha), sin estado de ejecución: la tabla asignaciones
--   es la fuente de verdad de "quién va adónde", y su historial es cada fila.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: uno por usuario de auth.users, con su rol de aplicación.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('planificador', 'consulta')),
  creado_en timestamptz not null default now()
);

comment on table public.profiles is 'Rol de aplicación de cada usuario. Se crea manualmente al dar de alta un usuario en Authentication.';

-- Función auxiliar: ¿el usuario actual es planificador? Se usa en las políticas de escritura.
create function public.es_planificador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and rol = 'planificador'
  );
$$;

-- ---------------------------------------------------------------------------
-- tipos_instalacion: catálogo abierto (crece agregando filas, sin migración).
-- LOCACIÓN queda fuera a propósito: es un área a perforar en tierra, sin
-- coordenadas de interés para esta app (solo Lago).
-- ---------------------------------------------------------------------------
create table public.tipos_instalacion (
  codigo text primary key,
  descripcion text not null
);

insert into public.tipos_instalacion (codigo, descripcion) values
  ('EF', 'Estación de Flujo'),
  ('MG', 'Múltiple de Gas'),
  ('MLPR', 'Múltiple (por confirmar significado exacto)'),
  ('MAP', 'Múltiple de Alta Presión'),
  ('MB', 'Múltiple de Baja Presión'),
  ('MIA', 'Múltiple de Inyección de Agua'),
  ('MP', 'Múltiple de Producción'),
  ('MR', 'Múltiple de Recolección'),
  ('PBES', 'Plataforma BES'),
  ('PC', 'Planta Compresora'),
  ('PIA', 'Planta de Inyección de Agua');

-- ---------------------------------------------------------------------------
-- instalaciones
-- ---------------------------------------------------------------------------
create table public.instalaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null references public.tipos_instalacion (codigo),
  codigo text not null,
  campo text not null check (campo in ('BA', 'VLC', 'VLG')),
  lat double precision,
  lon double precision,
  -- true = se creó automáticamente porque un pozo la referenciaba y no
  -- existía en el catálogo importado; queda sin coordenadas hasta que se
  -- agregue manualmente o aparezca definida en un import posterior.
  es_stub boolean not null default false,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now(),
  unique (tipo, codigo)
);

create index instalaciones_tipo_idx on public.instalaciones (tipo);
create index instalaciones_campo_idx on public.instalaciones (campo);

-- ---------------------------------------------------------------------------
-- pozos: una fila por pozo FÍSICO. Solo el de reemplazo más alto queda activo.
-- ---------------------------------------------------------------------------
create table public.pozos (
  id uuid primary key default gen_random_uuid(),
  campo text not null check (campo in ('BA', 'VLC', 'VLG')),
  numero integer not null,
  -- '' = pozo original (sin reemplazo). '' en vez de null para poder usar
  -- una unique constraint simple más abajo (NULL no es comparable a NULL).
  reemplazo text not null default '' check (reemplazo in ('', 'A', 'B', 'C', 'D')),
  codigo text not null, -- código de despliegue tal como en el Excel, ej. "BA 345A"
  lat double precision not null,
  lon double precision not null,
  ef_id uuid references public.instalaciones (id),
  mg_id uuid references public.instalaciones (id),
  pc_id uuid references public.instalaciones (id),
  pbes_id uuid references public.instalaciones (id),
  -- true si existe un pozo del mismo (campo, numero) con letra de reemplazo mayor.
  reemplazado boolean not null default false,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);

-- Solo puede haber un pozo activo por (campo, número): el resto son historia.
create unique index pozos_activo_unico_idx on public.pozos (campo, numero) where activo;
create index pozos_campo_idx on public.pozos (campo);
create index pozos_ef_idx on public.pozos (ef_id);
create index pozos_mg_idx on public.pozos (mg_id);

-- ---------------------------------------------------------------------------
-- pozo_completaciones: una fila por arena/yacimiento (columna NB_YACIMIENTO).
-- ---------------------------------------------------------------------------
create table public.pozo_completaciones (
  id uuid primary key default gen_random_uuid(),
  pozo_id uuid not null references public.pozos (id) on delete cascade,
  nb_yacimiento text not null,
  coa text not null check (coa in ('Abierto', 'Cerrado', 'Indeterminado')),
  metodo text check (metodo in ('GL', 'BES', 'NF', 'BM', 'BCP')),
  cat integer,
  bnpd numeric, -- null = dato no reportado, distinto de 0
  bnpd_fecha date,
  pot numeric, -- null = dato no reportado, distinto de 0
  unique (pozo_id, nb_yacimiento)
);

create index pozo_completaciones_pozo_idx on public.pozo_completaciones (pozo_id);
create index pozo_completaciones_coa_idx on public.pozo_completaciones (coa);

-- ---------------------------------------------------------------------------
-- cuadrillas
-- ---------------------------------------------------------------------------
create table public.cuadrillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  color text not null,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- asignaciones: plan por día. Un pozo (o instalación) no puede tener dos
-- cuadrillas el mismo día (se traduce a un índice único, no solo a una regla
-- de la UI).
-- ---------------------------------------------------------------------------
create table public.asignaciones (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cuadrilla_id uuid not null references public.cuadrillas (id),
  pozo_id uuid references public.pozos (id),
  instalacion_id uuid references public.instalaciones (id),
  asignado_por uuid not null default auth.uid() references auth.users (id),
  creado_en timestamptz not null default now(),
  constraint asignacion_un_solo_objetivo check (
    (pozo_id is not null)::int + (instalacion_id is not null)::int = 1
  )
);

-- NULL no colisiona con NULL en un índice único de Postgres, así que estas
-- dos constraints conviven sin problema (cada asignación solo llena una).
create unique index asignaciones_pozo_fecha_idx on public.asignaciones (fecha, pozo_id) where pozo_id is not null;
create unique index asignaciones_instalacion_fecha_idx on public.asignaciones (fecha, instalacion_id) where instalacion_id is not null;
create index asignaciones_fecha_idx on public.asignaciones (fecha);
create index asignaciones_cuadrilla_idx on public.asignaciones (cuadrilla_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tipos_instalacion enable row level security;
alter table public.instalaciones enable row level security;
alter table public.pozos enable row level security;
alter table public.pozo_completaciones enable row level security;
alter table public.cuadrillas enable row level security;
alter table public.asignaciones enable row level security;

-- profiles: cada quien ve su propio perfil y el de los demás (para mostrar
-- nombres en reportes), pero solo un planificador puede modificar roles.
create policy "profiles_select_autenticado" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_propio" on public.profiles
  for update to authenticated using (id = auth.uid());

-- tipos_instalacion: catálogo de solo lectura para todos los autenticados.
create policy "tipos_instalacion_select" on public.tipos_instalacion
  for select to authenticated using (true);

-- instalaciones / pozos / pozo_completaciones: lectura para cualquier
-- autenticado (planificador y consulta); escritura solo planificador
-- (el import corre en el navegador autenticado como planificador).
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

-- cuadrillas: cualquier autenticado lee; solo planificador administra.
create policy "cuadrillas_select" on public.cuadrillas
  for select to authenticated using (true);
create policy "cuadrillas_escritura" on public.cuadrillas
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());

-- asignaciones: cualquier autenticado lee; solo planificador asigna/reasigna.
create policy "asignaciones_select" on public.asignaciones
  for select to authenticated using (true);
create policy "asignaciones_escritura" on public.asignaciones
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());
