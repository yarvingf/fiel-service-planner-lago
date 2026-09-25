-- Asignaciones con actividad y nota (0003).
-- Requiere 0002 aplicado.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- actividad: qué va a hacer la cuadrilla en ese objetivo (texto libre; la app
-- sugiere valores comunes pero no los exige — el vocabulario operativo se
-- descubre en el uso).
-- nota: observación libre de la asignación.

alter table public.asignaciones
  add column actividad text,
  add column nota text;
