// =====================================================================
//  TEMA CLARO / OSCURO
//  Preferencia guardada en este dispositivo: "auto" (sigue al sistema),
//  "claro" u "oscuro". El atributo data-tema de <html> ya viene puesto
//  desde el <head> (para que no parpadee); acá se arma el selector.
// =====================================================================

const CLAVE = "hp_tema";
const consulta = matchMedia("(prefers-color-scheme: light)");

const OPCIONES = [
  { v: "auto", t: "Automático (según el dispositivo)",
    icono: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>' },
  { v: "claro", t: "Tema claro",
    icono: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>' },
  { v: "oscuro", t: "Tema oscuro",
    icono: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>' }
];

function leer() {
  try { const t = localStorage.getItem(CLAVE); return t === "claro" || t === "oscuro" ? t : "auto"; }
  catch { return "auto"; }
}

function aplicar() {
  const pref = leer();
  const tema = pref === "auto" ? (consulta.matches ? "claro" : "oscuro") : pref;
  document.documentElement.dataset.tema = tema;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", tema === "claro" ? "#F5F5F0" : "#0A0A0A"));
  // Logos que cambian de color con el tema (los de fondos siempre negros no llevan data-logo)
  document.querySelectorAll("img[data-logo]").forEach(img => { img.src = tema === "claro" ? "logo.png" : "logoblanco.png"; });
  document.querySelectorAll("[data-selector-tema] button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tema === pref)));
}

function elegir(valor) {
  try { valor === "auto" ? localStorage.removeItem(CLAVE) : localStorage.setItem(CLAVE, valor); } catch { /* sin almacenamiento: vale solo para esta visita */ }
  document.documentElement.classList.add("cambiando-tema");
  aplicar();
  setTimeout(() => document.documentElement.classList.remove("cambiando-tema"), 50);
}

document.querySelectorAll("[data-selector-tema]").forEach(cont => {
  cont.setAttribute("role", "group");
  cont.setAttribute("aria-label", "Tema de la pantalla");
  cont.classList.add("tema");
  cont.innerHTML = OPCIONES.map(o => `
    <button type="button" class="tema__op" data-tema="${o.v}" aria-label="${o.t}" title="${o.t}">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${o.icono}</svg>
    </button>`).join("");
  cont.addEventListener("click", e => { const b = e.target.closest("button[data-tema]"); if (b) elegir(b.dataset.tema); });
});

// Si está en automático y el dispositivo cambia de modo, acompaña
consulta.addEventListener("change", () => { if (leer() === "auto") aplicar(); });
aplicar();
