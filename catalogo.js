// Initialize EmailJS
emailjs.init("vcbQsbE2bgLwFAnDr");

// Constants
const WHATSAPP_URL = "https://api.whatsapp.com/send/?phone=5491121891006";
const MARQUEE_TEXT = "💲&nbsp; Los valores publicados se encuentran ligados a la cotización del dólar del día &nbsp; 🛒🛍️ &nbsp; Visita nuestro Showroom y comprá sin requisitos minimos de compra &nbsp; 🚚 &nbsp; ENVÍOS A TODO EL PAÍS";
const VALOR_CONSUMIDOR = "6";
const VALOR_MAYORISTA = "13";
const CACHE_VERSION = "2.2"; // Incrementa este número cuando actualices imágenes
const PEDIDOS_VERSION = "20260316"; // Versión para forzar actualización de pedidos.html en navegadores

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Función helper para agregar versión a las URLs de imágenes (cache busting)
function getCacheBustedURL(url) {
    if (!url || url === 'no-disponible.png') return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${CACHE_VERSION}`;
}

// Función helper para leer el stock de un artículo (columna K, item[10])
// Devuelve 0 si no hay dato o no es un número válido.
function getStockDe(item) {
    if (!item || item[10] === undefined || item[10] === null || String(item[10]).trim() === '') return 0;
    const n = parseInt(String(item[10]).trim(), 10);
    return isNaN(n) ? 0 : n;
}

// Función helper para determinar etiqueta de stock según precio
function getStockLabel(stock, precio) {
    const p = parseInt(String(precio).replace(/[^0-9]/g, ''), 10) || 0;
    const umbral = p >= 30000 ? 5 : 15;
    if (isNaN(stock) || stock <= 0) return { label: '✗ Sin stock',     color: '#ff9800' };
    if (stock <= umbral)            return { label: '⚠ Pocas unidades', color: '#ffeb3b' };
    return                                 { label: '✓ Disponible',     color: '#4CAF50' };
}

// Carousel functionality
document.addEventListener('DOMContentLoaded', function() {
    const carouselImages = document.getElementById('carousel-images');
    const slides = carouselImages ? carouselImages.querySelectorAll('.carousel-slide') : [];
    let currentIndex = 0;

    function updateCarousel() {
        if (carouselImages && slides.length > 0) {
            const offset = -currentIndex * 100;
            carouselImages.style.transform = `translateX(${offset}%)`;
        }
    }

    if (slides.length > 0) {
        setInterval(() => {
            currentIndex = (currentIndex + 1) % slides.length;
            updateCarousel();
        }, 5000); // Cambiar imagen cada 5 segundos
    }
});

// Main application variables
const ITEMS_PER_PAGE = 30;

let productos = [];
let datosFiltrados = []; // Variable para mantener los datos filtrados actuales
let currentPage = 1;
let carrito = [];
let currentLightboxImages = [];
let currentImageIndex = 0;
let datosExtraCliente = {}; // Datos del cliente para el pedido
let itemsOriginalesPedido = []; // Snapshot de los items originales del pedido (modo edición)
// 'envio' | 'retiro' - se elige al agregar el primer artículo al carrito y bifurca el flujo del checkout.
// En Firebase no se registra: solo se guardan pedidos de envío (los de retiro van por WhatsApp).
let tipoEntrega = '';

const TIPO_ENTREGA_STORAGE_KEY = 'tipoEntregaMayorista';

// Guarda la elección del cliente y la persiste junto al carrito
function setTipoEntrega(valor) {
    tipoEntrega = valor;

    if (modoEdicion) {
        return;
    }

    try {
        localStorage.setItem(TIPO_ENTREGA_STORAGE_KEY, valor);
    } catch (e) {
        console.error('Error al guardar el tipo de entrega en localStorage:', e);
    }
}

// Olvida la elección: se vuelve a preguntar al agregar el próximo "primer artículo"
function limpiarTipoEntrega() {
    tipoEntrega = '';

    try {
        localStorage.removeItem(TIPO_ENTREGA_STORAGE_KEY);
    } catch (e) {
        console.error('Error al limpiar el tipo de entrega de localStorage:', e);
    }
}

// El descuento del 10% solo corre para envíos. En modo edición el pedido original siempre
// es de envío (los de retiro no se registran en Firebase), así que lo mantiene.
function entregaConDescuento() {
    return modoEdicion || tipoEntrega === 'envio';
}

// Función para guardar el carrito en localStorage
function guardarCarritoLocal() {
    // No guardar en localStorage si estamos en modo edición
    if (modoEdicion) {
        return;
    }
    
    try {
        localStorage.setItem('carritoMayorista', JSON.stringify(carrito));
    } catch (e) {
        console.error('Error al guardar carrito en localStorage:', e);
    }
}

// Función para guardar el carrito en el pedido de Firebase (modo edición)
let _guardarPedidoTimer = null;
function guardarCarritoEnPedido() {
    if (!modoEdicion || !pedidoEditId) return;

    // Debounce de 1.5 segundos para agrupar cambios rápidos
    if (_guardarPedidoTimer) clearTimeout(_guardarPedidoTimer);
    _guardarPedidoTimer = setTimeout(() => {
        // Usar el snapshot original (itemsOriginalesPedido) para fusionar
        const nombresEnCarrito = new Set(carrito.map(c => c.nombre));

        // Items originales que no fueron tocados desde el catálogo
        const itemsFinales = itemsOriginalesPedido
            .filter(it => !nombresEnCarrito.has(it.nombre))
            .map(it => ({ ...it }));

        // Agregar items del carrito, sumando cantidad si ya existían en el pedido original
        carrito.forEach(sel => {
            const existeOriginal = itemsOriginalesPedido.find(it => it.nombre === sel.nombre);
            const item = {
                nombre: sel.nombre,
                cantidad: existeOriginal
                    ? existeOriginal.cantidad + sel.cantidad
                    : sel.cantidad,
                valorUSD: sel.precio,
                codigo: sel.codigo || '',
                categoria: sel.categoria || ''
            };
            // Solo incluir valorU y valorC si tienen un valor definido (Firebase rechaza undefined)
            if (existeOriginal?.valorU != null) item.valorU = existeOriginal.valorU;
            if (existeOriginal?.valorC != null) item.valorC = existeOriginal.valorC;
            itemsFinales.push(item);
        });

        db.ref('pedidos/' + pedidoEditId).update({
            items: itemsFinales,
            adminViewed: false,
            lastUpdated: Date.now()
        }).then(() => {
            console.log('Pedido actualizado automáticamente en Firebase');
        }).catch(err => {
            console.error('Error al guardar automáticamente en Firebase:', err);
        });
    }, 1500);
}

// Función para cargar el carrito desde localStorage
function cargarCarritoLocal() {
    // No cargar desde localStorage si estamos en modo edición
    if (modoEdicion) {
        return;
    }
    
    try {
        const carritoGuardado = localStorage.getItem('carritoMayorista');
        if (carritoGuardado) {
            carrito = JSON.parse(carritoGuardado);
        }

        // La entrega elegida solo tiene sentido mientras el carrito siga cargado
        const entregaGuardada = localStorage.getItem(TIPO_ENTREGA_STORAGE_KEY);
        if (carrito.length > 0 && (entregaGuardada === 'envio' || entregaGuardada === 'retiro')) {
            tipoEntrega = entregaGuardada;
        } else {
            limpiarTipoEntrega();
        }

        if (carritoGuardado) {
            actualizarCarrito();
        }
    } catch (e) {
        console.error('Error al cargar carrito desde localStorage:', e);
        carrito = [];
        limpiarTipoEntrega();
    }
}

// === Último pedido del cliente (para el acceso rápido de la barra inferior) ===
// Solo se registran los pedidos de envío: son los únicos que llegan a Firebase y
// por lo tanto los únicos con un id que pueda abrir pedidos.html. Los de retiro
// se cierran por WhatsApp y no tienen id, así que no se guardan (el cliente
// siempre conserva la búsqueda por email del modal #ultimoPedidoModal).
const ULTIMO_PEDIDO_STORAGE_KEY = 'ultimoPedidoMayorista';

function guardarUltimoPedidoLocal({ id, email, unidades, total, timestamp }) {
    if (!id) return;

    try {
        localStorage.setItem(ULTIMO_PEDIDO_STORAGE_KEY, JSON.stringify({
            id: id,
            email: email || '',
            timestamp: timestamp || Date.now(),
            unidades: unidades || 0,
            total: total || 0
        }));
    } catch (e) {
        console.error('Error al guardar el último pedido en localStorage:', e);
    }
    // La barra inferior muestra un punto en "Pedidos" cuando hay algo guardado
    if (typeof window.refrescarPuntoPedido === 'function') window.refrescarPuntoPedido();
}

// Devuelve el registro guardado o null. Tolera JSON corrupto y registros viejos
// sin id: en ambos casos el llamador cae en la búsqueda por email.
function leerUltimoPedidoLocal() {
    try {
        const crudo = localStorage.getItem(ULTIMO_PEDIDO_STORAGE_KEY);
        if (!crudo) return null;

        const pedido = JSON.parse(crudo);
        if (!pedido || typeof pedido !== 'object' || !pedido.id) return null;

        return pedido;
    } catch (e) {
        console.error('Error al leer el último pedido desde localStorage:', e);
        return null;
    }
}

// === soporte para editar un pedido existente ===
const urlParams    = new URLSearchParams(window.location.search);
const pedidoEditId = urlParams.get('pedido');   // si viene de pedidos.html
const modoEdicion  = !!pedidoEditId;

if (modoEdicion) {
    // Limpiar el carrito guardado en localStorage al entrar en modo edición
    localStorage.removeItem('carritoMayorista');
    localStorage.removeItem(TIPO_ENTREGA_STORAGE_KEY);
    
    const aviso = document.createElement('div');
    aviso.textContent = `⚙️ Estás agregando artículos al pedido #${pedidoEditId}`;
    aviso.id = 'aviso-edicion-pedido';
    aviso.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      z-index: 3001;
      background: #fff7c2;
      padding: 10px 0;
      text-align: center;
      font-weight: bold;
      font-size: 1.1em;
      box-shadow: 0 2px 8px #0002;
      border-bottom: 2px solid #ffe066;
    `;
    document.body.appendChild(aviso);
    // Agregar margen superior al body para que no tape el header
    document.body.style.marginTop = '54px';
    
    // Cargar los datos del pedido existente
    db.ref('pedidos/' + pedidoEditId).once('value')
        .then(snapshot => {
            if (snapshot.exists()) {
                const pedidoExistente = snapshot.val();
                // Guardar los datos del cliente del pedido existente
                datosExtraCliente = pedidoExistente.cliente || {};
                // Guardar snapshot de los items originales para el auto-guardado
                itemsOriginalesPedido = JSON.parse(JSON.stringify(pedidoExistente.items || []));
                console.log('Datos del pedido existente cargados:', pedidoExistente);

                // Quien llega desde el link del email también deja registrado el pedido
                // en este navegador, así "Pedidos" de la barra inferior le sirve después.
                // Se usan los datos reales del pedido, no los del carrito (que en modo
                // edición solo contiene los artículos que se están agregando ahora).
                const itemsPedido = pedidoExistente.items || [];
                guardarUltimoPedidoLocal({
                    id: pedidoEditId,
                    email: (pedidoExistente.cliente || {}).email || '',
                    timestamp: pedidoExistente.timestamp,
                    unidades: itemsPedido.reduce((sum, it) => sum + (Number(it.cantidad) || 0), 0),
                    total: itemsPedido.reduce((sum, it) => {
                        const precio = parseFloat(String(it.valorUSD).replace(/[^0-9.-]+/g, '')) || 0;
                        return sum + precio * (Number(it.cantidad) || 0);
                    }, 0)
                });
            }
        })
        .catch(error => {
            console.error('Error al cargar pedido existente:', error);
        });
}

const loadingOverlay = document.getElementById('loadingOverlay');

// Fetch data from Google Sheets
fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.RANGO}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`)
    .then(response => {
        if (!response.ok) throw new Error(`Error al acceder a la API: ${response.statusText}`);
        return response.json();
    })
    .then(data => {
        if (loadingOverlay) loadingOverlay.style.display = 'none'; // Ocultar el overlay de carga
        const items = data.values;
        if (!items || items.length === 0) throw new Error("No se encontraron datos en la hoja.");
        
        // y ordenar descendente por la fecha (índice 12 - columna M)
            productos = items
                .filter(item => (item[3] || '').toString().trim() !== '') // Excluir filas con columna D vacía
            .sort((a, b) => {
                // Función para convertir fecha DD/MM/YYYY a objeto Date
                function parsearFecha(fechaStr) {
                    if (!fechaStr || fechaStr === '' || fechaStr === null || fechaStr === undefined) {
                        return new Date(1900, 0, 1); // Fecha muy antigua
                    }
                    
                    // Si está en formato DD/MM/YYYY
                    if (fechaStr.includes('/')) {
                        const partes = fechaStr.split('/');
                        if (partes.length === 3) {
                            const dia = parseInt(partes[0]);
                            const mes = parseInt(partes[1]) - 1; // Los meses en JS van de 0-11
                            const año = parseInt(partes[2]);
                            return new Date(año, mes, dia);
                        }
                    }
                    
                    // Si no puede parsearse, devolver fecha antigua
                    return new Date(1900, 0, 1);
                }
                
                // Obtener las fechas de la columna M (índice 12)
                const dateA = parsearFecha(a[12]);
                const dateB = parsearFecha(b[12]);
                
                // Ordenar por fecha descendente (más recientes primero)
                return dateB - dateA;
            });
        
        // Inicializar datosFiltrados con todos los productos
        datosFiltrados = productos;
        
        // Asegurar que el scroll esté en la parte superior al cargar
        window.scrollTo(0, 0);
        
        mostrarPagina(1);
        
        // Primero refrescar la información de stock, luego aplicar filtros
        // Esto previene la condición de carrera en navegadores móviles
        setTimeout(() => {
            refreshStockInfo();
            // Reconciliar el carrito guardado (localStorage) contra el stock recién cargado:
            // evita que ítems viejos sin stock queden invisibles en el carrito y se envíen.
            reconciliarCarritoConStock();
            // Aplicar filtros después de actualizar el stock
            if (document.getElementById('filtroDisponibles').checked) {
                aplicarFiltros();
            }
            // Después de completar la carga inicial, permitir scroll hacia categorías
            setTimeout(() => {
                primeraCarga = false;
            }, 100);
        }, 100);

        // Usar la lista filtrada para obtener categorías
        const categoriasSet = new Set(productos.map(item => item[0]));
        const selectCategorias = document.getElementById('categorias');
        
        // Convertir a array, filtrar categorías vacías y ordenar alfabéticamente
        const categoriasOrdenadas = Array.from(categoriasSet)
            .filter(categoria => categoria && categoria.trim() !== '') // Filtrar categorías vacías
            .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })); // Ordenar alfabéticamente
        
        categoriasOrdenadas.forEach(categoria => {
            const option = document.createElement('option');
            option.value = categoria;
            option.textContent = categoria;
            selectCategorias.appendChild(option);
        });

        selectCategorias.addEventListener('change', () => {
            aplicarFiltros();
        });

        document.getElementById('buscar').addEventListener('input', (e) => {
            aplicarFiltros();
        });

        document.getElementById('filtroDisponibles').addEventListener('change', () => {
            aplicarFiltros();
        });

        document.getElementById('todos').addEventListener('click', () => {
            // Resetear todos los filtros
            document.getElementById('categorias').value = 'todos';
            document.getElementById('buscar').value = '';
            document.getElementById('filtroDisponibles').checked = false;
            // Resetear los datos filtrados para mostrar todos los productos
            datosFiltrados = productos;
            // Mostrar todos los productos
            mostrarPagina(1);
        });

        // Función auxiliar para normalizar texto (eliminar acentos y caracteres especiales)
        function normalizarTexto(texto) {
            if (!texto) return '';
            return texto
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "") // Elimina acentos
                .replace(/[^\w\s]/g, " ") // Reemplaza caracteres especiales por espacios
                .replace(/\s+/g, " ") // Normaliza espacios múltiples
                .trim();
        }
        
        // Algoritmo de Distancia de Levenshtein para búsqueda difusa
        function distanciaLevenshtein(a, b) {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            
            const matriz = [];
            
            // Inicializar la primera columna
            for (let i = 0; i <= b.length; i++) {
                matriz[i] = [i];
            }
            
            // Inicializar la primera fila
            for (let j = 0; j <= a.length; j++) {
                matriz[0][j] = j;
            }
            
            // Calcular distancias
            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    if (b.charAt(i - 1) === a.charAt(j - 1)) {
                        matriz[i][j] = matriz[i - 1][j - 1];
                    } else {
                        matriz[i][j] = Math.min(
                            matriz[i - 1][j - 1] + 1, // Sustitución
                            matriz[i][j - 1] + 1,     // Inserción
                            matriz[i - 1][j] + 1      // Eliminación
                        );
                    }
                }
            }
            
            return matriz[b.length][a.length];
        }
        
        // Función para calcular tolerancia de errores según longitud de palabra
        function calcularTolerancia(longitudPalabra) {
            if (longitudPalabra <= 3) return 0;  // Palabras cortas: sin tolerancia
            if (longitudPalabra <= 5) return 1;  // Palabras medias: 1 error
            if (longitudPalabra <= 8) return 2;  // Palabras largas: 2 errores
            return 3;                             // Palabras muy largas: 3 errores
        }
        
        // Función para verificar coincidencia difusa entre dos palabras
        function coincidenciaDifusa(palabra1, palabra2) {
            const tolerancia = calcularTolerancia(palabra1.length);
            const distancia = distanciaLevenshtein(palabra1, palabra2);
            return distancia <= tolerancia;
        }
        
        // Función para verificar si todas las palabras del query están en el texto (con búsqueda difusa)
        function coincideBusquedaInteligente(texto, palabrasQuery) {
            const textoNormalizado = normalizarTexto(texto);
            const palabrasTexto = textoNormalizado.split(' ').filter(p => p.length > 0);
            
            // Cada palabra del query debe tener al menos una coincidencia (exacta o difusa) en el texto
            return palabrasQuery.every(palabraQuery => {
                // Primero intentar coincidencia exacta (más rápida)
                if (textoNormalizado.includes(palabraQuery)) {
                    return true;
                }
                
                // Si no hay coincidencia exacta, intentar búsqueda difusa
                return palabrasTexto.some(palabraTexto => 
                    coincidenciaDifusa(palabraQuery, palabraTexto)
                );
            });
        }

        // Función para aplicar todos los filtros combinados
        function aplicarFiltros() {
            const categoria = document.getElementById('categorias').value;
            const query = document.getElementById('buscar').value;
            const soloDisponibles = document.getElementById('filtroDisponibles').checked;
            let filtrados = productos;
            
            // Filtrar por categoría
            if (categoria !== "todos") {
                filtrados = filtrados.filter(item => item[0] === categoria);
            }
            
            // Filtrar por búsqueda (búsqueda inteligente mejorada)
            if (query.trim() !== '') {
                const queryNormalizado = normalizarTexto(query);
                const palabrasQuery = queryNormalizado.split(' ').filter(p => p.length > 0);
                
                filtrados = filtrados.filter(item => {
                    const nombre = item[3] || '';
                    const codigoNormalizado = normalizarTexto(item[2] || '');

                    const coincidePorNombre = coincideBusquedaInteligente(nombre, palabrasQuery);
                    const coincidePorCodigo = palabrasQuery.every(p => codigoNormalizado.includes(p));

                    return coincidePorNombre || coincidePorCodigo;
                });
            }
            
            // Filtrar por disponibilidad (solo disponibles y pocas unidades)
            if (soloDisponibles) {
                filtrados = filtrados.filter(item => {
                    // Mostrar solo si tiene stock válido (mayor a 1)
                    return getStockDe(item) > 1;
                });
            }
            
            // Guardar los datos filtrados en la variable global
            datosFiltrados = filtrados;
            mostrarPagina(1, filtrados);
        }
    })
    .catch(error => {
        if (loadingOverlay) loadingOverlay.style.display = 'none'; // Ocultar el overlay de carga en caso de error
        console.error('Error al cargar los datos:', error);
        document.querySelector('#error').textContent = error.message;
    });

