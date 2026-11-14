// =====================================================================
//  Formulario público de postulación (wizard de 4 pasos).
//  Importante: este archivo NO contiene puntajes ni nombres de rasgos.
//  Solo guarda qué opción eligió la persona en cada pregunta (ej. P3: "B").
// =====================================================================

import { ref, get, set, push, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { db, configurado, mensajeError } from "./firebase.js";
import { SITIO } from "../config/sitio.js";
import { procesarCV, ErrorCV } from "./cv.js";

// ---------- Utilidades ----------
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const minusculaInicial = t => t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
const mezclar = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const soloDigitos = v => String(v ?? "").replace(/\D/g, "");
const formatoMiles = n => n.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const CLAVE = "hp_postulacion_v1";       // avance guardado en el navegador
const CLAVE_ENVIO = "hp_envio_v1";       // datos de un envío en curso (para reintentar)
const CLAVE_ENVIADA = "hp_enviada_v1";   // número de una postulación ya enviada

// Minutos estimados por paso (para "Te quedan unos X min")
const MINUTOS = { 1: 1, 2: 1.5, 3: 3, 4: 0.5 };

// Campos del formulario, por paso
const CAMPOS_PASO = {
  1: ["nombre", "apellido", "dni", "fechaNacimiento", "sexo", "estadoCivil", "localidad", "telefono"],
  2: ["puesto", "experiencia", "trabajaActualmente", "anticipacion", "ultimoLugar", "antiguedad", "ultimoPuesto", "sucursal", "traslado",
      "licencia", "disponibilidad", "estudios", "esfuerzoFisico", "remuneracion"],
  4: ["cv", "consentimiento"]
};
const TODOS_LOS_CAMPOS = [...CAMPOS_PASO[1], ...CAMPOS_PASO[2], "primerEmpleo", "consentimiento"];

// ---------- Estado ----------
let estado = nuevoEstado();
let puestos = [];
let cuestionario = null;           // versión pública: solo textos
let mapaPreguntas = {};
let cv = null;                     // { paginas:[{nombre, blob, url}], totalPaginasPdf }
const tocados = new Set();
let ultimoToqueConPuntero = false;
let enviando = false;

function nuevoEstado() {
  return { paso: 1, campos: {}, respuestas: {}, orden: [], ordenOpciones: {}, indice: 0, version: null, editandoResumen: false };
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch { /* sin espacio o modo privado */ }
}
function leerJSON(clave) {
  try { return JSON.parse(localStorage.getItem(clave)); } catch { return null; }
}

// =====================================================================
//  Arranque
// =====================================================================
iniciar();

async function iniciar() {
  $("#anio").textContent = new Date().getFullYear();
  $("#txt-presentacion").textContent = SITIO.presentacion;
  $("#lista-localidades").innerHTML = SITIO.localidades.map(l => `<option value="${esc(l)}"></option>`).join("");
  $("#lista-faq").innerHTML = SITIO.faq.map(f => `<details><summary>${esc(f.pregunta)}</summary><p>${esc(f.respuesta)}</p></details>`).join("");
  conectarEventos();

  const guardado = leerJSON(CLAVE);
  if (guardado && guardado.campos) estado = { ...nuevoEstado(), ...guardado };
  if (Object.keys(estado.campos).length) $("#txt-postularme").textContent = "Continuar mi postulación";

  const enviada = leerJSON(CLAVE_ENVIADA);
  if (enviada?.numero) {
    const aviso = $("#aviso-enviada");
    aviso.textContent = `Ya enviaste una postulación desde este dispositivo (n.º ${enviada.numero}). ¡Gracias! Te vamos a contactar si tu perfil avanza.`;
    aviso.hidden = false;
  }

  if (!configurado) {
    mostrarAvisoConfig("Falta configurar Firebase: pegá las credenciales en config/firebase-config.js (ver INSTRUCCIONES.md).");
    puestos = SITIO.puestos.filter(p => p.activo !== false);
    pintarPuestos();
    return;
  }

  try {
    const snap = await get(ref(db, "publico"));
    const pub = snap.val() || {};
    const listaPuestos = pub.puestos ? Object.values(pub.puestos) : SITIO.puestos;
    puestos = listaPuestos.filter(p => p && p.titulo && p.activo !== false);
    cuestionario = pub.cuestionario || null;
    if (!cuestionario?.preguntas?.length) {
      mostrarAvisoConfig("El cuestionario todavía no está cargado. Cargalo desde el panel de administración (Configuración > Cuestionario).");
    }
  } catch (e) {
    console.error(e);
    puestos = SITIO.puestos.filter(p => p.activo !== false);
    mostrarAvisoConfig("No pudimos conectarnos. Revisá tu conexión y recargá la página.");
  }
  pintarPuestos();
  prepararCuestionario();
}

function mostrarAvisoConfig(texto) {
  const a = $("#aviso-config");
  a.textContent = texto;
  a.hidden = false;
}

function pintarPuestos() {
  // Las búsquedas completas se muestran en el inicio, pero no se pueden elegir
  const completos = puestos.filter(p => p.completo === true);
  puestos = puestos.filter(p => p.completo !== true);
  const tarjetaCompleta = p => `
        <div class="puesto puesto--completo" aria-label="${esc(p.titulo)}: búsqueda completa">
          <span class="puesto__sello">Completa</span>
          <h3>${esc(p.titulo)}</h3>
          ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ""}
          <span class="puesto__pie"><span class="puesto__aviso">Ya cubrimos este puesto. ¡Gracias por el interés!</span></span>
        </div>`;
  $("#lista-puestos").innerHTML = (puestos.length
    ? puestos.map(p => `
        <button type="button" class="puesto" data-puesto="${esc(p.titulo)}" aria-label="Postularme a ${esc(p.titulo)}">
          <span class="puesto__flecha" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12h13m-5-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          <h3>${esc(p.titulo)}</h3>
          ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ""}
          <span class="puesto__pie">${sucursalesDe(p).map(s => `<span class="pastilla">${s}</span>`).join("")}</span>
        </button>`).join("")
    : `<p class="puesto">En este momento no hay búsquedas abiertas, pero podés dejarnos tus datos igual.</p>`)
    + completos.map(tarjetaCompleta).join("");

  // Tocar una tarjeta abre el formulario con ese puesto ya elegido
  $$("#lista-puestos [data-puesto]").forEach(b => b.addEventListener("click", () => {
    estado.campos.puesto = b.dataset.puesto;
    guardar();
    abrirFormulario();
  }));

  $("#opciones-puesto").innerHTML = puestos.map(p => `
    <label class="tarjeta-opcion">
      <input type="radio" name="puesto" value="${esc(p.titulo)}">
      <span class="tarjeta-opcion__cuerpo"><span class="tarjeta-opcion__marca"></span>
        <span class="tarjeta-opcion__texto">${esc(p.titulo)}</span></span>
    </label>`).join("");

  // Si hay un solo puesto, queda elegido de entrada
  if (puestos.length === 1 && !estado.campos.puesto) estado.campos.puesto = puestos[0].titulo;
}

// Arma el orden aleatorio de preguntas y opciones (una sola vez por persona)
function prepararCuestionario() {
  if (!cuestionario?.preguntas?.length) return;
  mapaPreguntas = Object.fromEntries(cuestionario.preguntas.map(p => [p.id, p]));
  const ids = cuestionario.preguntas.map(p => p.id);
  const ordenValido = estado.version === cuestionario.version && estado.orden.length === ids.length && estado.orden.every(id => mapaPreguntas[id]);
  if (!ordenValido) {
    estado.version = cuestionario.version;
    estado.orden = mezclar(ids);
    estado.respuestas = {};
    estado.indice = 0;
    estado.ordenOpciones = Object.fromEntries(cuestionario.preguntas.map(p => {
      const op = (p.opciones || []).map(o => o.id);
      return [p.id, p.mezclarOpciones === false ? op : mezclar(op)];
    }));
    guardar();
  }
}

// =====================================================================
//  Eventos
// =====================================================================
function conectarEventos() {
  $("#btn-postularme").addEventListener("click", abrirFormulario);
  $("#btn-atras").addEventListener("click", irAtras);
  $("#btn-siguiente").addEventListener("click", irAdelante);
  $("#btn-revisar").addEventListener("click", () => { $("#dlg-confirmar").close(); $("#resumen").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("#btn-confirmar-envio").addEventListener("click", () => { $("#dlg-confirmar").close(); enviar(); });
  $("#btn-reintentar").addEventListener("click", enviar);
  for (const b of ["#btn-privacidad", "#btn-privacidad-pie"]) $(b).addEventListener("click", e => { e.preventDefault(); $("#dlg-privacidad").showModal(); });
  $$("[data-cerrar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  const form = $("#form");
  form.addEventListener("submit", e => e.preventDefault());
  form.addEventListener("input", alCambiar);
  form.addEventListener("change", alCambiar);
  form.addEventListener("focusout", e => {
    const n = e.target.name;
    if (n && TODOS_LOS_CAMPOS.includes(n) && e.target.type !== "radio") { tocados.add(n); validarCampo(n); }
  });
  document.addEventListener("pointerdown", () => { ultimoToqueConPuntero = true; }, true);
  document.addEventListener("keydown", () => { ultimoToqueConPuntero = false; }, true);

  // Atajos de teclado en el cuestionario: A/B/C/D responde, Enter sigue, Esc vuelve
  document.addEventListener("keydown", e => {
    if (estado.paso !== 3 || $("#vista-form").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.target.matches("input[type=text],input[type=email],input[type=tel],textarea")) return;
    if (e.key === "Escape") { e.preventDefault(); irAtras(); return; }
    if (e.key === "Enter") { e.preventDefault(); irAdelante(); return; }
    const pos = "abcdef".indexOf(e.key.toLowerCase());
    const opcion = pos >= 0 ? $$("#pregunta-opciones input")[pos] : null;
    if (!opcion) return;
    e.preventDefault();
    opcion.checked = true;
    opcion.dispatchEvent(new Event("change", { bubbles: true }));
    opcion.focus({ preventScroll: true });
    const indiceActual = estado.indice;
    setTimeout(() => { if (estado.paso === 3 && estado.indice === indiceActual) avanzarPregunta(); }, 260);
  });

  // Enter en un campo de texto = Siguiente
  form.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("input[type=text],input[type=tel],input[type=email],input[type=date]")) {
      e.preventDefault(); irAdelante();
    }
  });

  // CV: elegir, cámara, arrastrar y soltar
  $("#input-cv").addEventListener("change", e => cargarCV(e.target.files[0], e.target));
  $("#input-camara").addEventListener("change", e => cargarCV(e.target.files[0], e.target));
  $("#btn-quitar-cv").addEventListener("click", quitarCV);
  const zona = $("#zona-cv");
  ["dragenter", "dragover"].forEach(t => zona.addEventListener(t, e => { e.preventDefault(); zona.classList.add("arrastrando"); }));
  ["dragleave", "drop"].forEach(t => zona.addEventListener(t, e => { e.preventDefault(); zona.classList.remove("arrastrando"); }));
  zona.addEventListener("drop", e => cargarCV(e.dataTransfer.files[0]));

  // Si se cierra la pestaña mientras se envía, avisar
  window.addEventListener("beforeunload", e => { if (enviando) { e.preventDefault(); e.returnValue = ""; } });
}

function alCambiar(e) {
  const el = e.target;
  const n = el.name;
  if (el.closest("#pregunta")) return; // las preguntas del cuestionario se manejan aparte
  if (!n || !TODOS_LOS_CAMPOS.includes(n)) return;

  if (n === "dni") el.value = soloDigitos(el.value).slice(0, 8);
  if (n === "remuneracion") {
    const d = soloDigitos(el.value).replace(/^0+/, "").slice(0, 9);
    el.value = d ? formatoMiles(d) : "";
  }

  if (el.type === "checkbox") estado.campos[n] = el.checked;
  else if (el.type === "radio") { if (el.checked) estado.campos[n] = el.value; }
  else estado.campos[n] = el.value;

  if (el.type === "radio" || el.type === "checkbox") tocados.add(n);
  actualizarCondicionales();
  if (tocados.has(n)) validarCampo(n);
  guardar();
}

// =====================================================================
//  Campos condicionales
// =====================================================================
function aplica(n) {
  const c = estado.campos;
  switch (n) {
    case "experiencia": return !!c.puesto;
    case "sucursal": return sucursalesDe(puestos.find(p => p.titulo === c.puesto)).length > 1;
    case "anticipacion": return c.trabajaActualmente === "Sí";
    case "ultimoLugar":
    case "ultimoPuesto":
    case "antiguedad": return !!c.trabajaActualmente && !(c.trabajaActualmente === "No" && c.primerEmpleo);
    default: return true;
  }
}

function actualizarCondicionales() {
  const c = estado.campos;

  // Pregunta de experiencia: nombra siempre el puesto elegido
  const puesto = puestos.find(p => p.titulo === c.puesto);
  const frase = puesto ? (puesto.frase || minusculaInicial(puesto.titulo)) : (c.puesto ? minusculaInicial(c.puesto) : "");
  $("#txt-experiencia").textContent = `¿Tenés experiencia trabajando en ${frase}?`;
  $('[data-campo="experiencia"]').hidden = !aplica("experiencia");

  $('[data-campo="anticipacion"]').hidden = !aplica("anticipacion");

  // Si el puesto es de una sola sucursal, no se pregunta: queda esa
  const unaSola = !aplica("sucursal");
  $('[data-campo="sucursal"]').hidden = unaSola;
  if (unaSola && puesto) c.sucursal = sucursalesDe(puesto)[0];

  // Último empleo
  const trabaja = c.trabajaActualmente === "Sí";
  if (trabaja && c.primerEmpleo) { c.primerEmpleo = false; $("#primerEmpleo").checked = false; }
  $("#grupo-empleo").hidden = !c.trabajaActualmente;
  $("#casilla-primer-empleo").hidden = trabaja;
  $("#campos-empleo").hidden = !aplica("ultimoLugar");
  $("#txt-grupo-empleo").textContent = trabaja ? "Tu trabajo actual" : "Tu último empleo";
  $("#lbl-ultimoLugar").textContent = trabaja ? "¿Dónde trabajás?" : "¿Dónde trabajaste por última vez?";
  $("#lbl-ultimoPuesto").textContent = trabaja ? "¿Qué puesto/tareas tenés?" : "¿Qué puesto/tareas tenías?";


  // Si un campo deja de aplicar, se limpia su error
  for (const n of ["experiencia", "anticipacion", "ultimoLugar", "ultimoPuesto", "antiguedad", "sucursal"]) if (!aplica(n)) mostrarError(n, "");
}

// Sucursales donde se busca un puesto (si no se indicó ninguna, las dos)
function sucursalesDe(p) {
  const todas = ["Caseros", "Munro"];
  const elegidas = p?.sucursales ? todas.filter(s => p.sucursales[s] === true) : [];
  return elegidas.length ? elegidas : todas;
}

// Vuelca los datos guardados en los campos (al volver a la página)
function restaurarCampos() {
  for (const [n, v] of Object.entries(estado.campos)) {
    const els = $$(`#form [name="${n}"]`);
    for (const el of els) {
      if (el.type === "radio") el.checked = el.value === v;
      else if (el.type === "checkbox") el.checked = !!v;
      else el.value = v ?? "";
    }
  }
  actualizarCondicionales();
}

// =====================================================================
//  Validación
// =====================================================================
function edad(fecha) {
  const [a, m, d] = fecha.split("-").map(Number);
  if (!a || !m || !d) return NaN;
  const hoy = new Date();
  let e = hoy.getFullYear() - a;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) e--;
  return e;
}

