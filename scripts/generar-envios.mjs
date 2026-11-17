// Genera envios/<provincia>.json: qué sucursales de Correo Argentino, Vía Cargo
// y Flecha Carga le sirven a cada localidad del sitio.
//
//   node scripts/generar-envios.mjs [ruta/a/datos.json]
//
// La fuente es el dataset del proyecto "¿Llega?" (homepoint/Cotizadores/
// Disponibilidad/datos.json), que ya baja y cruza las tres empresas por CP:
//   · Correo Argentino: sucursales habilitadas de MiCorreo + dirección y horario.
//   · Vía Cargo: sólo agencias que reciben encomiendas (API Busplus).
//   · Flecha Carga: puntos de la web oficial, sin los "solo domicilio/despacho".
// Para actualizar: correr "Actualizar datos.bat" allá y después este script.
//
// Qué se calcula acá (para que el navegador no haga geometría ni baje datos de
// más):
//   · Cobertura local: sucursales cuyo CP es uno de los CP de la localidad.
//   · Si una empresa no tiene sucursal local, la más cercana a 30 km o menos
//     (haversine contra todas las sucursales del país, así las localidades de
//     frontera también encuentran la del otro lado).
//   · Las sucursales locales van ordenadas por distancia al centro de la
//     localidad: en Rosario hay 68 del Correo y las primeras son las útiles.
//   · Nombres, direcciones y horarios ya legibles (MiCorreo los da en
//     mayúsculas) y el destino del link "Mapa" ya resuelto.
//
// Un archivo por provincia del sitio, con las mismas claves que el <select>
// del modal de cliente (CABA y Gran Buenos Aires incluidos): cada página baja
// sólo el de su cliente.

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ORIGEN = process.argv[2] ||
    path.join(RAIZ, '..', 'homepoint', 'Cotizadores', 'Disponibilidad', 'datos.json');
const SALIDA = path.join(RAIZ, 'envios');
const RADIO_CERCANA_KM = 30;
const EMPRESAS = ['c', 'v', 'f'];   // Correo Argentino, Vía Cargo, Flecha Carga

const datos = JSON.parse(await readFile(ORIGEN, 'utf8'));
const localidadesSitio = JSON.parse(await readFile(path.join(RAIZ, 'localidades-ar.json'), 'utf8')).p;

/* ---------- Normalización (misma que usa el navegador en envios-ar.js) ---------- */

const sinTildes = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function clave(s) {
    return sinTildes(s).replace(/[.,;:'´`"()]/g, ' ').split(/\s+/).filter(Boolean)
        .filter(p => !datos.conect.includes(p))
        .map(p => datos.abrev[p] || p)
        .join(' ');
}

const SIGLAS = new Set(['UP', 'CP', 'YPF', 'SA', 'SRL', 'SN', 'GBA', 'CABA', 'II', 'III', 'IV', 'VI', 'VII',
    'VIII', 'IX', 'XI', 'XII', 'RN', 'RP', 'PB', 'BNA']);
const MINUSCULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'A', 'EN', 'ENTRE', 'AL']);
function legible(s) {
    const texto = String(s ?? '').trim();
    if (/[a-záéíóúñ]/.test(texto)) return texto;
    return texto.replace(/[A-ZÁÉÍÓÚÜÑ]+/g, (p, pos) => {
        if (SIGLAS.has(p)) return p;
        if (pos > 0 && MINUSCULAS.has(p)) return p.toLowerCase();
        if (p.length > 1 && p.length < 4 && !/[AEIOUÁÉÍÓÚ]/.test(p) && p !== 'NRO' && p !== 'ST') return p;
        return p[0] + p.slice(1).toLowerCase();
    });
}

function distanciaKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
        Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

// Igual que urlMapa() de ¿Llega?: con coordenadas exactas se usan; si son
// aproximadas (centro del CP) el mapa busca por dirección.
function destinoMapa(s, empresa) {
    const [nombre, direccion, cp, , , lat, lng, aprox] = s;
    if (direccion && lat != null && !aprox) return `${lat},${lng}`;
    if (direccion) return `${legible(direccion)}, CP ${cp}, Argentina`;
    return `${empresa} ${legible(nombre)}, CP ${cp}, Argentina`;
}
const NOMBRE_EMPRESA = { c: 'Correo Argentino', v: 'Vía Cargo', f: 'Flecha Carga' };