let primeraCarga = true;
function mostrarPagina(pagina, datos = productos) {
    currentPage = pagina;
    const totalPaginas = Math.ceil(datos.length / ITEMS_PER_PAGE);
    const inicio = (pagina - 1) * ITEMS_PER_PAGE;
    const fin = inicio + ITEMS_PER_PAGE;
    const datosPagina = datos.slice(inicio, fin);

    cargarGrid(datosPagina);
    actualizarPaginacion(pagina, datos);

    // Solo hacer scroll si no se está escribiendo en el campo de búsqueda
    if (document.activeElement !== document.getElementById('buscar')) {
        // Usar setTimeout para asegurar que el DOM se haya actualizado
        setTimeout(() => {
            if (primeraCarga) {
                // En la primera carga, mantener scroll arriba
                window.scrollTo({ top: 0, behavior: 'auto' });
            } else {
                // En interacciones posteriores, scroll hacia categorías
                const selectCategorias = document.getElementById('categorias');
                if (selectCategorias) {
                    const rect = selectCategorias.getBoundingClientRect();
                    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    // En escritorio el header queda fijo arriba: hay que descontar
                    // su alto o el filtro aterriza escondido detrás. En móvil el
                    // header no es fijo y offsetHeaderFijo() devuelve 0.
                    const offsetHeader = typeof window.offsetHeaderFijo === 'function'
                        ? window.offsetHeaderFijo()
                        : 0;
                    window.scrollTo({
                        top: rect.top + scrollTop - offsetHeader - 20, // 20px de margen superior
                        behavior: 'smooth'
                    });
                }
            }
        }, 0);
    }
}