// Devuelve el teléfono como 549 + 10 dígitos (formato WhatsApp) o null si no es válido
export function normalizarTelefono(v) {
  let d = soloDigitos(v);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 12) {                              // código de área + 15 + número
    for (const largo of [2, 3, 4]) {
      if (d.substr(largo, 2) === "15") { d = d.slice(0, largo) + d.slice(largo + 2); break; }
    }
  }
  if (d.length !== 10 || d.startsWith("15")) return null;
  return "549" + d;
}

const elegir = msg => v => (v ? "" : msg);
const VALIDAR = {
  nombre: v => (!v?.trim() ? "Escribí tu nombre." : v.trim().length < 2 ? "Revisá tu nombre, parece incompleto." : ""),
  apellido: v => (!v?.trim() ? "Escribí tu apellido." : v.trim().length < 2 ? "Revisá tu apellido, parece incompleto." : ""),
  dni: v => (!v ? "Escribí tu DNI." : !/^\d{7,8}$/.test(v) ? "El DNI tiene que tener 7 u 8 números, sin puntos." : ""),
  fechaNacimiento: v => {
    if (!v) return "Indicá tu fecha de nacimiento.";
    const e = edad(v);
    if (isNaN(e) || e < 0 || e > 90) return "Revisá la fecha, parece que no es correcta.";
    if (e < 18) return "Para postularte tenés que ser mayor de 18 años.";
    return "";
  },
  sexo: elegir("Elegí una opción."),
  estadoCivil: elegir("Elegí una opción."),
  localidad: v => (!v || v.trim().length < 2 ? "Contanos en qué localidad vivís." : ""),
  telefono: v => (!v?.trim() ? "Escribí tu teléfono o WhatsApp." : normalizarTelefono(v) ? "" : "Revisá el número: código de área + número. Ej.: 11 2345-6789."),
  puesto: elegir("Elegí el puesto que te interesa."),
  experiencia: elegir("Elegí Sí o No."),
  trabajaActualmente: elegir("Elegí Sí o No."),
  anticipacion: elegir("Elegí una opción."),
  ultimoLugar: v => (v?.trim() ? "" : estado.campos.trabajaActualmente === "Sí" ? "Contanos dónde trabajás." : "Contanos dónde trabajaste por última vez, o marcá “Es mi primer empleo”."),
  ultimoPuesto: v => (v?.trim() ? "" : "Contanos qué puesto o tareas tenés o tenías."),
  antiguedad: v => (v?.trim() ? "" : "Contanos cuánto tiempo trabajás o trabajaste ahí. Ej.: 2 años."),
  sucursal: elegir("Elegí una sucursal o “Indistinto”."),
  traslado: elegir("Elegí Sí o No."),
  licencia: elegir("Elegí Sí o No."),
  disponibilidad: elegir("Elegí tu disponibilidad."),
  estudios: elegir("Elegí tu nivel de estudios."),
  esfuerzoFisico: elegir("Elegí Sí o No."),
  remuneracion: v => {
    if (!v) return "";                                  // opcional
    const n = Number(soloDigitos(v));
    return n > 0 && n <= 100000000 ? "" : "Revisá el monto.";
  },
  cv: () => (cv ? "" : "Subí tu CV para poder enviar la postulación."),
  consentimiento: v => (v ? "" : "Necesitamos tu consentimiento para guardar tus datos.")
};

