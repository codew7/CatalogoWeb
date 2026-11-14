// =====================================================================
//  Inicialización de Firebase (compartida por el formulario y el panel).
//  Usa el SDK modular por CDN, sin instalar nada.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, recaptchaSiteKey } from "../config/firebase-config.js";

// ¿Ya se pegaron las credenciales en config/firebase-config.js?
export const configurado = Object.values(firebaseConfig).every(v => v && !String(v).includes("PEGAR"));

let app = null;
let db = null;

if (configurado) {
  app = initializeApp(firebaseConfig);

  // App Check: verifica en segundo plano (sin que el usuario haga nada)
  // que los pedidos vienen de nuestra página y no de un robot.
  if (recaptchaSiteKey && !recaptchaSiteKey.includes("PEGAR")) {
    // Al probar en la propia compu (localhost) se usa un "token de depuración":
    // aparece en la consola del navegador y se registra en Firebase > App Check.
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true
    });
  }

  db = getDatabase(app);
}

export { app, db };

// Traduce errores técnicos de Firebase a mensajes simples.
export function mensajeError(err) {
  const codigo = String(err?.code || err?.message || "").toLowerCase();
  if (!navigator.onLine) return "Parece que no tenés conexión a internet. Revisala y probá de nuevo.";
  if (codigo.includes("network") || codigo.includes("unavailable") || codigo.includes("retry-limit"))
    return "Hubo un problema de conexión. Probá de nuevo en unos segundos.";
  if (codigo.includes("permission") || codigo.includes("unauthorized"))
    return "No pudimos guardar la información. Si el problema sigue, escribinos.";
  if (codigo.includes("quota")) return "El servicio está saturado en este momento. Probá más tarde.";
  if (codigo.includes("canceled")) return "La subida se canceló.";
  return "Algo salió mal. Probá de nuevo en unos segundos.";
}