function cargarGrid(data) {
    const grid = document.getElementById('catalogo');
    grid.innerHTML = '';

    data.forEach(item => {
        const card = document.createElement('div');
        card.classList.add('card');

        // Agregar input hidden con el código del artículo para referencias posteriores
        const hiddenCode = document.createElement('input');
        hiddenCode.type = 'hidden';
        hiddenCode.value = item[2]; // Código del artículo
        card.appendChild(hiddenCode);

        // Agregar ícono de información si hay descripción o tamaño
        const descripcion = item[14] || ''; // Columna O
        const tamano = item[15] || ''; // Columna P
        
        if (descripcion || tamano) {
            const infoIcon = document.createElement('div');
            infoIcon.classList.add('info-icon');
            infoIcon.innerHTML = '<i class="fas fa-info"></i>';
            infoIcon.title = 'Ver información adicional';
            infoIcon.addEventListener('click', () => {
                mostrarInfoModal(item[3], descripcion, tamano);
            });
            card.appendChild(infoIcon);
        }

        // 1. Imagen
        if (isValidImageUrl(item[1])) {
            let imageUrls = [];
            if (item[1].indexOf(',') !== -1) {
                imageUrls = item[1].split(',').map(url => getCacheBustedURL(url.trim()));
            } else {
                imageUrls.push(getCacheBustedURL(item[1]));
            }
            const img = document.createElement('img');
            img.src = imageUrls[0];
            img.referrerPolicy = 'no-referrer';
            img.loading = 'lazy';
            let fallbackStep = 0; // 0 = primer link, 1 = cuarto link, 2 = no-disponible
            img.onerror = function() {
                if (fallbackStep === 0 && imageUrls[3]) {
                    fallbackStep = 1;
                    this.src = imageUrls[3]; // Si falla la primera, probar la cuarta
                } else {
                    fallbackStep = 2;
                    this.src = getCacheBustedURL('no-disponible.png'); // Imagen de respaldo
                }
            };
            img.addEventListener('click', () => {
                abrirLightbox(imageUrls);
            });
            card.appendChild(img);
        }

        // 2. Nombre del Artículo
        const articulo = document.createElement('h3');
        articulo.textContent = item[3];
        card.appendChild(articulo);

        // 3. Código
        const info = document.createElement('div');
        info.classList.add('info');
        info.textContent = `Código: ${item[2]}`;
        card.appendChild(info);

        // 4. Disponibilidad de stock (ahora desde columna K, item[10])
        const stockInfo = document.createElement('div');
        stockInfo.classList.add('stock-info');
        stockInfo.style.margin = '5px 0';
        stockInfo.style.fontWeight = 'bold';

        let stock = getStockDe(item);
        const { label: stockLabel, color: stockColor } = getStockLabel(stock, item[6]);
        stockInfo.innerHTML = `<span style="color: ${stockColor};">${stockLabel}</span>`;
        card.appendChild(stockInfo);

        // 5. Valor $
        const valorPesos = document.createElement('p');
        valorPesos.innerHTML = `<strong>Valor $</strong> ${item[VALOR_CONSUMIDOR]}`;
        valorPesos.style.margin = '10px 0 5px 0';
        card.appendChild(valorPesos);

        // 6. Valor Mayorista
        const valorUSD = document.createElement('p');
        valorUSD.innerHTML = `<strong>Mayorista $</strong> ${item[VALOR_MAYORISTA]}`;
        valorUSD.style.margin = '0 0 15px 0';
        valorUSD.style.fontSize = '15px';
        valorUSD.style.color = '#F57C00';
        card.appendChild(valorUSD);

        // 7. Cantidad + Botón carrito
        const actionContainer = document.createElement('div');
        actionContainer.style.display = 'flex';
        actionContainer.style.alignItems = 'center';
        actionContainer.style.justifyContent = 'center';
        actionContainer.style.gap = '5px';
        actionContainer.style.minHeight = '50px';

        // Contenedor para el control de cantidad (inicialmente oculto)
        const quantityContainer = document.createElement('div');
        quantityContainer.style.display = 'none';
        quantityContainer.style.alignItems = 'center';
        quantityContainer.style.gap = '5px';
        quantityContainer.style.transition = 'all 0.3s ease';
        quantityContainer.style.opacity = '0';

        // Botón decrementar
        const btnDecrementar = document.createElement('button');
        btnDecrementar.innerHTML = '-';
        btnDecrementar.style.padding = '5px 10px';
        btnDecrementar.style.fontSize = '16px';
        btnDecrementar.style.height = '35px';
        btnDecrementar.style.width = '35px';
        btnDecrementar.style.backgroundColor = '#ff9800';
        btnDecrementar.style.color = '#fff';
        btnDecrementar.style.border = '1px solid #ff9800';
        btnDecrementar.style.borderRadius = '4px';
        btnDecrementar.style.cursor = 'pointer';

        // Campo de cantidad
        const cantidadSelector = document.createElement('input');
        cantidadSelector.type = 'number';
        cantidadSelector.min = '1';
        cantidadSelector.value = '1';
        cantidadSelector.style.width = '50px';
        cantidadSelector.style.height = '35px';
        cantidadSelector.style.padding = '5px';
        cantidadSelector.style.textAlign = 'center';
        cantidadSelector.style.border = '1px solid #ddd';
        cantidadSelector.style.borderRadius = '4px';

        // Botón incrementar
        const btnIncrementar = document.createElement('button');
        btnIncrementar.innerHTML = '+';
        btnIncrementar.style.padding = '5px 10px';
        btnIncrementar.style.fontSize = '16px';
        btnIncrementar.style.height = '35px';
        btnIncrementar.style.width = '35px';
        btnIncrementar.style.backgroundColor = '#ff9800';
        btnIncrementar.style.color = '#fff';
        btnIncrementar.style.border = '1px solid #ff9800';
        btnIncrementar.style.borderRadius = '4px';
        btnIncrementar.style.cursor = 'pointer';

        // Agregar elementos al contenedor de cantidad
        quantityContainer.appendChild(btnDecrementar);
        quantityContainer.appendChild(cantidadSelector);
        quantityContainer.appendChild(btnIncrementar);

        // Botón inicial del carrito
        const btnCarrito = document.createElement('button');
        btnCarrito.innerHTML = '<i class="fas fa-cart-plus"></i>';
        btnCarrito.style.padding = '10px 10px';
        btnCarrito.style.fontSize = '16px';
        btnCarrito.style.height = '50px';
        btnCarrito.style.width = '50px';
        btnCarrito.style.backgroundColor = '#4CAF50';
        btnCarrito.style.color = '#fff';
        btnCarrito.style.border = '1px solid #4CAF50';
        btnCarrito.style.borderRadius = '4px';
        btnCarrito.style.cursor = 'pointer';
        btnCarrito.style.transition = 'all 0.3s ease';
        btnCarrito.classList.add('btn-agregar-carrito');

        // Establecer máximo basado en stock disponible (desde columna K)
        if (!isNaN(stock) && stock > 0) {
            cantidadSelector.max = stock;
            cantidadSelector.title = `Máximo ${stock} unidades disponibles`;
        } else {
            // Sin stock disponible o sin información de stock
            btnCarrito.disabled = true;
            btnCarrito.style.backgroundColor = '#cccccc';
            btnCarrito.style.borderColor = '#cccccc';
            btnCarrito.style.cursor = 'not-allowed';
            btnCarrito.title = 'Sin stock disponible';
        }

        // Función para actualizar carrito
        function actualizarArticuloEnCarrito() {
            const cantidad = parseInt(cantidadSelector.value);
            if (cantidad > 0) {
                const existe = carrito.find(cartItem => cartItem.nombre === articulo.textContent);
                if (existe) {
                    existe.cantidad = cantidad;
                } else {
                    agregarAlCarrito(articulo.textContent, item[6], cantidad, item[2], item[0], item[7].toString().replace(/[,\.]/g, ''), item[6].toString().replace(/[,\.]/g, ''));
                    return; // agregarAlCarrito ya guarda en Firebase si es modo edición
                }
                actualizarCarrito();
                guardarCarritoLocal();

                // En modo edición, guardar automáticamente en Firebase
                if (modoEdicion && pedidoEditId) {
                    guardarCarritoEnPedido();
                }
            }
        }

        // Función para mostrar control de cantidad
        function mostrarControlCantidad() {
            btnCarrito.style.opacity = '0';
            btnCarrito.style.transform = 'scale(0.8)';
            
            setTimeout(() => {
                btnCarrito.style.display = 'none';
                quantityContainer.style.display = 'flex';
                
                setTimeout(() => {
                    quantityContainer.style.opacity = '1';
                    quantityContainer.style.transform = 'scale(1)';
                }, 50);
            }, 150);
        }

        // Evento click del botón carrito
        btnCarrito.addEventListener('click', () => {
            // Consultar stock desde columna K
            const stockDisponibleClick = getStockDe(item);
            if (isNaN(stockDisponibleClick) || stockDisponibleClick <= 0) {
                alert('Este producto no tiene stock disponible.');
                return;
            }
            // Con el primer artículo se elige antes el tipo de entrega:
            // si el cliente cierra el modal sin elegir, no se agrega nada.
            pedirTipoEntregaSiHaceFalta(() => {
                // Agregar al carrito y mostrar control
                cantidadSelector.value = '1';
                actualizarArticuloEnCarrito();
                mostrarControlCantidad();
            });
        });

        // Eventos de los botones de cantidad
        btnIncrementar.addEventListener('click', () => {
            // Consultar stock desde columna K
            const stockDisponibleClick = getStockDe(item);
            const cantidad = parseInt(cantidadSelector.value);
            if (!isNaN(stockDisponibleClick) && cantidad >= stockDisponibleClick) {
                alert(`Stock insuficiente. Solo hay ${stockDisponibleClick} unidades disponibles.`);
                return;
            }
            cantidadSelector.value = cantidad + 1;
            actualizarArticuloEnCarrito();
        });

        btnDecrementar.addEventListener('click', () => {
            const cantidad = parseInt(cantidadSelector.value);
            if (cantidad > 1) {
                cantidadSelector.value = cantidad - 1;
                actualizarArticuloEnCarrito();
            } else {
                // Remover del carrito y volver al botón inicial
                const existe = carrito.find(cartItem => cartItem.nombre === articulo.textContent);
                if (existe) {
                    const index = carrito.indexOf(existe);
                    carrito.splice(index, 1);
                    actualizarCarrito();
                    guardarCarritoLocal();

                    // En modo edición, guardar automáticamente en Firebase
                    if (modoEdicion && pedidoEditId) {
                        guardarCarritoEnPedido();
                    }
                }
                
                // Animación de vuelta al botón carrito
                quantityContainer.style.opacity = '0';
                quantityContainer.style.transform = 'scale(0.8)';
                
                setTimeout(() => {
                    quantityContainer.style.display = 'none';
                    btnCarrito.style.display = 'block';
                    btnCarrito.style.opacity = '0';
                    btnCarrito.style.transform = 'scale(0.8)';
                    
                    setTimeout(() => {
                        btnCarrito.style.opacity = '1';
                        btnCarrito.style.transform = 'scale(1)';
                    }, 50);
                }, 150);
            }
        });

        // Evento change del input de cantidad
        cantidadSelector.addEventListener('change', () => {
            const cantidad = parseInt(cantidadSelector.value);
            const stockDisponibleClick = getStockDe(item);
            if (cantidad <= 0) {
                cantidadSelector.value = '1';
            } else if (!isNaN(stockDisponibleClick) && cantidad > stockDisponibleClick) {
                alert(`Stock insuficiente. Solo hay ${stockDisponibleClick} unidades disponibles.`);
                cantidadSelector.value = stockDisponibleClick;
            }
            actualizarArticuloEnCarrito();
        });

        // Agregar elementos al contenedor principal
        actionContainer.appendChild(btnCarrito);
        actionContainer.appendChild(quantityContainer);

        card.appendChild(actionContainer);
        grid.appendChild(card);
    });

    // Las tarjetas se dibujan siempre con el botón de agregar: reflejar lo que ya está en el carrito
    sincronizarCardsConCarrito();
}