function validarCampo(n) {
  if (!aplica(n)) { mostrarError(n, ""); return true; }
  const msg = VALIDAR[n] ? VALIDAR[n](estado.campos[n]) : "";
  mostrarError(n, msg);
  return !msg;
}

function mostrarError(n, msg) {
  const caja = $(`[data-campo="${n}"]`);
  const err = $(`#err-${n}`);
  if (err) err.textContent = msg;
  if (!caja) return;
  caja.classList.toggle("con-error", !!msg);
  const valor = estado.campos[n];
  caja.classList.toggle("ok", !msg && tocados.has(n) && !!valor);
  $$("input", caja).forEach(i => (msg ? i.setAttribute("aria-invalid", "true") : i.removeAttribute("aria-invalid")));
}

function validarPaso(p) {
  const campos = CAMPOS_PASO[p] || [];
  let primero = null;
  for (const n of campos) {
    tocados.add(n);
    if (!validarCampo(n) && !primero) primero = n;
  }
  if (primero) {
    const caja = $(`[data-campo="${primero}"]`);
    caja?.scrollIntoView({ behavior: "smooth", block: "center" });
    const foco = $("input:not([type=hidden])", caja);
    setTimeout(() => foco?.focus({ preventScroll: true }), 300);
  }
  return !primero;
}

