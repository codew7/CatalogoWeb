import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyDwiZWDc66tv4usDIA-IreiJMLFuk0236Q",
    authDomain: "registrocatalogopersonalizado.firebaseapp.com",
    databaseURL: "https://registrocatalogopersonalizado-default-rtdb.firebaseio.com",
    projectId: "registrocatalogopersonalizado",
    storageBucket: "registrocatalogopersonalizado.firebasestorage.app",
    messagingSenderId: "782674065763",
    appId: "1:782674065763:web:7f1112d846bbf98ca9bb56"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const G_S_CONFIG = {
    API_KEY: "AIzaSyD9h4SH9laGhvh-NRhDjYgbCThVEbM8HTo",
    SPREADSHEET_ID: "10QcnEi_INRU6Fn0UbdluXQC5KrU3JptMx5Y2ODF8OPg",
    RANGO: "Grupos!A2:D"
};

let generatedUrl = "";
let allCategories = [];

// Convierte un nombre a código ASCII-safe para uso en encoding binario (btoa)
function normalizeCode(name) {
    return name.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
        .substring(0, 20);
}

function setupPhoneValidation() {
    const phoneInput = document.getElementById("clientPhone");
    if (!phoneInput) return;
    phoneInput.addEventListener("input", function () {
        this.value = this.value.replace(/[^0-9]/g, "");
    });
    phoneInput.addEventListener("keypress", function (e) {
        if (!/[0-9]/.test(String.fromCharCode(e.which))) e.preventDefault();
    });
}

// Placeholder: reemplazar con el ID real del video de YouTube
const WELCOME_VIDEO_ID = "VIDEO_ID_AQUI";

window.addEventListener("DOMContentLoaded", function () {
    document.getElementById("notification").classList.remove("show");
    loadCategories();
    setupPhoneValidation();
    showWelcomePopup();
});

function showWelcomePopup() {
    const overlay = document.getElementById("welcomeOverlay");
    if (!overlay) return;
    overlay.style.display = "flex";

    document.getElementById("welcomeVideoBtn").addEventListener("click", function () {
        const container = document.getElementById("welcomeVideoContainer");
        const iframe = document.getElementById("welcomeVideoIframe");
        if (container.style.display === "none" || container.style.display === "") {
            iframe.src = "https://www.youtube.com/embed/" + WELCOME_VIDEO_ID + "?autoplay=1";
            container.style.display = "block";
            this.style.display = "none";
        }
    });

    document.getElementById("welcomeCloseBtn").addEventListener("click", function () {
        const iframe = document.getElementById("welcomeVideoIframe");
        iframe.src = "";
        overlay.style.display = "none";
    });
}

function showNotification() {
    const el = document.getElementById("notification");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
}

function encodeCategoriesBinary(categories) {
    let str = "";
    categories.forEach(cat => {
        const code = cat.code;
        str += String.fromCharCode(code.length);
        for (let i = 0; i < code.length; i++) str += code[i];
        // 2 bytes para porcentaje (soporta 0-999)
        str += String.fromCharCode((cat.percentage >> 8) & 0xFF);
        str += String.fromCharCode(cat.percentage & 0xFF);
    });
    return btoa(str);
}

function decodeCategoriesBinary(encoded) {
    const map = new Map();
    try {
        const str = atob(encoded);
        let i = 0;
        while (i < str.length) {
            const len = str.charCodeAt(i); i++;
            let code = "";
            for (let j = 0; j < len; j++) { code += str[i]; i++; }
            // 2 bytes para porcentaje
            const hi = str.charCodeAt(i); i++;
            const lo = str.charCodeAt(i); i++;
            map.set(code, (hi << 8) | lo);
        }
    } catch (err) {
        console.error("Error al decodificar formato binario:", err);
    }
    return map;
}