// Deja los controles de cada tarjeta acordes al carrito: si el artículo ya está cargado
// muestra el selector con su cantidad; si no, el botón de agregar.
// Sin animación: se usa al (re)dibujar el catálogo o cuando el carrito cambia por fuera de la tarjeta.
function sincronizarCardsConCarrito() {
    document.querySelectorAll('.card').forEach(card => {
        const nombre = card.querySelector('h3')?.textContent;
        const btnCarrito = card.querySelector('.btn-agregar-carrito');
        const cantidadInput = card.querySelector('input[type="number"]');
        const quantityContainer = cantidadInput?.parentElement;
        if (!nombre || !btnCarrito || !cantidadInput || !quantityContainer) return;

        const enCarrito = carrito.find(item => item.nombre === nombre);

        if (enCarrito) {
            cantidadInput.value = enCarrito.cantidad;
            btnCarrito.style.display = 'none';
            quantityContainer.style.display = 'flex';
            quantityContainer.style.opacity = '1';
            quantityContainer.style.transform = 'scale(1)';
        } else {
            cantidadInput.value = '1';
            quantityContainer.style.display = 'none';
            quantityContainer.style.opacity = '0';
            quantityContainer.style.transform = 'scale(0.8)';
            btnCarrito.style.display = 'block';
            btnCarrito.style.opacity = '1';
            btnCarrito.style.transform = 'scale(1)';
        }
    });
}

// Función para refrescar la información de stock en todas las tarjetas visibles
function refreshStockInfo() {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        const stockInfo = card.querySelector('.stock-info');
        if (stockInfo) {
            // Obtener el código del artículo desde el input hidden
            const hiddenInput = card.querySelector('input[type="hidden"]');
            if (hiddenInput) {
                // Buscar el producto en la lista global productos
                const codigo = hiddenInput.value;
                const producto = productos.find(item => item[2] === codigo);
                let stock = getStockDe(producto);
                const { label: stockLabel, color: stockColor } = getStockLabel(stock, producto ? producto[6] : 0);
                stockInfo.innerHTML = `<span style="color: ${stockColor};">${stockLabel}</span>`;

                // También actualizar los controles de cantidad si existen
                const cantidadSelector = card.querySelector('input[type="number"]');
                const btnCarrito = card.querySelector('.btn-agregar-carrito');

                if (cantidadSelector) {
                    if (!isNaN(stock) && stock > 0) {
                        cantidadSelector.max = stock;
                        cantidadSelector.disabled = false;
                        cantidadSelector.title = `Máximo ${stock} unidades disponibles`;

                        // Rehabilitar botón carrito si existe y está deshabilitado
                        if (btnCarrito && btnCarrito.disabled) {
                            btnCarrito.disabled = false;
                            btnCarrito.style.backgroundColor = '#4CAF50';
                            btnCarrito.style.borderColor = '#4CAF50';
                            btnCarrito.style.cursor = 'pointer';
                            btnCarrito.title = '';
                        }
                    } else {
                        cantidadSelector.disabled = true;
                        cantidadSelector.title = 'Sin stock disponible';

                        // Deshabilitar botón carrito si existe
                        if (btnCarrito) {
                            btnCarrito.disabled = true;
                            btnCarrito.style.backgroundColor = '#cccccc';
                            btnCarrito.style.borderColor = '#cccccc';
                            btnCarrito.style.cursor = 'not-allowed';
                            btnCarrito.title = 'Sin stock disponible';
                        }
                    }
                }
            }
        }
    });
}

// Reconcilia el carrito (típicamente restaurado desde localStorage) contra el stock
// ya cargado en `productos`: quita ítems sin stock y clampa cantidades excedidas.
// Solo aplica en modo normal (el modo edición no usa localStorage).
function reconciliarCarritoConStock() {
    if (modoEdicion || carrito.length === 0 || productos.length === 0) return;

    let cambiado = false;
    for (let i = carrito.length - 1; i >= 0; i--) {
        const cartItem = carrito[i];
        const codigo = (cartItem.codigo || '').toString().trim();
        let producto = codigo ? productos.find(p => (p[2] || '').toString().trim() === codigo) : null;
        if (!producto) producto = productos.find(p => (p[3] || '').toString().trim() === cartItem.nombre);

        const stockDisponible = getStockDe(producto);
        if (stockDisponible <= 0) {
            carrito.splice(i, 1);
            cambiado = true;
        } else if (cartItem.cantidad > stockDisponible) {
            cartItem.cantidad = stockDisponible;
            cambiado = true;
        }
    }

    if (cambiado) {
        actualizarCarrito();
        guardarCarritoLocal();
        sincronizarCardsConCarrito();
    }
}

// Antes de sumar el primer artículo hay que saber cómo lo va a recibir el cliente.
// Si cierra el modal sin elegir, no se ejecuta el callback y no se agrega nada al carrito.
function pedirTipoEntregaSiHaceFalta(onElegido) {
    if (modoEdicion || tipoEntrega) {
        onElegido();
        return;
    }
    mostrarModalTipoEntrega(onElegido); // definida en catalogo.html
}

function agregarAlCarrito(nombre, precio, cantidad, codigo, categoria) {
    const existe = carrito.find(item => item.nombre === nombre);
    if (existe) {
        // Si el artículo ya existe, actualizamos la cantidad
        existe.cantidad += cantidad;
    } else {
        // Si no existe, lo agregamos al carrito
        carrito.push({ nombre, precio, cantidad, codigo, categoria});
    }
    actualizarCarrito();
    guardarCarritoLocal();

    // En modo edición, guardar automáticamente en Firebase
    if (modoEdicion && pedidoEditId) {
        guardarCarritoEnPedido();
    }
}

function getMaxVisiblePaginationButtons() {
    // Cada botón ocupa 48px (40px ancho + 8px margen), ajusta si tu CSS es diferente
    const minButtonWidth = 48;
    const container = document.getElementById('pagination');
    let availableWidth = window.innerWidth;
    if (container) {
        // Si la paginación está en un contenedor más pequeño, usa su ancho
        availableWidth = container.offsetWidth || availableWidth;
    }
    // Deja espacio para botones "Anterior" y "Siguiente" (2x100px)
    const reserved = 220;
    const maxButtons = Math.max(3, Math.floor((availableWidth - reserved) / minButtonWidth));
    return Math.min(maxButtons, 15); // Límite máximo de 15 botones
}

function actualizarPaginacion(paginaActual, datos) {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';

    const totalPaginas = Math.ceil(datos.length / ITEMS_PER_PAGE);

    // Botón "Anterior"
    if (paginaActual > 1) {
        const btnAnterior = document.createElement('button');
        btnAnterior.textContent = 'Anterior';
        btnAnterior.style.width = '100px';
        btnAnterior.addEventListener('click', () => mostrarPagina(paginaActual - 1, datos));
        pagination.appendChild(btnAnterior);
    }

    // Botones numerados
    const MAX_VISIBLE_BUTTONS = getMaxVisiblePaginationButtons();
    let startPage = Math.max(1, paginaActual - Math.floor(MAX_VISIBLE_BUTTONS / 2));
    let endPage = Math.min(totalPaginas, startPage + MAX_VISIBLE_BUTTONS - 1);

    if (endPage - startPage < MAX_VISIBLE_BUTTONS - 1) {
        startPage = Math.max(1, endPage - MAX_VISIBLE_BUTTONS + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btnPagina = document.createElement('button');
        btnPagina.textContent = i;
        btnPagina.classList.add('pagination-button');
        if (i === paginaActual) {
            btnPagina.classList.add('active'); // Clase para el botón activo
        }
        btnPagina.addEventListener('click', () => mostrarPagina(i, datos));
        pagination.appendChild(btnPagina);
    }

    // Botón "Siguiente"
    if (paginaActual < totalPaginas) {
        const btnSiguiente = document.createElement('button');
        btnSiguiente.textContent = 'Siguiente';
        btnSiguiente.style.width = '100px'; // Define el ancho del botón
        btnSiguiente.addEventListener('click', () => mostrarPagina(paginaActual + 1, datos));
        pagination.appendChild(btnSiguiente);
    }
}

// Recalcular paginación al redimensionar la ventana
window.addEventListener('resize', () => {
    // Usar datosFiltrados si existen filtros aplicados, sino productos
    if (typeof currentPage !== 'undefined') {
        const datosActuales = datosFiltrados.length > 0 ? datosFiltrados : productos;
        actualizarPaginacion(currentPage, datosActuales);
    }
});

function isValidImageUrl(url) {
    return url && url.match(/\.(jpeg|jpg|gif|png)$/i);
}

// Precarga una URL y resuelve true si la imagen responde, false si falla
function precargarImagen(url) {
    return new Promise((resolve) => {
        const test = new Image();
        test.referrerPolicy = 'no-referrer';
        test.onload = () => resolve(true);
        test.onerror = () => resolve(false);
        test.src = url;
    });
}

function abrirLightbox(images) {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');

    // Abrir el lightbox de inmediato mostrando la primera imagen candidata
    currentLightboxImages = images.slice();
    currentImageIndex = 0;
    lightboxImg.src = currentLightboxImages[currentImageIndex] || getCacheBustedURL('no-disponible.png');
    lightbox.style.display = 'flex';
    actualizarBotonesLightbox();

    // Filtrar en segundo plano: quedarnos solo con las imágenes que responden,
    // conservando el orden original
    Promise.all(images.map(precargarImagen)).then((resultados) => {
        // Si el lightbox se cerró mientras precargábamos, no hacemos nada
        if (lightbox.style.display === 'none') return;

        const validas = images.filter((_, i) => resultados[i]);
        currentLightboxImages = validas.length > 0
            ? validas
            : [getCacheBustedURL('no-disponible.png')];
        currentImageIndex = 0;
        lightboxImg.src = currentLightboxImages[currentImageIndex];
        actualizarBotonesLightbox();
    });
}

function actualizarBotonesLightbox() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    if (currentLightboxImages.length > 1) {
        prevBtn.style.display = 'block';
        nextBtn.style.display = 'block';
    } else {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    }
}

