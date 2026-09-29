# -*- coding: utf-8 -*-
"""
Parser de pozos Abiertos/Cerrados.
Pega el mensaje en el cuadro de texto y presiona "Procesar".

Reglas:
 - Circulo verde  = Abierto
 - Circulo rojo   = Cerrado
 - VLC/VLG + 4 digitos + letra opcional (solo A o B)  ->  VLG3301A
 - BA + numero (pegado, separado o con guion):
     se admite un espacio/guion entre "BA" y el numero,
     pero el numero termina en el primer espacio o guion
     que encuentre (no se agarra lo que venga despues,
     ej. "BA 793 - 300" -> solo toma "793").
     Una letra final solo cuenta si esta pegada directamente
     al numero (sin espacio). Se rellena con ceros a la
     izquierda hasta 4 caracteres (la letra cuenta).
     Resultado: "BA 0011", "BA 011A"
"""

import re
import tkinter as tk
from tkinter import ttk, messagebox

VERDE = "\U0001F7E2"   # circulo verde
ROJO = "\U0001F534"    # circulo rojo



# Si despues de los 4 digitos viene una letra que no es A/B, se guarda sin letra
RE_VL = re.compile(r"\b(VL[CG])\s*-?\s*(\d{4})([AB])?", re.IGNORECASE)
# "BA" + separador opcional (espacio/guion) + numero.
# El numero (y su letra pegada, si tiene) se detiene en el primer
# espacio o guion: no sigue de largo hacia otro numero.
RE_BA = re.compile(r"\bBA[ \t-]*(\d+[A-Za-z]?)", re.IGNORECASE)


def estado_de_linea(linea):
    """Regla de oro: solo cuenta si la linea EMPIEZA con circulo verde o rojo."""
    t = linea.lstrip()
    if t.startswith(VERDE):
        return "ABIERTO"
    if t.startswith(ROJO):
        return "CERRADO"
    return None


def normalizar_vl(match):
    prefijo = match.group(1).upper()
    numero = match.group(2)
    letra = (match.group(3) or "").upper()
    return f"{prefijo}{numero}{letra}"


def normalizar_ba(token):
    """Recibe el numero (y letra pegada, si tiene) ya aislado por el regex.

    Se completan ceros a la izquierda hasta que el numero + letra sumen
    4 caracteres. Si el numero ya tiene 4 digitos o mas (>=1000), la
    letra NUNCA se recorta, se agrega completa igual que en VLC/VLG.
    """
    m = re.match(r"(\d+)([A-Za-z]?)$", token, re.IGNORECASE)
    numero, letra = (m.group(1), m.group(2).upper()) if m else (token, "")
    numero = numero.rjust(4 - len(letra), "0")
    return f"BA {numero}{letra}"


def extraer_pozos(linea):
    """Devuelve la lista de pozos normalizados encontrados en la linea."""
    pozos = []
    ocupados = []  # rangos ya consumidos por VL para no duplicar

    for m in RE_VL.finditer(linea):
        pozos.append(normalizar_vl(m))
        ocupados.append(m.span())

    for m in RE_BA.finditer(linea):
        # ignorar si el "BA" esta dentro de un match VL (poco probable, pero por seguridad)
        if any(s <= m.start() < e for s, e in ocupados):
            continue
        pozos.append(normalizar_ba(m.group(1)))
        ocupados.append(m.span())

    return pozos


def procesar(texto):
    abiertos, cerrados = [], []
    for linea in texto.splitlines():
        estado = estado_de_linea(linea)
        if not estado:
            continue
        pozos = extraer_pozos(linea)
        if estado == "ABIERTO":
            abiertos.extend(pozos)
        else:
            cerrados.extend(pozos)
    # quitar duplicados conservando orden
    return list(dict.fromkeys(abiertos)), list(dict.fromkeys(cerrados))


# ----------------------------- GUI -----------------------------

def main():
    root = tk.Tk()
    root.title("Parser de Pozos - Abiertos/Cerrados")
    root.geometry("720x620")

    ttk.Label(root, text="Pega aqui el mensaje:").pack(anchor="w", padx=8, pady=(8, 0))
    entrada = tk.Text(root, height=14, wrap="word")
    entrada.pack(fill="both", expand=True, padx=8, pady=4)

    ttk.Label(root, text="Resultado:").pack(anchor="w", padx=8)
    salida = tk.Text(root, height=14, wrap="word", bg="#f4f4f4")
    salida.pack(fill="both", expand=True, padx=8, pady=4)

    def on_procesar():
        texto = entrada.get("1.0", "end")
        abiertos, cerrados = procesar(texto)
        # Salida separada por TAB: al pegar en Excel/Sheets queda en 2 columnas
        lineas = ["Pozo\tEstatus"]
        lineas += [f"{p}\tAbierto" for p in abiertos]
        lineas += [f"{p}\tCerrado" for p in cerrados]
        salida.delete("1.0", "end")
        salida.insert("1.0", "\n".join(lineas))

    def on_limpiar():
        entrada.delete("1.0", "end")
        salida.delete("1.0", "end")

    btns = ttk.Frame(root)
    btns.pack(fill="x", padx=8, pady=(0, 8))
    ttk.Button(btns, text="Procesar", command=on_procesar).pack(side="left")
    ttk.Button(btns, text="Limpiar", command=on_limpiar).pack(side="left", padx=6)
    ttk.Button(btns, text="Copiar resultado",
               command=lambda: (root.clipboard_clear(),
                                root.clipboard_append(salida.get("1.0", "end")),
                                messagebox.showinfo("Listo", "Resultado copiado"))
               ).pack(side="left")

    root.mainloop()


if __name__ == "__main__":
    main()
