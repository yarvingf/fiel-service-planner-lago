-- Política de escritura faltante en tipos_instalacion (0006).
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- 0001 dejó esta tabla como "catálogo de solo lectura" (solo política de
-- SELECT), asumiendo que crecería manualmente. El sync de 0005 necesita
-- poder registrar tipos de instalación nuevos que aparezcan en el Excel
-- (upsert en tipos_instalacion antes de insertar la instalación que los usa)
-- — sin esta política, RLS rechaza el insert con "permission denied"
-- (código 42501) sin importar el rol del usuario.

create policy "tipos_instalacion_escritura" on public.tipos_instalacion
  for all to authenticated using (public.es_planificador()) with check (public.es_planificador());