document.getElementById('next-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentLightboxImages.length > 0) {
        currentImageIndex = (currentImageIndex + 1) % currentLightboxImages.length;
        document.getElementById('lightbox-img').src = currentLightboxImages[currentImageIndex];
    }
});

document.getElementById('prev-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentLightboxImages.length > 0) {
        currentImageIndex = (currentLightboxImages.length + currentImageIndex - 1) % currentLightboxImages.length;
        document.getElementById('lightbox-img').src = currentLightboxImages[currentImageIndex];
    }
});

document.getElementById('lightbox-img').addEventListener('error', function() {
    // Si ocurre un error y no se trata de la primera imagen, mostramos la primera
    if (currentLightboxImages.length > 0 && currentImageIndex !== 0) {
        currentImageIndex = 0;
        this.src = currentLightboxImages[0];
    }
});

function closeLightbox(event) {
    if (event.target === event.currentTarget || event.target.classList.contains('close')) {
        document.getElementById('lightbox').style.display = 'none';
    }
}

// Función para mostrar el modal de información del producto
function mostrarInfoModal(nombreProducto, descripcion, tamano) {
    const modal = document.getElementById('infoModal');
    const modalTitle = document.getElementById('infoModalTitle');
    const modalBody = document.getElementById('infoModalBody');
    
    // Configurar el título
    modalTitle.textContent = nombreProducto;
    
    // Construir el contenido del modal
    let contenido = '';
    
    if (descripcion && descripcion.trim() !== '') {
        contenido += `
            <div class="info-modal-section">
                <p>${descripcion}</p>
            </div>
        `;
    }
    
    if (tamano && tamano.trim() !== '') {
        contenido += `
            <div class="info-modal-section">
                <h4>Tamaño (cm)</h4>
                <p>${tamano}</p>
            </div>
        `;
    }
    
    modalBody.innerHTML = contenido;
    
    // Mostrar el modal
    modal.classList.add('show');
}

// Función para cerrar el modal de información
function closeInfoModal(event) {
    const modal = document.getElementById('infoModal');
    
    // Cerrar si se hace click fuera del contenido o si no hay evento (llamada directa)
    if (!event || event.target === event.currentTarget) {
        modal.classList.remove('show');
    }
}

function actualizarCarrito() {
    const cartList = document.getElementById('cart-list');
    const cartFloatBtn = document.getElementById('cartFloatBtn');
    const cartBadge = document.getElementById('cartBadge');
    // Puede haber más de uno: el del header en escritorio y el de la barra
    // inferior en móvil (solo uno está visible por vez, pero ambos se mantienen
    // al día para que no queden contadores desfasados al cambiar el ancho)
    const badgesNav = document.querySelectorAll('.js-badge-carrito');

    cartList.innerHTML = '';

    const resumen = calcularResumenCarrito();
    const totalUnidades  = resumen.unidades;
    const totalMonto     = resumen.totalBruto;
    const aplicaDescuento = resumen.aplicaDescuento;
    const montoDescuento = resumen.montoDescuento;
    const totalFinal     = resumen.totalFinal;

    const formatearMonto = (n) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    const cartTotalAmount = document.getElementById('cartTotalAmount');
    if (cartTotalAmount) {
        cartTotalAmount.textContent = formatearMonto(totalFinal);
    }

    const cartDiscount = document.getElementById('cartDiscount');
    const cartDiscountAmount = document.getElementById('cartDiscountAmount');
    const cartDiscountNote = document.getElementById('cartDiscountNote');
    const cartTotalOriginal = document.getElementById('cartTotalOriginal');
    if (cartDiscount && cartDiscountAmount && cartTotalOriginal) {
        if (aplicaDescuento) {
            cartDiscount.style.display = 'flex';
            cartDiscountAmount.textContent = '-' + formatearMonto(montoDescuento);
            cartTotalOriginal.textContent = formatearMonto(totalMonto);
            if (cartDiscountNote) cartDiscountNote.style.display = 'block';
        } else {
            cartDiscount.style.display = 'none';
            cartTotalOriginal.textContent = '';
            if (cartDiscountNote) cartDiscountNote.style.display = 'none';
        }
    }

    if (carrito.length === 0) {
        // Ocultar botón flotante y badge si está vacío
        if (cartFloatBtn) cartFloatBtn.style.display = 'none';
        // Cerrar el carrito expandido si está abierto
        const cartContainer = document.getElementById('cartContainer');
        if (cartContainer) {
            cartContainer.classList.remove('active');
            if (typeof cartExpanded !== 'undefined') cartExpanded = false;
            // Este camino no pasa por toggleCart(), así que el resaltado del ítem
            // "Carrito" de la barra inferior se apaga a mano
            if (typeof window.sincronizarTabCarrito === 'function') window.sincronizarTabCarrito();
        }
        // Carrito vacío: el próximo artículo vuelve a ser "el primero" y se pregunta de nuevo
        if (!modoEdicion && tipoEntrega) {
            limpiarTipoEntrega();
        }
    } else {
        // Mostrar botón flotante si hay items
        if (cartFloatBtn) cartFloatBtn.style.display = 'flex';
    }

    // Fila con el tipo de entrega elegido (con opción de cambiarlo)
    pintarEntregaEnCarrito();

    // Actualizar badge
    if (cartBadge) {
        cartBadge.textContent = totalUnidades;
    }

    // Mismo contador en los accesos de navegación, que son la vía real al
    // carrito (el botón flotante quedó oculto). Con el carrito vacío el globo
    // desaparece en lugar de mostrar un 0.
    badgesNav.forEach(badge => {
        badge.textContent = totalUnidades;
        badge.style.display = totalUnidades > 0 ? 'flex' : 'none';
    });

    // Renderizar items con botón de eliminar
    carrito.forEach((item, index) => {
        let li = document.createElement('li');
        li.style.position = 'relative';
        li.style.paddingRight = '35px';
        
        const precioUnitItem = parseFloat(String(item.precio).replace(/[^0-9.-]+/g, '')) || 0;
        const precioUnitFmt = '$' + Math.round(precioUnitItem).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

        const itemInfo = document.createElement('div');
        itemInfo.className = 'cart-item-info';
        // Nombre en una línea; precio unitario y cantidad debajo
        itemInfo.innerHTML = `
            <strong class="cart-item-nombre">${item.nombre}</strong>
            <span class="cart-item-meta">
                <span class="cart-item-precio">${precioUnitFmt}</span>
                <span class="cart-item-cantidad">x${item.cantidad}</span>
            </span>
        `;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'cart-item-delete';
        deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
        deleteBtn.onclick = function() {
            eliminarItemCarrito(index);
        };
        
        li.appendChild(itemInfo);
        li.appendChild(deleteBtn);
        cartList.appendChild(li);
    });
}

// Muestra en el panel del carrito la entrega elegida, con la opción de cambiarla.
// En modo edición no aplica: el pedido original ya define cómo se entrega.
function pintarEntregaEnCarrito() {
    const fila = document.getElementById('cartEntrega');
    if (!fila) return;

    if (modoEdicion || carrito.length === 0 || !tipoEntrega) {
        fila.style.display = 'none';
        return;
    }

    const datos = {
        envio:  { icono: 'fa-truck', titulo: 'Envío' },
        retiro: { icono: 'fa-store', titulo: 'Retiro' }
    }[tipoEntrega];

    const icono = document.getElementById('cartEntregaIcono');
    const texto = document.getElementById('cartEntregaTexto');
    if (icono) icono.className = `fas ${datos.icono}`;
    if (texto) texto.textContent = datos.titulo;

    fila.style.display = 'flex';
}

// Función para eliminar un item individual del carrito
function eliminarItemCarrito(index) {
    const itemEliminado = carrito[index];
    
    // Buscar la tarjeta del producto en el catálogo
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        const nombreProducto = card.querySelector('h3')?.textContent;
        if (nombreProducto === itemEliminado.nombre) {
            const btnCarrito = card.querySelector('.btn-agregar-carrito');
            const quantityContainer = card.querySelector('input[type="number"]')?.parentElement;
            const cantidadInput = card.querySelector('input[type="number"]');
            
            if (btnCarrito && quantityContainer && cantidadInput) {
                // Resetear valor del input
                cantidadInput.value = '1';
                
                // Ocultar controles de cantidad
                quantityContainer.style.display = 'none';
                quantityContainer.style.opacity = '0';
                quantityContainer.style.transform = 'scale(0.8)';
                
                // Mostrar botón de carrito original
                btnCarrito.style.display = 'block';
                btnCarrito.style.opacity = '1';
                btnCarrito.style.transform = 'scale(1)';
                
                // Restaurar estilos del botón
                btnCarrito.style.background = '';
                btnCarrito.style.color = '';
                btnCarrito.style.border = '';
            }
        }
    });
    
    // Eliminar el item del carrito
    carrito.splice(index, 1);

    // Actualizar carrito y localStorage
    actualizarCarrito();
    guardarCarritoLocal();

    // En modo edición, guardar automáticamente en Firebase
    if (modoEdicion && pedidoEditId) {
        guardarCarritoEnPedido();
    }
}