/* ---------- Índice de localidades de datos.json por provincia ---------- */

// Provincia del sitio → provincia de datos.json
const PROV_ORIGEN = p => (p === 'Gran Buenos Aires' ? 'Buenos Aires' : p);

const indice = new Map();   // "PROV|CLAVE" → [localidad datos.json]
function indexar(nombre, loc) {
    const k = datos.prov[loc[1]] + '|' + clave(nombre);
    if (!indice.has(k)) indice.set(k, []);
    if (!indice.get(k).includes(loc)) indice.get(k).push(loc);
}
for (const loc of datos.l) {
    indexar(loc[0], loc);
    for (const alias of loc[5]) indexar(alias, loc);
}

/* ---------- Cobertura por localidad ---------- */

function cobertura(locsOrigen) {
    // Centro: el primero con coordenadas (si hay homónimos se usan todos para
    // la cobertura local, pero la distancia se mide desde el primero).
    const centro = locsOrigen.find(l => l[3] != null);
    return EMPRESAS.map(e => {
        const locales = new Set();
        for (const l of locsOrigen) for (const cp of l[2]) {
            const fila = datos.cp[cp];
            if (fila) fila[EMPRESAS.indexOf(e)].forEach(i => locales.add(i));
        }
        const lista = datos.suc[e];
        if (locales.size) {
            const orden = [...locales];
            if (centro) {
                // Las que no tienen dirección publicada van al final: no le
                // sirven al cliente para ir a retirar.
                const d = i => (lista[i][5] == null ? 1e9 : distanciaKm(centro[3], centro[4], lista[i][5], lista[i][6])) +
                    (lista[i][1] ? 0 : 1e6);
                orden.sort((a, b) => d(a) - d(b));
            }
            return { locales: orden };
        }
        if (!centro) return null;
        let mejor = null;
        lista.forEach((s, i) => {
            if (s[5] == null) return;
            const km = distanciaKm(centro[3], centro[4], s[5], s[6]);
            if (km <= RADIO_CERCANA_KM && (!mejor || km < mejor.km)) mejor = { i, km };
        });
        return mejor ? { cercana: mejor } : null;
    });
}

/* ---------- Respaldo para localidades que datos.json no tiene ----------
   localidades-ar.json sale de Georef "localidades" y datos.json de otra
   combinación de listados, así que ~1 % no cruza (p. ej. "Mar de Ajó - San
   Bernardo"). Para esas se pide a Georef su centro: sin CP propio no hay
   cobertura local, pero sí la sucursal más cercana, que es lo que importa. */

let centrosGeoref = null;
async function centroGeoref(provSitio, nombre) {
    if (!centrosGeoref) {
        centrosGeoref = new Map();
        try {
            const r = await fetch('https://apis.datos.gob.ar/georef/api/localidades?max=5000&aplanar=true' +
                '&campos=nombre,provincia.nombre,departamento.nombre,centroide');
            const { localidades } = await r.json();
            for (const l of localidades) {
                const prov = l.provincia_nombre === 'Ciudad Autónoma de Buenos Aires' ? 'CABA'
                    : l.provincia_nombre.startsWith('Tierra del Fuego') ? 'Tierra del Fuego' : l.provincia_nombre;
                centrosGeoref.set(prov + '|' + clave(l.nombre), [l.centroide_lat, l.centroide_lon]);
            }
        } catch (err) {
            console.warn('Georef no respondió; las localidades sin cruce quedan sin datos.', err.message);
        }
    }
    const c = centrosGeoref.get(PROV_ORIGEN(provSitio) + '|' + clave(nombre));
    // Misma forma que una localidad de datos.json: [nombre, prov, cps, lat, lon]
    return c ? [[nombre, -1, [], c[0], c[1]]] : null;
}

/* ---------- Armado de archivos ---------- */

const slug = s => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