// =====================================================================
//  Navegación entre pasos
// =====================================================================
function abrirFormulario() {
  if (!configurado) { mostrarAvisoConfig("El formulario todavía no está disponible. Probá más tarde."); return; }
  if (!cuestionario?.preguntas?.length) { $("#aviso-config").scrollIntoView({ behavior: "smooth" }); return; }
  restaurarCampos();
  $("#vista-inicio").hidden = true;
  $("#vista-form").hidden = false;
  irAPaso(estado.paso || 1);
}

function irAPaso(n, haciaAtras = false) {
  if (n === 4) cv && pintarCV();
  estado.paso = n;
  guardar();
  $$(".paso").forEach(f => {
    f.classList.toggle("paso--atras", haciaAtras);   // entra desde la izquierda si se vuelve
    f.hidden = Number(f.dataset.paso) !== n;
  });
  if (n === 3) pintarPregunta(haciaAtras);
  if (n === 4) pintarResumen();
  actualizarNavegacion();
  window.scrollTo(0, 0);
  // Llevar el foco al título del paso (lectores de pantalla y teclado)
  const titulo = $(`.paso[data-paso="${n}"] .paso__titulo`);
  if (titulo) { titulo.setAttribute("tabindex", "-1"); titulo.focus({ preventScroll: true }); }
}