// Modal de confirmación de pedido realizado
function mostrarModalPedidoConfirmado(pedidoId, email) {
    // Elimina cualquier modal previo
    let modalExistente = document.getElementById('pedido-confirmado-modal');
    if (modalExistente) {
        modalExistente.remove();
    }
    let overlay = document.createElement('div');
    overlay.id = 'pedido-confirmado-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:450px;position:relative;">
            <div class="modal-header">
                <h2 style='margin:0;'><i class="fas fa-check-circle"></i> ¡Pedido Confirmado!</h2>
                <p style='margin:8px 0 0 0;'>Tu pedido se ha procesado exitosamente</p>
            </div>
            <div class="modal-body" style="padding:30px; text-align:center;">
                <div style="background:#f0f9f0;border-radius:12px;padding:20px;margin-bottom:20px;">
                    <i class="fas fa-envelope" style="font-size:3em;color:#4CAF50;margin-bottom:15px;"></i>
                    <p style="margin:0;color:#333;line-height:1.6;">
                        Se envió una notificación a tu email con todos los detalles del pedido. 
                        Puedes verlo, modificarlo o realizar el seguimiento desde allí.
                    </p>
                </div>
                <button id="verPedidoBtnConfirmado" class="btn-primary" style="width:100%;margin:0;">
                    <i class="fas fa-eye"></i> Ver Mi Pedido
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    // Botón para ver el pedido - redirige directamente
    document.getElementById('verPedidoBtnConfirmado').onclick = function() {
        window.location.href = `pedidos.html?id=${pedidoId}&v=${PEDIDOS_VERSION}`;
    };
}

// Umbral a partir del cual el mensaje pasa a formato compacto, para que la URL
// de WhatsApp no quede tan larga que la app termine truncándola.
const WHATSAPP_MSG_MAX_CHARS = 1500;

// Arma el texto del pedido de retiro que el cliente nos envía por WhatsApp.
function construirMensajeWhatsAppRetiro() {
    const SEPARADOR = '─────────────────';

    const encabezado = ['🛒 *NUEVO PEDIDO - RETIRO*', ''];
    encabezado.push(`👤 *Cliente:* ${datosExtraCliente.nombre || 'Sin nombre'}`);
    if (datosExtraCliente.telefono) {
        encabezado.push(`📞 ${datosExtraCliente.telefono}`);
    }
    encabezado.push('', SEPARADOR, '*ARTÍCULOS*', '');

    const pie = ['', SEPARADOR];

    // Formato detallado: una línea por dato, más fácil de leer
    const detallado = [];
    carrito.forEach((item, i) => {
        detallado.push(`${i + 1}. ${item.nombre}`);
        if (item.codigo) detallado.push(`   Cód: ${item.codigo}`);
        detallado.push(`   Cantidad: ${item.cantidad}`, '');
    });
    detallado.pop(); // quitar la línea en blanco sobrante del último ítem

    const mensaje = [...encabezado, ...detallado, ...pie].join('\n');
    if (mensaje.length <= WHATSAPP_MSG_MAX_CHARS) return mensaje;

    // Formato compacto: una línea por artículo para pedidos grandes
    const compacto = carrito.map((item, i) => {
        const codigo = item.codigo ? ` (${item.codigo})` : '';
        return `${i + 1}. ${item.cantidad} x ${item.nombre}${codigo}`;
    });
    return [...encabezado, ...compacto, ...pie].join('\n');
}

// Modal final del pedido de retiro: ofrece el enlace para enviarlo por WhatsApp.
function mostrarModalPedidoWhatsApp(mensaje) {
    // Elimina cualquier modal previo
    let modalExistente = document.getElementById('pedido-whatsapp-modal');
    if (modalExistente) {
        modalExistente.remove();
    }

    const enlaceWhatsApp = `${WHATSAPP_URL}&text=${encodeURIComponent(mensaje)}`;

    let overlay = document.createElement('div');
    overlay.id = 'pedido-whatsapp-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:450px;position:relative;">
            <div class="modal-header">
                <h2 style='margin:0;'><i class="fas fa-check-circle"></i> ¡Tu pedido está listo!</h2>
                <p style='margin:8px 0 0 0;'>Solo falta que nos lo envíes</p>
            </div>
            <div class="modal-body" style="padding:30px; text-align:center;">
                <div style="background:#f0f9f0;border-radius:12px;padding:20px;margin-bottom:20px;">
                    <i class="fab fa-whatsapp" style="font-size:3em;color:#25D366;margin-bottom:15px;"></i>
                    <p style="margin:0;color:#333;line-height:1.6;">
                        Tocá el botón para enviarnos el pedido por WhatsApp.
                        Un representante te va a responder para coordinar el retiro.
                    </p>
                </div>
                <a id="enviarWhatsAppBtn" href="${enlaceWhatsApp}" target="_blank" rel="noopener"
                   class="btn-primary" style="width:100%;margin:0;box-sizing:border-box;text-decoration:none;background: linear-gradient(135deg, #25D366 0%, #1da851 100%);box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);">
                    <i class="fab fa-whatsapp"></i> Enviar por WhatsApp
                </a>
                <p style="margin:15px 0 0 0;color:#888;font-size:0.85em;line-height:1.5;">
                    Si el botón no abre WhatsApp, escribinos al<br><strong>+54 9 11 2189-1006</strong>
                </p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // El carrito se vacía recién al enviar: si cierra el modal sin hacerlo, no pierde la carga
    document.getElementById('enviarWhatsAppBtn').addEventListener('click', function() {
        limpiarCarrito(); // al quedar vacío también olvida el tipo de entrega
        datosExtraCliente = {};
        overlay.remove();
    });

    // Cerrar al hacer click fuera del modal
    overlay.onclick = function(event) {
        if (event.target === overlay) {
            overlay.remove();
        }
    };
}

function limpiarCarrito() {
    carrito = [];
    
    // Restaurar todos los controles a su estado original
    document.querySelectorAll('.card').forEach(card => {
        const btnCarrito = card.querySelector('.btn-agregar-carrito');
        const quantityContainer = card.querySelector('input[type="number"]')?.parentElement;
        const cantidadInput = card.querySelector('input[type="number"]');
        
        if (btnCarrito && quantityContainer && cantidadInput) {
            // Resetear valor del input
            cantidadInput.value = '1';
            
            // Ocultar controles de cantidad
            quantityContainer.style.display = 'none';
            quantityContainer.style.opacity = '0';
            quantityContainer.style.transform = 'scale(0.8)';
            
            // Mostrar botón de carrito original
            btnCarrito.style.display = 'block';
            btnCarrito.style.opacity = '1';
            btnCarrito.style.transform = 'scale(1)';
            
            // Restaurar estilos del botón
            btnCarrito.style.background = '';
            btnCarrito.style.color = '';
            btnCarrito.style.border = '';
        }
    });
    
    // Actualizar el carrito (esto ocultará el botón flotante automáticamente)
    actualizarCarrito();
    guardarCarritoLocal();
}

// Resumen del carrito en un solo lugar: unidades, total y descuento.
// El descuento del 10% corre solo en envíos, con total > $100.000 y 5 o más
// unidades. Lo consumen actualizarCarrito() (para pintar el panel),
// calcularTotalCarrito() (validación del monto mínimo) y el registro del último
// pedido, así la cifra que se guarda es la misma que vio el cliente en pantalla.
function calcularResumenCarrito() {
    const UMBRAL_DESCUENTO = 100000;
    const UMBRAL_UNIDADES = 5;
    const PORCENTAJE_DESCUENTO = 0.10;

    const unidades = carrito.reduce((sum, item) => sum + item.cantidad, 0);

    const totalBruto = carrito.reduce((sum, item) => {
        const precioUnit = parseFloat(String(item.precio).replace(/[^0-9.-]+/g, '')) || 0;
        return sum + precioUnit * item.cantidad;
    }, 0);

    const aplicaDescuento = entregaConDescuento()
        && totalBruto > UMBRAL_DESCUENTO
        && unidades >= UMBRAL_UNIDADES;
    const montoDescuento = aplicaDescuento ? totalBruto * PORCENTAJE_DESCUENTO : 0;

    return {
        unidades: unidades,
        totalBruto: totalBruto,
        aplicaDescuento: aplicaDescuento,
        montoDescuento: montoDescuento,
        totalFinal: totalBruto - montoDescuento
    };
}

// Función para calcular el total del carrito en pesos (sin descuento aplicado:
// el monto mínimo de pedido se evalúa sobre el valor de lista)
function calcularTotalCarrito() {
    return calcularResumenCarrito().totalBruto;
}

// Modal de notificación de monto mínimo de pedido
function mostrarModalMontoMinimo() {
    // Elimina cualquier modal previo
    let modalExistente = document.getElementById('monto-minimo-modal');
    if (modalExistente) {
        modalExistente.remove();
    }

    let overlay = document.createElement('div');
    overlay.id = 'monto-minimo-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:450px;position:relative;">
            <div class="modal-header" style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);">
                <h2 style='margin:0;'><i class="fas fa-info-circle"></i> Monto Mínimo Requerido</h2>
                <p style='margin:8px 0 0 0;'>Para procesar tu pedido necesitamos un importe mínimo</p>
            </div>
            <div class="modal-body" style="padding:30px; text-align:center;">
                <div style="background:#fff3e0;border-radius:12px;padding:20px;margin-bottom:20px;">
                    <i class="fas fa-wallet" style="font-size:3em;color:#ff9800;margin-bottom:15px;"></i>
                    <p style="margin:0 0 12px 0;color:#333;font-size:1.05em;font-weight:600;">Compra mínima</p>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;color:#333;font-size:1em;">
                        <span>Flete</span>
                        <strong style="color:#ff9800;">$50.000</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid #ffe0b2;color:#333;font-size:1em;">
                        <span>Encomienda</span>
                        <strong style="color:#ff9800;">$90.000</strong>
                    </div>
                </div>
                <button id="cerrarMontoMinimoBtn" class="btn-primary" style="width:100%;margin:0;background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);">
                    <i class="fas fa-check"></i> Entendido
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Botón para cerrar el modal
    document.getElementById('cerrarMontoMinimoBtn').onclick = function() {
        overlay.remove();
    };

    // Cerrar al hacer click fuera del modal
    overlay.onclick = function(event) {
        if (event.target === overlay) {
            overlay.remove();
        }
    };
}

