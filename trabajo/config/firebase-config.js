// =====================================================================
//  CREDENCIALES DE FIREBASE
//  Reemplazá cada "PEGAR_AQUI" por los datos de tu proyecto.
//  Los encontrás en: Consola de Firebase > ⚙ Configuración del proyecto >
//  General > "Tus apps" > App web > "Configuración del SDK" (opción "Config").
//
//  Estos datos NO son secretos: identifican al proyecto. La seguridad real
//  la dan las reglas (database.rules.json) y App Check.
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBK_l1Kpaa8rYstBoXUTo43Gdzl8JaIiFY",
  authDomain: "busquedapersonal.firebaseapp.com",
  databaseURL: "https://busquedapersonal-default-rtdb.firebaseio.com",
  projectId: "busquedapersonal",
  storageBucket: "busquedapersonal.firebasestorage.app",
  messagingSenderId: "650105588005",
  appId: "1:650105588005:web:268ea501aeaab1c35772cc"
};

// Clave de SITIO de reCAPTCHA v3 (la pública, no la secreta).
// Se usa para App Check (protección anti-spam invisible).
// Si la dejás como "PEGAR_AQUI", el sitio funciona igual pero sin App Check.
export const recaptchaSiteKey = "PEGAR_AQUI";