function actualizarNavegacion() {
  const n = estado.paso;
  const total = estado.orden.length || 1;
  $("#progreso-paso").textContent = `Paso ${n} de 4`;

  // Tiempo restante estimado
  let restante = 0;
  for (let p = n; p <= 4; p++) restante += MINUTOS[p];
  if (n === 3) restante -= MINUTOS[3] * (estado.indice / total);
  $("#progreso-tiempo").textContent = restante <= 1 ? "Ya casi terminás" : `Te quedan unos ${Math.ceil(restante)} min`;

  // Barra
  let pct = (n - 1) * 25;
  if (n === 3) pct += 25 * (estado.indice / total);
  if (n === 4) pct = 90;
  $("#progreso-relleno").style.width = pct + "%";
  $(".progreso__barra").setAttribute("aria-valuenow", Math.round(pct));

  // Botones
  const sig = $("#btn-siguiente");
  if (n === 4) sig.textContent = "Enviar postulación";
  else if (estado.editandoResumen && n < 3) sig.textContent = "Volver al resumen";
  else sig.textContent = "Siguiente";
  $("#btn-atras").textContent = n === 1 && !estado.editandoResumen ? "Inicio" : "Atrás";
  $$(".progreso__etapas li").forEach((li, i) => { li.classList.toggle("activa", i + 1 === n); li.classList.toggle("hecha", i + 1 < n); });
}

function irAtras() {
  if (enviando) return;
  const n = estado.paso;
  if (n === 3 && estado.indice > 0) { estado.indice--; guardar(); pintarPregunta(true); actualizarNavegacion(); return; }
  if (n === 1) {
    if (estado.editandoResumen) { estado.editandoResumen = false; irAPaso(4); return; }
    $("#vista-form").hidden = true;
    $("#vista-inicio").hidden = false;
    $("#txt-postularme").textContent = "Continuar mi postulación";
    window.scrollTo(0, 0);
    return;
  }
  if (estado.editandoResumen) { estado.editandoResumen = false; irAPaso(4); return; }
  irAPaso(n - 1, true);
}

function irAdelante() {
  if (enviando) return;
  const n = estado.paso;
  if (n === 1 || n === 2) {
    if (!validarPaso(n)) return;
    if (estado.editandoResumen) { estado.editandoResumen = false; irAPaso(4); return; }
    irAPaso(n + 1);
    return;
  }
  if (n === 3) { avanzarPregunta(); return; }
  if (n === 4) {
    if (!validarPaso(4)) return;
    $("#dlg-confirmar").showModal();
  }
}