// Modal que informa los artículos quitados o ajustados por falta de stock
function mostrarModalStockAjustado(conflictos, onCerrar) {
    let modalExistente = document.getElementById('stock-ajustado-modal');
    if (modalExistente) {
        modalExistente.remove();
    }

    const filasHtml = conflictos.map(c => {
        if (c.tipo === 'sin_stock') {
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #ffe0b2;color:#333;font-size:0.95em;">
                    <span style="text-align:left;">${c.nombre}</span>
                    <strong style="color:#f44336;white-space:nowrap;">NO DISPONIBLE</strong>
                </div>`;
        }
        return `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #ffe0b2;color:#333;font-size:0.95em;">
                <span style="text-align:left;">${c.nombre}</span>
                <strong style="color:#ff9800;white-space:nowrap;">Ajustado a ${c.stockDisponible} u.</strong>
            </div>`;
    }).join('');

    let overlay = document.createElement('div');
    overlay.id = 'stock-ajustado-modal';
    overlay.className = 'modal';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content" style="max-width:450px;position:relative;">
            <div class="modal-header" style="background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);">
                <h2 style='margin:0;'><i class="fas fa-exclamation-triangle"></i> Stock actualizado</h2>
                <p style='margin:8px 0 0 0;'>Algunos artículos ya no están disponibles</p>
            </div>
            <div class="modal-body" style="padding:30px;">
                <div style="background:#fff3e0;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
                    <p style="margin:0 0 4px 0;color:#333;font-size:0.95em;line-height:1.5;">
                        Ajustamos tu carrito según el stock disponible en este momento. Revisá los cambios y volvé a confirmar tu pedido:
                    </p>
                    ${filasHtml}
                </div>
                <button id="cerrarStockAjustadoBtn" class="btn-primary" style="width:100%;margin:0;background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);">
                    <i class="fas fa-check"></i> Entendido
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const cerrar = () => {
        overlay.remove();
        if (typeof onCerrar === 'function') onCerrar();
    };

    document.getElementById('cerrarStockAjustadoBtn').onclick = cerrar;
    overlay.onclick = function(event) {
        if (event.target === overlay) cerrar();
    };
}

// Re-consulta la hoja de Google Sheets y valida el carrito contra el stock más reciente.
// Devuelve una promesa que resuelve a:
//   { estado: 'ok' }                              -> todo el carrito tiene stock suficiente
//   { estado: 'conflictos', conflictos: [...] }   -> hay ítems sin stock o con cantidad excedida
//   { estado: 'error' }                           -> falló la consulta de stock (no se debe enviar)
// Cada conflicto: { nombre, tipo: 'sin_stock' | 'ajustado', cantidadPedida, stockDisponible }
function validarStockCarrito() {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.RANGO}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
    return fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`Error al acceder a la API: ${response.statusText}`);
            return response.json();
        })
        .then(data => {
            const filas = (data.values || []).filter(item => (item[3] || '').toString().trim() !== '');

            // Mapas de stock fresco: por código (item[2]) y por nombre (item[3]) como respaldo
            const stockPorCodigo = new Map();
            const stockPorNombre = new Map();
            filas.forEach(item => {
                const stock = getStockDe(item);
                const codigo = (item[2] || '').toString().trim();
                const nombre = (item[3] || '').toString().trim();
                if (codigo) stockPorCodigo.set(codigo, stock);
                if (nombre) stockPorNombre.set(nombre, stock);
            });

            const conflictos = [];
            carrito.forEach(cartItem => {
                const codigo = (cartItem.codigo || '').toString().trim();
                let stockDisponible;
                if (codigo && stockPorCodigo.has(codigo)) {
                    stockDisponible = stockPorCodigo.get(codigo);
                } else if (stockPorNombre.has(cartItem.nombre)) {
                    stockDisponible = stockPorNombre.get(cartItem.nombre);
                } else {
                    // El artículo ya no figura en la hoja: tratarlo como sin stock
                    stockDisponible = 0;
                }

                if (stockDisponible <= 0) {
                    conflictos.push({
                        nombre: cartItem.nombre,
                        tipo: 'sin_stock',
                        cantidadPedida: cartItem.cantidad,
                        stockDisponible: 0
                    });
                } else if (cartItem.cantidad > stockDisponible) {
                    conflictos.push({
                        nombre: cartItem.nombre,
                        tipo: 'ajustado',
                        cantidadPedida: cartItem.cantidad,
                        stockDisponible: stockDisponible
                    });
                }
            });

            return conflictos.length === 0
                ? { estado: 'ok' }
                : { estado: 'conflictos', conflictos };
        })
        .catch(error => {
            console.error('Error al validar el stock del carrito:', error);
            return { estado: 'error' };
        });
}

// Aplica al carrito los ajustes detectados por validarStockCarrito:
// elimina los ítems sin stock y clampa las cantidades excedidas.
function aplicarAjustesStock(conflictos) {
    conflictos.forEach(c => {
        if (c.tipo === 'sin_stock') {
            const idx = carrito.findIndex(it => it.nombre === c.nombre);
            if (idx !== -1) carrito.splice(idx, 1);
        } else if (c.tipo === 'ajustado') {
            const it = carrito.find(it => it.nombre === c.nombre);
            if (it) it.cantidad = c.stockDisponible;
        }
    });
    actualizarCarrito();
    sincronizarCardsConCarrito();
    if (modoEdicion && pedidoEditId) {
        guardarCarritoEnPedido();
    } else {
        guardarCarritoLocal();
    }
}

// Arranca el checkout con la entrega ya elegida (se pide al agregar el primer artículo).
// El flujo se bifurca en continuarConEnvio() / continuarConRetiro().
function enviarPedido() {
    if (carrito.length === 0) {
        alert('El carrito está vacío. Agrega productos antes de continuar.');
        return;
    }

    // En modo edición el pedido original ya define su entrega
    // (enviarPedidoFinal valida el stock antes de escribir en Firebase)
    if (modoEdicion) {
        enviarPedidoFinal();
        return;
    }

    // Respaldo: carritos restaurados de una sesión previa a este cambio, o modal cerrado sin elegir
    if (!tipoEntrega) {
        mostrarModalTipoEntrega(continuarCheckout);
        return;
    }

    continuarCheckout();
}

// Puerta final: revalida el stock contra la hoja justo antes de escribir en Firebase.
// Cubre tanto el pedido nuevo (tras completar el formulario) como el modo edición.
function enviarPedidoFinal() {
    if (carrito.length === 0 && !modoEdicion) {
        alert("El carrito está vacío.");
        return;
    }

    // El retiro no valida stock: el representante lo ajusta al responder por WhatsApp
    if (tipoEntrega === 'retiro') {
        _enviarPedidoFinalConfirmado();
        return;
    }

    validarStockCarrito().then(res => {
        if (res.estado === 'error') {
            alert('No pudimos verificar la disponibilidad de stock en este momento. Por favor, revisá tu conexión e intentá de nuevo.');
            return;
        }
        if (res.estado === 'conflictos') {
            aplicarAjustesStock(res.conflictos);
            mostrarModalStockAjustado(res.conflictos);
            return;
        }
        _enviarPedidoFinalConfirmado();
    });
}

// Procesa y escribe el pedido en Firebase. Solo debe llamarse tras validar el stock.
function _enviarPedidoFinalConfirmado() {
    // Si estamos en modo edición, los items ya se guardan automáticamente.
    // Solo forzar un guardado final y redirigir.
    if (modoEdicion && pedidoEditId) {
        // Cancelar cualquier debounce pendiente y guardar inmediatamente
        if (_guardarPedidoTimer) clearTimeout(_guardarPedidoTimer);

        const nombresEnCarrito = new Set(carrito.map(c => c.nombre));
        const itemsFinales = itemsOriginalesPedido
            .filter(it => !nombresEnCarrito.has(it.nombre))
            .map(it => ({ ...it }));

        carrito.forEach(sel => {
            const existeOriginal = itemsOriginalesPedido.find(it => it.nombre === sel.nombre);
            const item = {
                nombre: sel.nombre,
                cantidad: existeOriginal
                    ? existeOriginal.cantidad + sel.cantidad
                    : sel.cantidad,
                valorUSD: sel.precio,
                codigo: sel.codigo || '',
                categoria: sel.categoria || ''
            };
            if (existeOriginal?.valorU != null) item.valorU = existeOriginal.valorU;
            if (existeOriginal?.valorC != null) item.valorC = existeOriginal.valorC;
            itemsFinales.push(item);
        });

        db.ref('pedidos/' + pedidoEditId).update({
            items: itemsFinales,
            adminViewed: false,
            lastUpdated: Date.now()
        })
        .then(() => {
            alert('¡Artículos agregados exitosamente al pedido!');
            setTimeout(() => {
                window.location.replace(`pedidos.html?id=${pedidoEditId}&v=${PEDIDOS_VERSION}`);
            }, 300);
        })
        .catch(error => {
            console.error('Error al actualizar pedido:', error);
            alert('Error al actualizar el pedido: ' + error.message);
        });
        return;
    }
    
    // Lógica para pedidos nuevos - guardar en Firebase
    if (carrito.length === 0) {
        alert("El carrito está vacío.");
        return;
    }

    // El tipo de entrega se elige al cargar el carrito; sin él no se genera el pedido
    if (!tipoEntrega) {
        alert("Elegí cómo querés recibir tu pedido antes de confirmarlo.");
        return;
    }

    // Los pedidos de retiro no se registran en Firebase: se cierran por WhatsApp
    if (tipoEntrega === 'retiro') {
        mostrarModalPedidoWhatsApp(construirMensajeWhatsAppRetiro());
        return;
    }

    // Primero verificar si el cliente ya está registrado
    const emailCliente = datosExtraCliente.email || '';
    
    db.ref('clientes').orderByChild('email').equalTo(emailCliente.toLowerCase()).limitToFirst(1).once('value')
        .then(snap => {
            // Si el cliente no existe, registrarlo
            if (!snap.exists() && emailCliente) {
                return db.ref('clientes').push({
                    email: emailCliente.toLowerCase(),
                    nombre: datosExtraCliente.nombre || '',
                    telefono: datosExtraCliente.telefono || '',
                    localidad: datosExtraCliente.localidad || '',
                    direccion: datosExtraCliente.direccion || '',
                    provincia: datosExtraCliente.provincia || '',
                    dni: String(datosExtraCliente.dni || ''),
                    tipoCliente: datosExtraCliente.tipoCliente || 'mayorista',
                    registro: 'web'
                });
            }
            // Si ya existe, no hacer nada (continuar)
            return Promise.resolve();
        })
        .then(() => {
            // Ahora crear el pedido
            const pedidoRef = db.ref('pedidos').push();
            const pedidoId = pedidoRef.key;

            const pedidoObj = {
                id: pedidoId,
                timestamp: Date.now(),
                locked: false,
                adminViewed: false,
                createdby: "web",
                status: 'ABIERTO',

                cliente: {
                    nombre: datosExtraCliente.nombre || '',
                    telefono: datosExtraCliente.telefono || '',
                    localidad: datosExtraCliente.localidad || '',
                    direccion: datosExtraCliente.direccion || '',
                    provincia: datosExtraCliente.provincia || '',
                    dni: String(datosExtraCliente.dni || ''),
                    email: datosExtraCliente.email || '',
                    tipoCliente: datosExtraCliente.tipoCliente || 'mayorista'
                },

                items: carrito.map(it => ({
                    nombre: it.nombre,
                    cantidad: it.cantidad,
                    valorUSD: it.precio,
                    codigo: it.codigo || '',
                    categoria: it.categoria || ''
                }))
            };

            return pedidoRef.set(pedidoObj).then(() => pedidoId);
        })
        .then((pedidoId) => {
            // Registrar el pedido en este navegador para el acceso rápido de la
            // barra inferior. Va antes de limpiarCarrito(): después el carrito
            // está vacío y ya no se podrían leer las unidades ni el total.
            const resumenPedido = calcularResumenCarrito();
            guardarUltimoPedidoLocal({
                id: pedidoId,
                email: datosExtraCliente.email || '',
                unidades: resumenPedido.unidades,
                total: resumenPedido.totalFinal
            });

            // Enviar email automático
            if (datosExtraCliente.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datosExtraCliente.email)) {
                emailjs.send("service_lu9cpxk", "template_xqo1j5z", {
                    email: datosExtraCliente.email,
                    name: datosExtraCliente.nombre,
                    linkPedido: `https://www.home-point.com.ar/pedidos.html?id=${pedidoId}&v=${PEDIDOS_VERSION}`
                })
                .then(function(response) {
                    console.log("Email enviado!", response.status, response.text);
                }, function(error) {
                    console.error("Error enviando email:", error);
                });
            }

            // Mostrar modal de confirmación
            mostrarModalPedidoConfirmado(pedidoId, datosExtraCliente.email);
            
            // Limpiar carrito y datos del cliente
            limpiarCarrito(); // al quedar vacío también olvida el tipo de entrega
            datosExtraCliente = {};
        })
        .catch(error => {
            console.error('Error al guardar pedido o cliente:', error);
            alert('Error al guardar el pedido: ' + error.message);
        });
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('marquee-text-1').innerHTML = MARQUEE_TEXT;
    document.getElementById('marquee-text-2').innerHTML = MARQUEE_TEXT;
    
    // Cargar el carrito guardado en localStorage
    cargarCarritoLocal();
});