function loadCategories() {
    const container = document.getElementById("categoriesContainer");
    container.innerHTML = `
        <div class="loading-categories">
            <div class="loading-spinner"></div>
            <p>Cargando grupos...</p>
        </div>
    `;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${G_S_CONFIG.SPREADSHEET_ID}/values/${G_S_CONFIG.RANGO}?key=${G_S_CONFIG.API_KEY}`;
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Error al acceder a la API: " + res.statusText);
            return res.json();
        })
        .then(data => {
            const rows = data.values;
            if (!rows || rows.length === 0) throw new Error("No se encontraron datos en la hoja.");
            const seen = new Set();
            const groups = [];
            rows.forEach(row => {
                const name = row[0] ? row[0].trim() : "";         // Columna A: nombre del grupo
                const codeFromSheet = row[2] ? row[2].trim() : ""; // Columna C: código
                const placeholder = row[3] ? row[3].trim() : "";   // Columna D: placeholder

                if (!name) return;

                // Usar columna C como código si existe y es ASCII-safe, sino derivar del nombre
                const isAsciisafe = /^[\x20-\x7E]+$/.test(codeFromSheet);
                const code = (codeFromSheet && isAsciisafe) ? codeFromSheet : normalizeCode(name);

                if (!seen.has(code)) {
                    seen.add(code);
                    groups.push({ code, name, placeholder });
                }
            });
            if (groups.length === 0) throw new Error("No se encontraron grupos válidos en la hoja.");
            allCategories = groups; // Mantener el orden original de la hoja
            renderCategories();
        })
        .catch(err => {
            console.error("Error al cargar los grupos:", err);
            container.innerHTML = `
                <div class="loading-categories">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #ff9800; margin-bottom: 1rem;"></i>
                    <p>Error al cargar los grupos</p>
                    <p style="font-size: 0.9rem; margin-top: 0.5rem;">${err.message}</p>
                </div>
            `;
        });
}

function renderCategories() {
    const container = document.getElementById("categoriesContainer");
    if (allCategories.length === 0) {
        container.innerHTML = `
            <div class="no-categories">
                <i class="fas fa-inbox" style="font-size: 2rem; color: #999; margin-bottom: 1rem;"></i>
                <p>No se encontraron grupos disponibles</p>
            </div>
        `;
        return;
    }
    container.innerHTML = `
        <div class="categories-grid">
            ${allCategories.map(cat => `
                <div class="category-item" id="cat-${cat.code}">
                    <div class="category-name">
                        <span>${cat.name}</span>
                    </div>
                    <div class="category-input-group">
                        <input
                            type="number"
                            class="category-percentage"
                            id="percent-${cat.code}"
                            placeholder="${cat.placeholder || 'Ej: 30'}"
                            min="0"
                            max="999"
                            step="1"
                        >
                        <span class="percentage-symbol">%</span>
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    // Resaltar tarjeta cuando se ingresa un valor
    allCategories.forEach(cat => {
        const input = document.getElementById("percent-" + cat.code);
        const item = document.getElementById("cat-" + cat.code);
        if (input && item) {
            input.addEventListener("input", function () {
                if (this.value !== "") {
                    item.classList.add("active");
                } else {
                    item.classList.remove("active");
                }
            });
        }
    });
}

function loadFromUrl() {
    const url = document.getElementById("existingUrl").value.trim();
    if (!url) { alert("⚠️ Por favor, ingresa una URL válida"); return; }
    try {
        const parsed = new URL(url);
        const params = new URLSearchParams(parsed.search);
        const name = params.get("n");
        if (!name) { alert("⚠️ La URL no contiene un nombre de catálogo válido"); return; }
        document.getElementById("catalogName").value = decodeURIComponent(name);

        const phone = params.get("t");
        if (phone) { document.getElementById("clientPhone").value = phone; }

        const style = params.get("s");
        if (style && ["1","2","3","4","5","6"].includes(style)) {
            const radio = document.querySelector(`input[name="catalogStyle"][value="${style}"]`);
            if (radio) {
                radio.checked = true;
                document.querySelectorAll('.style-card').forEach(c => c.classList.remove('selected'));
                radio.closest('.style-card').classList.add('selected');
            }
        }

        const c = params.get("c");
        if (!c) { alert("⚠️ La URL no contiene configuración de grupos válida"); return; }
        const decoded = decodeCategoriesBinary(c);
        if (decoded.size === 0) { alert("⚠️ Error al decodificar la configuración. URL inválida o corrupta."); return; }
        if (allCategories.length === 0) { alert("⏳ Esperando a que se carguen los grupos. Por favor, intenta de nuevo en unos segundos."); return; }

        // Limpiar todos los inputs
        allCategories.forEach(cat => {
            const pct = document.getElementById("percent-" + cat.code);
            const item = document.getElementById("cat-" + cat.code);
            if (pct) { pct.value = ""; }
            if (item) { item.classList.remove("active"); }
        });

        // Cargar valores decodificados
        let loaded = 0;
        decoded.forEach((pct, code) => {
            const pctInput = document.getElementById("percent-" + code);
            const item = document.getElementById("cat-" + code);
            if (pctInput) {
                pctInput.value = pct;
                if (item) item.classList.add("active");
                loaded++;
            }
        });

        if (loaded > 0) {
            let msg = `✅ Configuración cargada exitosamente!\n\nNombre: ${decodeURIComponent(name)}`;
            if (phone) msg += `\nTeléfono: ${phone}`;
            msg += `\nGrupos: ${loaded}`;
            alert(msg);
            document.getElementById("existingUrl").value = "";
            scrollToForm();
        } else {
            alert("⚠️ No se pudieron cargar los grupos de la URL. Verifica que los códigos sean correctos.");
        }
    } catch (err) {
        console.error("Error al parsear la URL:", err);
        alert("⚠️ La URL ingresada no es válida. Por favor, verifica e intenta nuevamente.");
    }
}

function scrollToForm() {
    const form = document.querySelector(".form-container:first-of-type");
    if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleEditSection() {
    const content = document.getElementById("editContent");
    const icon = document.getElementById("toggleIcon");
    if (content.style.display === "none" || content.style.display === "") {
        content.style.display = "block";
        icon.classList.add("rotate");
    } else {
        content.style.display = "none";
        icon.classList.remove("rotate");
    }
}

function clearForm() {
    document.getElementById("catalogName").value = "";
    allCategories.forEach(cat => {
        const pct = document.getElementById("percent-" + cat.code);
        const item = document.getElementById("cat-" + cat.code);
        if (pct) { pct.value = ""; }
        if (item) { item.classList.remove("active"); }
    });
    document.getElementById("resultContainer").style.display = "none";
    document.getElementById("catalogName").focus();
}

async function saveToFirebase(data) {
    try {
        const dbRef = ref(database, "catalogos");
        const newRef = push(dbRef);
        await set(newRef, data);
        console.log("✅ Datos guardados en Firebase correctamente");
        return true;
    } catch (err) {
        console.error("❌ Error al guardar en Firebase:", err);
        alert("⚠️ Hubo un error al guardar la información. El catálogo se generará de todas formas.");
        return false;
    }
}

function copyUrl() {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl).then(function () {
        showNotification();
    }).catch(function () {
        const ta = document.createElement("textarea");
        ta.value = generatedUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showNotification();
    });
}

function visitCatalog() {
    if (generatedUrl) window.open(generatedUrl, "_blank");
}

function previewCatalog() {
    if (!generatedUrl) return;
    try {
        const parsed = new URL(generatedUrl);
        const previewUrl = "https://catalogo.dev.ar/preview.html" + parsed.search;
        window.open(previewUrl, "_blank");
    } catch (e) {
        window.open(generatedUrl, "_blank");
    }
}

function backToEdit() {
    document.getElementById("resultContainer").style.display = "none";
    document.querySelector(".form-container").scrollIntoView({ behavior: "smooth", block: "start" });
}

window.loadFromUrl = loadFromUrl;
window.scrollToForm = scrollToForm;
window.toggleEditSection = toggleEditSection;
window.clearForm = clearForm;
window.copyUrl = copyUrl;
window.visitCatalog = visitCatalog;
window.previewCatalog = previewCatalog;
window.backToEdit = backToEdit;

document.getElementById("customizationForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const catalogName = document.getElementById("catalogName").value.trim();
    const clientName = document.getElementById("clientName").value.trim();
    const clientPhone = document.getElementById("clientPhone").value.trim();

    if (!catalogName) { alert("⚠️ Por favor, completa el nombre del catálogo"); return; }
    if (!clientName) { alert("⚠️ Por favor, completa tu nombre completo"); return; }
    if (!clientPhone) { alert("⚠️ Por favor, completa tu teléfono"); return; }

    const selected = [];
    let validationError = false;

    for (const cat of allCategories) {
        const pct = document.getElementById("percent-" + cat.code);
        if (!pct) continue;

        // Si el campo está vacío, usar el valor del placeholder como porcentaje por defecto
        let rawValue = pct.value.trim();
        if (rawValue === "") {
            rawValue = pct.placeholder || "0";
        }

        const val = parseInt(rawValue);
        if (isNaN(val) || val < 0 || val > 999) {
            alert(`⚠️ El porcentaje de "${cat.name}" debe estar entre 0 y 999`);
            pct.focus();
            validationError = true;
            break;
        }
        selected.push({ code: cat.code, percentage: val });
    }

    if (validationError) return;

    const encoded = encodeCategoriesBinary(selected);
    const base = "https://catalogo.dev.ar/";
    const nameParam = encodeURIComponent(catalogName);
    const selectedStyle = document.querySelector('input[name="catalogStyle"]:checked');
    const styleValue = selectedStyle ? selectedStyle.value : "1";
    generatedUrl = `${base}?n=${nameParam}&t=${clientPhone}&s=${styleValue}&v=2&c=${encoded}`;

    const data = {
        catalogName,
        clientName,
        clientPhone,
        url: generatedUrl,
        createdAt: new Date().toISOString()
    };

    await saveToFirebase(data);
    document.getElementById("urlDisplay").textContent = generatedUrl;
    document.getElementById("resultContainer").style.display = "block";
    document.getElementById("resultContainer").scrollIntoView({ behavior: "smooth", block: "center" });
});

document.getElementById("catalogName").addEventListener("input", function () {
    if (this.value.length > 50) this.value = this.value.substring(0, 50);
});

document.getElementById("existingUrl").addEventListener("keypress", function (e) {
    if (e.key === "Enter") { e.preventDefault(); loadFromUrl(); }
});

document.addEventListener("input", function (e) {
    if (e.target.classList.contains("category-percentage")) {
        if (e.target.value.length > 3) e.target.value = e.target.value.substring(0, 3);
        const val = parseInt(e.target.value);
        if (!isNaN(val)) {
            if (val < 0) e.target.value = 0;
            else if (val > 999) e.target.value = 999;
        }
    }
});