// =====================================================================
//  Paso 3: cuestionario, una pregunta por pantalla
// =====================================================================
function pintarPregunta(haciaAtras = false) {
  const total = estado.orden.length;
  if (!total) return;
  estado.indice = Math.min(Math.max(estado.indice, 0), total - 1);
  const id = estado.orden[estado.indice];
  const p = mapaPreguntas[id];

  $("#pregunta-contador").textContent = `Pregunta ${estado.indice + 1} de ${total}`;
  $('.paso[data-paso="3"]').classList.toggle("paso--compacto", estado.indice > 0);
  $("#pregunta-puntos").innerHTML = estado.orden.map((pid, i) =>
    `<i class="${i === estado.indice ? "actual" : estado.respuestas[pid] ? "hecho" : ""}"></i>`).join("");
  $("#pregunta-texto").textContent = p.texto;
  $("#err-pregunta").textContent = "";

  const orden = estado.ordenOpciones[id] || p.opciones.map(o => o.id);
  // La letra que se ve (A, B, C…) es solo la posición en pantalla, no el código interno de la opción
  $("#pregunta-opciones").innerHTML = orden.map((oid, pos) => {
    const o = p.opciones.find(x => x.id === oid);
    if (!o) return "";
    return `<label class="tarjeta-opcion">
        <input type="radio" name="pregunta-actual" value="${esc(o.id)}" ${estado.respuestas[id] === o.id ? "checked" : ""}>
        <span class="tarjeta-opcion__cuerpo"><span class="tarjeta-opcion__tecla" aria-hidden="true">${"ABCDEF"[pos]}</span>
          <span class="tarjeta-opcion__texto">${esc(o.texto)}</span></span>
      </label>`;
  }).join("");

  // Animación de entrada (hacia adelante o hacia atrás)
  const cuerpo = $(".pregunta__cuerpo");
  cuerpo.classList.remove("entra", "entra-atras");
  void cuerpo.offsetWidth;
  cuerpo.classList.add(haciaAtras ? "entra-atras" : "entra");

  $$('#pregunta-opciones input').forEach(inp => inp.addEventListener("change", () => {
    estado.respuestas[id] = inp.value;
    guardar();
    $("#err-pregunta").textContent = "";
    // Con el dedo o el mouse, avanza solo; con teclado, se usa "Siguiente"
    if (ultimoToqueConPuntero) {
      const indiceActual = estado.indice;
      setTimeout(() => { if (estado.paso === 3 && estado.indice === indiceActual) avanzarPregunta(); }, 320);
    }
  }));
}

function avanzarPregunta() {
  const id = estado.orden[estado.indice];
  if (!estado.respuestas[id]) {
    $("#err-pregunta").textContent = "Elegí una opción para seguir.";
    return;
  }
  if (estado.indice < estado.orden.length - 1) {
    estado.indice++;
    guardar();
    pintarPregunta();
    actualizarNavegacion();
    return;
  }
  // Última pregunta: verificar que estén todas respondidas
  const faltante = estado.orden.findIndex(pid => !estado.respuestas[pid]);
  if (faltante !== -1) { estado.indice = faltante; pintarPregunta(true); actualizarNavegacion(); $("#err-pregunta").textContent = "Te faltó responder esta pregunta."; return; }
  irAPaso(4);
}

// =====================================================================
//  Paso 4: CV
// =====================================================================
async function cargarCV(archivo, input) {
  if (!archivo || enviando) return;
  if (input) input.value = "";            // permite volver a elegir el mismo archivo
  tocados.add("cv");
  quitarCV(false);
  $("#zona-cv").hidden = true;
  $("#cv-procesando").hidden = false;
  mostrarError("cv", "");
  try {
    cv = await procesarCV(archivo);
    cv.nombreArchivo = archivo.name || "Foto";
    pintarCV();
  } catch (e) {
    console.error(e);
    cv = null;
    $("#zona-cv").hidden = false;
    mostrarError("cv", e instanceof ErrorCV ? e.message : "No pudimos procesar el archivo. Probá con otro o sacale una foto.");
  } finally {
    $("#cv-procesando").hidden = true;
  }
}

function pintarCV() {
  if (!cv) return;
  cv.paginas.forEach(p => { if (!p.url) p.url = URL.createObjectURL(p.blob); });
  $("#cv-miniaturas").innerHTML = cv.paginas.slice(0, 3).map((p, i) => `<img src="${p.url}" alt="Vista previa, página ${i + 1}">`).join("");
  const n = cv.paginas.length;
  let info = `${esc(cv.nombreArchivo)} · ${n} ${n === 1 ? "página" : "páginas"}`;
  if (cv.totalPaginasPdf > n) info += ` (tomamos las primeras ${n})`;
  $("#cv-info").innerHTML = info;
  $("#zona-cv").hidden = true;
  $("#cv-vista").hidden = false;
  mostrarError("cv", "");
}

function quitarCV(mostrarZona = true) {
  if (enviando) return;
  cv?.paginas.forEach(p => p.url && URL.revokeObjectURL(p.url));
  cv = null;
  $("#cv-vista").hidden = true;
  if (mostrarZona !== false) $("#zona-cv").hidden = false;
}

