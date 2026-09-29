-- Marca de origen del estatus COA de cada completación (0010).
-- Requiere 0001-0009 aplicados.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run.
--
-- El módulo "Estatus por mensaje" (ModalCoa) actualiza coa desde un mensaje
-- operativo pegado (🟢 abierto / 🔴 cerrado). Estas columnas distinguen ese
-- cambio manual del que llega por la sincronización del Excel:
--   coa_origen = 'excel'   → vino del import (default; la sync lo reescribe)
--   coa_origen = 'mensaje' → vino del mensaje COA pegado en la app
--   coa_fecha             → cuándo se aplicó ese cambio por mensaje.

alter table public.pozo_completaciones
  add column if not exists coa_origen text not null default 'excel',
  add column if not exists coa_fecha timestamptz;