await mkdir(SALIDA, { recursive: true });
for (const f of await readdir(SALIDA)) if (f.endsWith('.json')) await unlink(path.join(SALIDA, f));

const sinMatch = [];
const totales = { c: new Set(), v: new Set(), f: new Set() };
let totalLocalidades = 0;
const tamanos = [];

for (const [provSitio, lista] of Object.entries(localidadesSitio)) {
    const suc = { c: [], v: [], f: [] };
    const mapaIdx = { c: new Map(), v: new Map(), f: new Map() };
    const idxLocal = (e, i) => {
        if (!mapaIdx[e].has(i)) {
            const s = datos.suc[e][i];
            mapaIdx[e].set(i, suc[e].length);
            totales[e].add(i);
            // [nombre, dirección, cp, horario, teléfono, destino del mapa]
            suc[e].push([legible(s[0]), legible(s[1] || ''), s[2] || '', legible(s[3] || ''), s[4] || '', destinoMapa(s, NOMBRE_EMPRESA[e])]);
        }
        return mapaIdx[e].get(i);
    };

    const loc = {};
    for (const par of lista) {
        totalLocalidades++;
        const nombre = par.slice(0, par.indexOf('|'));
        const k = clave(nombre);
        const origen = indice.get(PROV_ORIGEN(provSitio) + '|' + k) || await centroGeoref(provSitio, nombre);
        if (!origen) { sinMatch.push(`${nombre} (${provSitio})`); continue; }
        const cob = cobertura(origen);
        const fila = cob.map((c, n) => {
            const e = EMPRESAS[n];
            if (!c) return 0;
            if (c.locales) return c.locales.map(i => idxLocal(e, i));
            return { i: idxLocal(e, c.cercana.i), km: Math.round(c.cercana.km * 10) / 10 };
        });
        // Homónimos dentro de la provincia: se queda la fila con más cobertura.
        const peso = f => f.reduce((a, x) => a + (Array.isArray(x) ? 2 : x ? 1 : 0), 0);
        if (!loc[k] || peso(fila) > peso(loc[k])) loc[k] = fila;
    }

    // norm: abreviaturas y conectores con los que se armaron las claves de
    // "loc"; envios-ar.js normaliza con los mismos, así nunca se desincronizan.
    const archivo = { provincia: provSitio, generado: datos.generado, fechas: datos.fechas,
                      norm: { abrev: datos.abrev, conect: datos.conect }, suc, loc };
    const texto = JSON.stringify(archivo);
    const nombreArchivo = slug(provSitio) + '.json';
    await writeFile(path.join(SALIDA, nombreArchivo), texto);
    tamanos.push([nombreArchivo, texto.length]);
}

/* ---------- Control ---------- */

const pct = 100 - (sinMatch.length / totalLocalidades) * 100;
console.log(`Localidades: ${totalLocalidades - sinMatch.length}/${totalLocalidades} con datos (${pct.toFixed(1)} %)`);
for (const e of EMPRESAS) {
    console.log(`  ${NOMBRE_EMPRESA[e].padEnd(17)} ${totales[e].size} sucursales referenciadas de ${datos.suc[e].length}`);
}
const kb = n => (n / 1024).toFixed(0) + ' KB';
tamanos.sort((a, b) => b[1] - a[1]);
console.log(`Archivos: ${tamanos.length}, el mayor ${tamanos[0][0]} (${kb(tamanos[0][1])}), total ${kb(tamanos.reduce((a, t) => a + t[1], 0))}`);
if (sinMatch.length) console.log(`Sin datos (${sinMatch.length}): ${sinMatch.slice(0, 40).join(', ')}${sinMatch.length > 40 ? '…' : ''}`);

// Mismo criterio que controlar() de preparar_datos.py: si el origen se
// achicó de golpe, algo falló en la descarga y no conviene publicar.
for (const e of EMPRESAS) {
    if (datos.suc[e].length < datos.tot[e] * 0.8) {
        console.error(`ERROR: ${NOMBRE_EMPRESA[e]} tiene ${datos.suc[e].length} sucursales y se esperaban ~${datos.tot[e]}`);
        process.exit(1);
    }
}