// === Modo oscuro ===
// El tema del primer pintado ya lo resolvió el script inline del <head>: usa la
// elección manual guardada y, si no hay ninguna, la preferencia del sistema
// operativo. Acá sólo se sincroniza el ícono, se atiende el interruptor manual y
// se sigue al sistema en vivo mientras el usuario no haya elegido a mano.
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeToggleIcon = themeToggleBtn.querySelector('i');
const THEME_STORAGE_KEY = 'theme';
const consultaTemaSistema = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function temaGuardado() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (e) {
        console.error('Error al leer el tema desde localStorage:', e);
        return null;
    }
}

function aplicarIconoTema(tema) {
    themeToggleIcon.classList.toggle('fa-moon', tema !== 'dark');
    themeToggleIcon.classList.toggle('fa-sun', tema === 'dark');
    const etiqueta = tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    themeToggleBtn.setAttribute('aria-label', etiqueta);
    themeToggleBtn.setAttribute('title', etiqueta);
}

// El modo claro es la ausencia del atributo, no un valor propio: así los
// selectores [data-theme="dark"] del CSS siguen siendo el único interruptor.
function aplicarTema(tema) {
    if (tema === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    aplicarIconoTema(tema);
}

aplicarIconoTema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

themeToggleBtn.addEventListener('click', function() {
    const nuevoTema = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    aplicarTema(nuevoTema);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, nuevoTema);
    } catch (e) {
        console.error('Error al guardar el tema en localStorage:', e);
    }
});

// Si el usuario nunca eligió a mano, la página acompaña al sistema en tiempo
// real (Windows y Android cambian solos al anochecer, iOS y macOS igual). Una
// vez que tocó el interruptor, su elección manda y este listener no hace nada.
if (consultaTemaSistema) {
    const alCambiarTemaSistema = function(evento) {
        if (temaGuardado()) return;
        aplicarTema(evento.matches ? 'dark' : 'light');
    };

    if (typeof consultaTemaSistema.addEventListener === 'function') {
        consultaTemaSistema.addEventListener('change', alCambiarTemaSistema);
    } else if (typeof consultaTemaSistema.addListener === 'function') {
        // Safari < 14 (iOS 13 y anteriores) sólo tiene la API vieja.
        consultaTemaSistema.addListener(alCambiarTemaSistema);
    }
}

// === Menú Hamburguesa ===
const hamburgerBtn = document.getElementById('hamburgerBtn');
const hamburgerDropdown = document.getElementById('hamburgerDropdown');

// Toggle del menú hamburguesa
hamburgerBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    hamburgerDropdown.classList.toggle('active');
});

// Cerrar el menú al hacer click fuera
document.addEventListener('click', function(e) {
    if (!hamburgerBtn.contains(e.target) && !hamburgerDropdown.contains(e.target)) {
        hamburgerDropdown.classList.remove('active');
    }
});

// Cerrar el menú al hacer click en un item
document.querySelectorAll('.hamburger-dropdown-item').forEach(item => {
    item.addEventListener('click', function() {
        hamburgerDropdown.classList.remove('active');
    });
});

// === Último Pedido ===
const ultimoPedidoBtn = document.getElementById('ultimoPedidoBtn');
const ultimoPedidoModal = document.getElementById('ultimoPedidoModal');
const closeUltimoPedidoModal = document.getElementById('closeUltimoPedidoModal');
const buscarUltimoPedidoBtn = document.getElementById('buscarUltimoPedidoBtn');
const ultimoPedidoEmailInput = document.getElementById('ultimoPedidoEmailInput');
const buscarBtnText = document.getElementById('buscarBtnText');
const buscarSpinner = document.getElementById('buscarSpinner');
const ultimoPedidoMensaje = document.getElementById('ultimoPedidoMensaje');

function mostrarMensajeBusqueda(tipo, texto) {
  const mensajeDiv = ultimoPedidoMensaje;
  const iconoElement = mensajeDiv.querySelector('.fas');
  const textoElement = mensajeDiv.querySelector('span');
  
  // Configurar estilos según el tipo
  if (tipo === 'error') {
    mensajeDiv.style.backgroundColor = '#fee';
    mensajeDiv.style.borderLeft = '4px solid #e53e3e';
    mensajeDiv.style.color = '#c53030';
    iconoElement.className = 'fas fa-exclamation-circle';
  } else if (tipo === 'success') {
    mensajeDiv.style.backgroundColor = '#e6ffed';
    mensajeDiv.style.borderLeft = '4px solid #48bb78';
    mensajeDiv.style.color = '#2f855a';
    iconoElement.className = 'fas fa-check-circle';
  } else if (tipo === 'info') {
    mensajeDiv.style.backgroundColor = '#e6f7ff';
    mensajeDiv.style.borderLeft = '4px solid #4299e1';
    mensajeDiv.style.color = '#2b6cb0';
    iconoElement.className = 'fas fa-info-circle';
  }
  
  textoElement.textContent = texto;
  mensajeDiv.style.display = 'flex';
  mensajeDiv.style.alignItems = 'center';
}

function ocultarMensajeBusqueda() {
  ultimoPedidoMensaje.style.display = 'none';
}

function setEstadoCargaBusqueda(cargando) {
  buscarUltimoPedidoBtn.disabled = cargando;
  buscarUltimoPedidoBtn.style.opacity = cargando ? '0.7' : '1';
  buscarUltimoPedidoBtn.style.cursor = cargando ? 'not-allowed' : 'pointer';
  buscarBtnText.style.display = cargando ? 'none' : 'inline';
  buscarSpinner.style.display = cargando ? 'block' : 'none';
  ultimoPedidoEmailInput.disabled = cargando;
}

ultimoPedidoBtn.addEventListener('click', function() {
  ultimoPedidoModal.style.display = 'flex';
  ultimoPedidoEmailInput.value = '';
  ocultarMensajeBusqueda();
  setTimeout(() => ultimoPedidoEmailInput.focus(), 100);
});

closeUltimoPedidoModal.addEventListener('click', function() {
  ultimoPedidoModal.style.display = 'none';
  ocultarMensajeBusqueda();
});

// Cerrar modal al hacer click fuera del contenido
ultimoPedidoModal.addEventListener('mousedown', function(e) {
  if (e.target === ultimoPedidoModal) {
    ultimoPedidoModal.style.display = 'none';
    ocultarMensajeBusqueda();
  }
});

buscarUltimoPedidoBtn.addEventListener('click', function() {
  const email = ultimoPedidoEmailInput.value.trim().toLowerCase();
  ocultarMensajeBusqueda();
  
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    mostrarMensajeBusqueda('error', 'Por favor, ingresá un email válido');
    ultimoPedidoEmailInput.focus();
    return;
  }
  
  setEstadoCargaBusqueda(true);
  
  // Buscar el último pedido por email
  db.ref('pedidos').orderByChild('cliente/email').equalTo(email).once('value')
    .then(snap => {
      setEstadoCargaBusqueda(false);
      
      if (!snap.exists()) {
        mostrarMensajeBusqueda('error', 'No se encontraron pedidos registrados con este email');
        return;
      }
      
      // Buscar el pedido con mayor timestamp
      let ultimo = null;
      snap.forEach(child => {
        const pedido = child.val();
        if (!ultimo || (pedido.timestamp > ultimo.timestamp)) {
          ultimo = pedido;
        }
      });
      
      if (ultimo && ultimo.id) {
        mostrarMensajeBusqueda('success', '¡Pedido encontrado! Redirigiendo...');
        setTimeout(() => {
          window.open(`pedidos.html?id=${ultimo.id}&v=${PEDIDOS_VERSION}`, '_blank');
          ultimoPedidoModal.style.display = 'none';
          ocultarMensajeBusqueda();
          ultimoPedidoEmailInput.value = '';
        }, 800);
      } else {
        mostrarMensajeBusqueda('error', 'No se encontraron pedidos registrados con este email');
      }
    })
    .catch(() => {
      setEstadoCargaBusqueda(false);
      mostrarMensajeBusqueda('error', 'Error al buscar el pedido. Por favor, intenta de nuevo');
    });
});

// Permitir Enter para buscar
ultimoPedidoEmailInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') buscarUltimoPedidoBtn.click();
});

// Carrusel Pie de Página
document.addEventListener('DOMContentLoaded', function() {
    const carouselPieImages = document.getElementById('carousel-pie-images');
    if (carouselPieImages) {
        const slidesPie = carouselPieImages.querySelectorAll('.carousel-slide');
        let currentPieIndex = 0;

        function updateCarouselPie() {
            const offset = -currentPieIndex * 100;
            carouselPieImages.style.transform = `translateX(${offset}%)`;
        }

        if (slidesPie.length > 0) {
            setInterval(() => {
                currentPieIndex = (currentPieIndex + 1) % slidesPie.length;
                updateCarouselPie();
            }, 5000);
        }
    }
});
