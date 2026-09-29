const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
// extraer solo las funciones de logica (antes de "let ultimoResultado" no hace falta)
js = js.split('function procesar')[0];

eval(js);

const msg =
  "\u{1F7E2} VLG3301A prod\n" +
  "\u{1F534} BA-11\n" +
  "\u{1F7E2} BA 11A\n" +
  "\u{1F534} BB1234\n" +
  "\u{1F534} VLC1234X\n" +
  "\u{1F7E2} BA235X\n" +
  "\u{1F534} BBA99\n" +
  "   VLG9999 esta linea no tiene icono, se ignora\n" +
  "texto con \u{1F7E2} icono en el medio BA77, se ignora\n" +
  "\u{1F7E2} BA 793 - 300\n" +
  "\u{1F534} BA 793A - 300\n" +
  "\u{1F7E2} BA 793 A\n" +
  "\u{1F534} BA 1075A\n" +
  "\u{1F7E2} BA1075\n" +
  "\u{1F534} BA 12345A";

const out = new Map();
for (const linea of msg.split("\n")) {
  const e = estadoDeLinea(linea);
  if (!e) continue;
  const pozos = extraerPozos(linea);
  for (const p of pozos) if (!out.has(p)) out.set(p, e);
}
console.log([...out.entries()]);