// Resumen final (sin respuestas del cuestionario)
function pintarResumen() {
  const c = estado.campos;
  const fecha = c.fechaNacimiento ? c.fechaNacimiento.split("-").reverse().join("/") : "";
  const remu = c.remuneracion ? `$ ${c.remuneracion}` : "No indicada";
  let empleo;
  if (c.trabajaActualmente === "No" && c.primerEmpleo) empleo = "Primer empleo";
  else empleo = [c.ultimoPuesto, c.ultimoLugar].filter(Boolean).join(" en ") + (c.antiguedad?.trim() ? ` (${c.antiguedad.trim()})` : "");

  const fila = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`;
  $("#resumen").innerHTML = `
    <section class="resumen__bloque">
      <div class="resumen__cabeza"><h3>Datos personales</h3><button type="button" class="btn-texto" data-editar="1">Editar</button></div>
      <dl>
        ${fila("Nombre", `${c.nombre || ""} ${c.apellido || ""}`.trim())}
        ${fila("DNI", c.dni)}
        ${fila("Nacimiento", fecha)}
        ${fila("Sexo", c.sexo)}
        ${fila("Estado civil", c.estadoCivil)}
        ${fila("Localidad", c.localidad)}
        ${fila("Teléfono", c.telefono)}
      </dl>
    </section>
    <section class="resumen__bloque">
      <div class="resumen__cabeza"><h3>Perfil laboral</h3><button type="button" class="btn-texto" data-editar="2">Editar</button></div>
      <dl>
        ${fila("Puesto", c.puesto)}
        ${fila("Experiencia en el puesto", c.experiencia)}
        ${fila("Trabaja actualmente", c.trabajaActualmente === "Sí" ? `Sí · ${c.anticipacion || ""}` : c.trabajaActualmente)}
        ${fila(c.trabajaActualmente === "Sí" ? "Trabajo actual" : "Último empleo", empleo)}
        ${fila("Sucursal", c.sucursal)}
        ${fila("Trabajar en ambas sucursales", c.traslado)}
        ${fila("Licencia de conducir", c.licencia)}
        ${fila("Disponibilidad", c.disponibilidad)}
        ${fila("Estudios", c.estudios)}
        ${fila("Esfuerzo físico", c.esfuerzoFisico)}
        ${fila("Pretensión mensual", remu)}
      </dl>
    </section>`;
  $$("[data-editar]", $("#resumen")).forEach(b => b.addEventListener("click", () => {
    if (enviando) return;
    estado.editandoResumen = true;
    irAPaso(Number(b.dataset.editar));
  }));
}

// =====================================================================
//  Envío
// =====================================================================
const siNo = v => v === "Sí";

function armarRegistro(env) {
  const c = estado.campos;
  const r = {
    numero: env.numero,
    dni: c.dni,
    nombre: c.nombre.trim(),
    apellido: c.apellido.trim(),
    fechaNacimiento: c.fechaNacimiento,
    sexo: c.sexo,
    estadoCivil: c.estadoCivil,
    localidad: c.localidad.trim(),
    telefono: normalizarTelefono(c.telefono),
    puesto: c.puesto,
    experiencia: siNo(c.experiencia),
    trabajaActualmente: siNo(c.trabajaActualmente),
    primerEmpleo: c.trabajaActualmente === "No" && !!c.primerEmpleo,
    sucursal: aplica("sucursal") ? c.sucursal : sucursalesDe(puestos.find(p => p.titulo === c.puesto))[0],
    traslado: siNo(c.traslado),
    licencia: siNo(c.licencia),
    disponibilidad: c.disponibilidad,
    estudios: c.estudios,
    esfuerzoFisico: siNo(c.esfuerzoFisico),
    respuestas: Object.fromEntries(estado.orden.map(id => [id, estado.respuestas[id]])),
    archivos: archivosParaSubir().map(a => a.nombre),
    cuestionarioVersion: Number(cuestionario.version) || 1,
    consentimiento: true,
    fechaEnvio: serverTimestamp(),
    estado: "Nuevo"
  };
  if (r.trabajaActualmente) r.anticipacion = c.anticipacion;
  if (!r.primerEmpleo) { r.ultimoLugar = c.ultimoLugar.trim(); r.ultimoPuesto = c.ultimoPuesto.trim(); r.antiguedad = c.antiguedad.trim(); }
  const remu = Number(soloDigitos(c.remuneracion));
  if (remu > 0) r.remuneracion = remu;
  return r;
}

function archivosParaSubir() {
  if (!cv) return [];
  return cv.paginas.map(p => ({ nombre: p.nombre, blob: p.blob }));
}

// Convierte la imagen a texto (data URL) para guardarla en la base de datos
function aTexto(blob) {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(lector.result);
    lector.onerror = () => mal(lector.error);
    lector.readAsDataURL(blob);
  });
}

const esPermiso = e => /permission|unauthorized/i.test(String(e?.code || e?.message || ""));

function estadoEnvio(texto, pct) {
  $("#envio").hidden = false;
  $("#envio-texto").textContent = texto;
  if (pct != null) {
    $("#envio-relleno").style.width = pct + "%";
    $("#envio .progreso__barra").setAttribute("aria-valuenow", Math.round(pct));
  }
}

function errorEnvio(texto, reintentable = true) {
  $("#envio").hidden = true;
  $("#envio-error").hidden = false;
  $("#envio-error-texto").textContent = texto;
  $("#btn-reintentar").hidden = !reintentable;
  $("#envio-error").scrollIntoView({ behavior: "smooth", block: "center" });
}

function bloquear(si) {
  enviando = si;
  $("#btn-siguiente").disabled = si;
  $("#btn-atras").disabled = si;
  $("#btn-siguiente").textContent = si ? "Enviando…" : "Enviar postulación";
}

async function enviar() {
  if (enviando) return;
  if (!navigator.onLine) { errorEnvio("Parece que no tenés conexión a internet. Revisala y tocá “Reintentar”."); return; }
  $("#envio-error").hidden = true;
  bloquear(true);

  const dni = estado.campos.dni;
  let env = leerJSON(CLAVE_ENVIO);
  if (!env || env.dni !== dni) {
    env = { dni, id: push(ref(db, "postulaciones")).key, numero: null, registrado: false, intentoRegistro: false, subidos: [], intentados: [] };
  }
  const guardarEnv = () => { try { localStorage.setItem(CLAVE_ENVIO, JSON.stringify(env)); } catch {} };
  guardarEnv();

  try {
    if (!env.registrado) {
      // 1) Reservar el DNI (si ya existe, la base lo rechaza: postulación duplicada)
      estadoEnvio("Verificando tus datos…", 5);
      try {
        await set(ref(db, `dni/${dni}`), env.id);
      } catch (e) {
        if (esPermiso(e)) {
          localStorage.removeItem(CLAVE_ENVIO);
          errorEnvio("Ya recibimos una postulación con este DNI. Si querés actualizar tus datos, escribinos.", false);
          bloquear(false);
          return;
        }
        throw e;
      }

      // 2) Número de postulación correlativo (HP-2026-0001)
      if (!env.numero) {
        const anio = new Date().getFullYear();
        const r = await runTransaction(ref(db, `contadores/${anio}`), n => (Number(n) || 0) + 1);
        if (!r.committed) throw new Error("network");
        env.numero = `HP-${anio}-${String(r.snapshot.val()).padStart(4, "0")}`;
        guardarEnv();
      }

      // 3) Guardar la postulación
      estadoEnvio("Guardando tu postulación…", 10);
      try {
        await set(ref(db, `postulaciones/${env.id}`), armarRegistro(env));
      } catch (e) {
        // Si un intento anterior ya la había guardado, la base no deja pisarla: está bien.
        if (!(esPermiso(e) && env.intentoRegistro)) { env.intentoRegistro = true; guardarEnv(); throw e; }
      }
      env.registrado = true;
      guardarEnv();
    }

    // 4) Subir el CV (una imagen por página, dentro de la base de datos: cvs/{id}/pagina-N)
    const archivos = archivosParaSubir();
    const total = archivos.reduce((s, a) => s + a.blob.size, 0) || 1;
    let base = archivos.filter(a => env.subidos.includes(a.nombre)).reduce((s, a) => s + a.blob.size, 0);
    for (const [i, a] of archivos.entries()) {
      if (env.subidos.includes(a.nombre)) continue;
      estadoEnvio(archivos.length > 1 ? `Subiendo tu CV (página ${i + 1} de ${archivos.length})…` : "Subiendo tu CV…", 10 + 88 * (base / total));
      const yaIntentado = env.intentados.includes(a.nombre);
      env.intentados.push(a.nombre); guardarEnv();
      try {
        await set(ref(db, `cvs/${env.id}/${a.nombre}`), await aTexto(a.blob));
      } catch (e) {
        // Si ya se había guardado en un intento anterior, la base no deja pisarla: está bien.
        if (!(esPermiso(e) && yaIntentado)) throw e;
      }
      base += a.blob.size;
      estadoEnvio("Subiendo tu CV…", 10 + 88 * (base / total));
      env.subidos.push(a.nombre);
      guardarEnv();
    }

    // 5) Listo
    estadoEnvio("¡Listo!", 100);
    localStorage.removeItem(CLAVE);
    localStorage.removeItem(CLAVE_ENVIO);
    try { localStorage.setItem(CLAVE_ENVIADA, JSON.stringify({ numero: env.numero })); } catch {}
    enviando = false;
    mostrarExito(env.numero);
  } catch (e) {
    console.error(e);
    bloquear(false);
    errorEnvio(mensajeError(e) + " Tus datos no se perdieron: tocá “Reintentar”.");
  }
}

function mostrarExito(numero) {
  $("#exito-numero").textContent = numero;
  $("#vista-form").hidden = true;
  $("#vista-inicio").hidden = true;
  const v = $("#vista-exito");
  v.hidden = false;
  window.scrollTo(0, 0);
  v.focus({ preventScroll: true });
}
