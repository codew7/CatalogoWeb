// Genera localidades-ar.json a partir de la API oficial Georef (datos.gob.ar).
//
//   node scripts/generar-localidades.mjs
//
// Por qué un archivo estático y no consultar Georef en vivo desde el navegador:
// el listado cambia muy rara vez, un JSON propio sale del mismo hosting (sin
// depender de la disponibilidad ni de los límites de la API pública) y el
// navegador lo cachea. Correr este script de nuevo sólo hace falta si se
// quiere actualizar el listado.
//
// Las claves de provincia son exactamente los value del <select id="provinciaInput">
// del modal de cliente. "CABA" y "Gran Buenos Aires" no son nombres oficiales
// pero la lógica de envíos (historialPedidosWeb.html) depende de ellos, así que
// se respetan: CABA lista sus barrios, "Gran Buenos Aires" las localidades de
// los 24 partidos del conurbano (definición INDEC) y "Buenos Aires" el resto de
// la provincia.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const URL_GEOREF = 'https://apis.datos.gob.ar/georef/api/localidades' +
    '?max=5000&aplanar=true&campos=nombre,provincia.nombre,departamento.nombre';

const SALIDA = fileURLToPath(new URL('../localidades-ar.json', import.meta.url));

const PARTIDOS_GBA = new Set([
    'Almirante Brown', 'Avellaneda', 'Berazategui', 'Esteban Echeverría', 'Ezeiza',
    'Florencio Varela', 'General San Martín', 'Hurlingham', 'Ituzaingó', 'José C. Paz',
    'La Matanza', 'Lanús', 'Lomas de Zamora', 'Malvinas Argentinas', 'Merlo', 'Moreno',
    'Morón', 'Quilmes', 'San Fernando', 'San Isidro', 'San Miguel', 'Tigre',
    'Tres de Febrero', 'Vicente López',
]);

// Nombre oficial en Georef → value del <select>
const RENOMBRE = {
    'Ciudad Autónoma de Buenos Aires': 'CABA',
    'Tierra del Fuego, Antártida e Islas del Atlántico Sur': 'Tierra del Fuego',
};

function provinciaDelSitio(l) {
    const p = RENOMBRE[l.provincia_nombre] || l.provincia_nombre;
    if (p === 'Buenos Aires' && PARTIDOS_GBA.has(l.departamento_nombre)) return 'Gran Buenos Aires';
    return p;
}

const resp = await fetch(URL_GEOREF);
if (!resp.ok) throw new Error(`Georef respondió ${resp.status}`);
const { localidades, total } = await resp.json();
if (localidades.length !== total) throw new Error(`Georef devolvió ${localidades.length} de ${total}`);

const porProvincia = {};
for (const l of localidades) {
    const prov = provinciaDelSitio(l);
    // En CABA Georef incluye una entrada genérica "Ciudad de Buenos Aires" además
    // de los 48 barrios: no sirve como localidad, el barrio es lo que importa.
    if (prov === 'CABA' && l.nombre === 'Ciudad de Buenos Aires') continue;
    // "Nombre|Departamento": el departamento sólo se muestra como ayuda para
    // distinguir homónimos (hay varias "La Florida"); el valor guardado es el nombre.
    (porProvincia[prov] ||= new Set()).add(`${l.nombre.trim()}|${l.departamento_nombre.trim()}`);
}

const col = new Intl.Collator('es', { sensitivity: 'base' });
const p = {};
for (const prov of Object.keys(porProvincia).sort(col.compare)) {
    p[prov] = [...porProvincia[prov]].sort(col.compare);
}

const datos = {
    fuente: 'Georef API · datos.gob.ar (localidades BAHRA)',
    generado: new Date().toISOString().slice(0, 10),
    p,
};

await writeFile(SALIDA, JSON.stringify(datos));
const n = Object.values(p).reduce((a, l) => a + l.length, 0);
console.log(`${n} localidades en ${Object.keys(p).length} provincias → ${SALIDA}`);
