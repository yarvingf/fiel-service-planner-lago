# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, ".")
from pozos_parser import procesar

msg = (
    "\U0001F7E2 VLG3301A produccion\n"
    "\U0001F534 VLC 1234\n"
    "\U0001F7E2 BA 11A\n"
    "\U0001F534 BA-11\n"
    "\U0001F7E2 BA- 235\n"
    "\U0001F534 BA235X extra\n"
    "\U0001F7E2 VLG3301B otra cosa\n"
    "linea sin pozo\n"
    "\U0001F7E2 BA 793 - 300\n"
    "\U0001F534 BA 793A - 300\n"
    "\U0001F7E2 BA 793 A\n"
    "\U0001F534 BA 1075A\n"
    "\U0001F7E2 BA1075\n"
    "\U0001F534 BA 12345A\n"
)

a, c = procesar(msg)
print("ABIERTOS:", a)
print("CERRADOS:", c)
