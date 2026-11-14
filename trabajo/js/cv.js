// =====================================================================
//  Procesamiento del CV en el navegador:
//  - Imágenes (JPG/PNG/foto de cámara): se achican a 1600 px y se pasan a JPG 80%.
//  - PDF: cada página (hasta 5) se convierte a JPG con pdf.js.
//    El PDF original NO se guarda: solo las imágenes de cada página.
//  Cada página queda en 900 KB como máximo (si pesa más, se recomprime),
//  porque se guarda dentro de la base de datos.
// =====================================================================

const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
const ANCHO_MAX = 1600;
const CALIDAD = 0.8;
const MAX_PAGINA = 900 * 1024;         // tope por página
const MAX_PAGINAS = 5;
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/";

export class ErrorCV extends Error {}

/**
 * Procesa el archivo elegido.
 * Devuelve { paginas: [{nombre, blob}], totalPaginasPdf }
 */
export async function procesarCV(archivo) {
  if (!archivo) throw new ErrorCV("No elegiste ningún archivo.");
  if (archivo.size > MAX_BYTES) throw new ErrorCV("El archivo pesa más de 10 MB. Probá con uno más liviano o sacale una foto.");

  const esPdf = archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name);
  const esImagen = /^image\//.test(archivo.type) || /\.(jpe?g|png)$/i.test(archivo.name);

  if (esPdf) return procesarPdf(archivo);
  if (esImagen) {
    const blob = await comprimirImagen(archivo);
    return { paginas: [{ nombre: "pagina-1", blob }], totalPaginasPdf: 0 };
  }
  throw new ErrorCV("Ese formato no está permitido. Subí un JPG, PNG o PDF.");
}

// --- Imágenes -------------------------------------------------------
async function comprimirImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new ErrorCV("No pudimos leer la imagen. Probá con otra foto o con un PDF."));
      i.src = url;
    });
    const escala = Math.min(1, ANCHO_MAX / img.naturalWidth);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.naturalWidth * escala);
    lienzo.height = Math.round(img.naturalHeight * escala);
    const ctx = lienzo.getContext("2d");
    ctx.fillStyle = "#fff";                       // fondo blanco (los PNG transparentes quedarían negros)
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    return await aJpg(lienzo);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobJpg(lienzo, calidad) {
  return new Promise((ok, mal) =>
    lienzo.toBlob(b => (b ? ok(b) : mal(new ErrorCV("No pudimos procesar la imagen."))), "image/jpeg", calidad)
  );
}

// JPG al 80%; si supera el tope, baja la calidad y después el tamaño hasta que entre.
async function aJpg(lienzo) {
  let blob = await blobJpg(lienzo, CALIDAD);
  let calidad = CALIDAD;
  let actual = lienzo;
  while (blob.size > MAX_PAGINA) {
    if (calidad > 0.6) calidad -= 0.1;
    else {
      const menor = document.createElement("canvas");
      menor.width = Math.round(actual.width * 0.85);
      menor.height = Math.round(actual.height * 0.85);
      menor.getContext("2d").drawImage(actual, 0, 0, menor.width, menor.height);
      actual = menor;
    }
    blob = await blobJpg(actual, calidad);
  }
  return blob;
}

// --- PDF ------------------------------------------------------------
let pdfjsCargado = null;
function cargarPdfJs() {
  if (!pdfjsCargado) {
    pdfjsCargado = import(PDFJS + "pdf.min.mjs").then(m => {
      m.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
      return m;
    });
  }
  return pdfjsCargado;
}

async function procesarPdf(archivo) {
  let pdfjs;
  try {
    pdfjs = await cargarPdfJs();
  } catch {
    throw new ErrorCV("No pudimos abrir el lector de PDF. Revisá tu conexión o subí una foto del CV.");
  }

  let doc;
  try {
    doc = await pdfjs.getDocument({ data: await archivo.arrayBuffer() }).promise;
  } catch {
    throw new ErrorCV("No pudimos leer ese PDF. Puede estar dañado o protegido con contraseña.");
  }

  const total = doc.numPages;
  const paginas = [];
  for (let n = 1; n <= Math.min(total, MAX_PAGINAS); n++) {
    const pagina = await doc.getPage(n);
    const base = pagina.getViewport({ scale: 1 });
    const escala = Math.min(ANCHO_MAX / base.width, 3);
    const vista = pagina.getViewport({ scale: escala });
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.floor(vista.width);
    lienzo.height = Math.floor(vista.height);
    const ctx = lienzo.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
    paginas.push({ nombre: `pagina-${n}`, blob: await aJpg(lienzo) });
    pagina.cleanup();
  }
  await doc.destroy();

  return { paginas, totalPaginasPdf: total };
}
