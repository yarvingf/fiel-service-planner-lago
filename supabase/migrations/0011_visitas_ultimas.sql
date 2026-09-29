-- Vista de últimas visitas por pozo (0011).
-- Requiere 0007 aplicado. Ejecutar completo en:
-- Supabase Dashboard > SQL Editor > New query > Run.
--
-- La app al arrancar solo necesita "la última visita GL/BES de cada pozo"
-- (marcador de días sin visita + resumen en el detalle), no las ~10k filas
-- del historial completo con sus datos_extra. Esta vista devuelve una sola
-- fila por pozo (~1.4k filas) con DISTINCT ON — PostgREST la expone como
-- tabla de solo lectura. El historial completo de un pozo se pide aparte
-- (listarVisitasPozo) solo cuando se abre su detalle.
--
-- DISTINCT ON (pozo_id) + ORDER BY fecha DESC = la visita más reciente por
-- pozo. Se excluyen filas sin pozo resuelto (pozo_id null): la app solo
-- consume visitas vinculadas al universo.

create or replace view public.visitas_ultimas as
select distinct on (pozo_id) *
from public.visitas_campo
where pozo_id is not null
order by pozo_id, fecha desc;

-- Las vistas heredan permisos del rol dueño, no del RLS de la tabla base;
-- hay que dar SELECT explícito al rol que usa la app.
grant select on public.visitas_ultimas to authenticated;
