// Initialize EmailJS
emailjs.init("vcbQsbE2bgLwFAnDr");

// Constants
const WHATSAPP_URL = "https://api.whatsapp.com/send/?phone=5491121891006";
const MARQUEE_TEXT = "💲&nbsp; Los valores publicados se encuentran ligados a la cotización del dólar del día &nbsp; 🛒🛍️ &nbsp; Visita nuestro Showroom y comprá sin requisitos minimos de compra &nbsp; 🚚 &nbsp; ENVÍOS A TODO EL PAÍS";
const ITEMPESOS = "6";

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

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
            actualizarCarrito();
        }
    } catch (e) {
        console.error('Error al cargar carrito desde localStorage:', e);
        carrito = [];
    }
}

// === soporte para editar un pedido existente ===
const urlParams    = new URLSearchParams(window.location.search);
const pedidoEditId = urlParams.get('pedido');   // si viene de pedidos.html
const modoEdicion  = !!pedidoEditId;

if (modoEdicion) {
    // Limpiar el carrito guardado en localStorage al entrar en modo edición
    localStorage.removeItem('carritoMayorista');
    
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
                console.log('Datos del pedido existente cargados:', pedidoExistente);
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
        
        // Filtrar para ocultar artículos con etiqueta "No disponible"
        // y ordenar descendente por la fecha (índice 12 - columna M)
        productos = items
            .filter(item => item[4].toLowerCase() !== 'no disponible') //FILTRAR NO DISPONIBLE
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

        // Función para aplicar todos los filtros combinados
        function aplicarFiltros() {
            const categoria = document.getElementById('categorias').value;
            const query = document.getElementById('buscar').value.toLowerCase();
            const soloDisponibles = document.getElementById('filtroDisponibles').checked;
            
            let filtrados = productos;
            
            // Filtrar por categoría
            if (categoria !== "todos") {
                filtrados = filtrados.filter(item => item[0] === categoria);
            }
            
            // Filtrar por búsqueda
            if (query.trim() !== '') {
                filtrados = filtrados.filter(item => 
                    item[3].toLowerCase().includes(query) || item[2].toLowerCase().includes(query)
                );
            }
            
            // Filtrar por disponibilidad (solo disponibles y pocas unidades)
            if (soloDisponibles) {
                filtrados = filtrados.filter(item => {
                    // Extraer y validar el valor de stock
                    const stockValue = item[10];
                    if (stockValue === undefined || stockValue === null || stockValue === "") {
                        return false; // Sin stock
                    }
                    // Convertir a string y limpiar espacios antes de parsear
                    const stock = parseInt(String(stockValue).trim());
                    // Mostrar solo si tiene stock válido (mayor a 0)
                    return !isNaN(stock) && stock > 0;
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
                    window.scrollTo({
                        top: rect.top + scrollTop - 20, // 20px de margen superior opcional
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

        // 1. Imagen
        if (isValidImageUrl(item[1])) {
            let imageUrls = [];
            if (item[1].indexOf(',') !== -1) {
                imageUrls = item[1].split(',').map(url => url.trim());
            } else {
                imageUrls.push(item[1]);
            }
            const img = document.createElement('img');
            img.src = imageUrls[0];
            img.loading = 'lazy'; // Agregar lazy loading
            img.onerror = function() {
                this.src = 'no-disponible.png'; // Imagen de respaldo
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

        let stock = 0;
        if (item[10] !== undefined && item[10] !== null && item[10] !== "") {
            stock = parseInt(item[10]);
        }
        if (!isNaN(stock)) {
            if (stock <= 0) {
                stockInfo.innerHTML = `<span style="color: #ff9800;">✗ Sin stock</span>`;
            } else if (stock <= 10) {
                stockInfo.innerHTML = `<span style="color: #ffeb3b;">⚠ Pocas unidades</span>`;
            } else {
                stockInfo.innerHTML = `<span style="color: #4CAF50;">✓ Disponible</span>`;
            }
        } else {
            stockInfo.innerHTML = `<span style="color: #ff9800;">✗ Sin stock</span>`;
        }
        card.appendChild(stockInfo);

        // 5. Valor ANTES
        if (ITEMPESOS == "6") {
            const valorUSD = document.createElement('p');
            valorUSD.innerHTML = `<span style=\"font-size:0.93em;\"><strong>Antes $</strong> <s style=\"color: #e61919;\">${item[13]}</s></span>`;
            valorUSD.style.marginBottom = '5px';
            card.appendChild(valorUSD);
        }

        // 6. Valor $
        const valorPesos = document.createElement('p');
        valorPesos.innerHTML = `<strong>Ahora $</strong> ${item[ITEMPESOS]}`;
        valorPesos.style.marginTop = '2px';
        card.appendChild(valorPesos);

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
                }
                actualizarCarrito();
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
            let stockDisponibleClick = 0;
            if (item[10] !== undefined && item[10] !== null && item[10] !== "") {
                stockDisponibleClick = parseInt(item[10]);
            }
            if (isNaN(stockDisponibleClick) || stockDisponibleClick <= 0) {
                alert('Este producto no tiene stock disponible.');
                return;
            }
            // Agregar al carrito y mostrar control
            cantidadSelector.value = '1';
            actualizarArticuloEnCarrito();
            mostrarControlCantidad();
        });

        // Eventos de los botones de cantidad
        btnIncrementar.addEventListener('click', () => {
            // Consultar stock desde columna K
            let stockDisponibleClick = 0;
            if (item[10] !== undefined && item[10] !== null && item[10] !== "") {
                stockDisponibleClick = parseInt(item[10]);
            }
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
            let stockDisponibleClick = 0;
            if (item[10] !== undefined && item[10] !== null && item[10] !== "") {
                stockDisponibleClick = parseInt(item[10]);
            }
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
                let stock = 0;
                if (producto && producto[10] !== undefined && producto[10] !== null && producto[10] !== "") {
                    stock = parseInt(producto[10]);
                }
                if (!isNaN(stock)) {
                    if (stock <= 0) {
                        stockInfo.innerHTML = `<span style="color: #ff9800;">✗ Sin stock</span>`;
                    } else if (stock <= 10) {
                        stockInfo.innerHTML = `<span style="color: #ffeb3b;">⚠ Pocas unidades</span>`;
                    } else {
                        stockInfo.innerHTML = `<span style="color: #4CAF50;">✓ Disponible</span>`;
                    }
                } else {
                    stockInfo.innerHTML = `<span style="color: #ff9800;">✗ Sin stock</span>`;
                }

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

function abrirLightbox(images) {
    currentLightboxImages = images;
    currentImageIndex = 0;
    document.getElementById('lightbox-img').src = currentLightboxImages[currentImageIndex];
    document.getElementById('lightbox').style.display = 'flex';
    actualizarBotonesLightbox();
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

function actualizarCarrito() {
    const cartList = document.getElementById('cart-list');
    const cartFloatBtn = document.getElementById('cartFloatBtn');
    const cartBadge = document.getElementById('cartBadge');

    cartList.innerHTML = '';

    // Calcular total de unidades
    let totalUnidades = carrito.reduce((sum, item) => sum + item.cantidad, 0);

    if (carrito.length === 0) {
        // Ocultar botón flotante y badge si está vacío
        if (cartFloatBtn) cartFloatBtn.style.display = 'none';
        // Cerrar el carrito expandido si está abierto
        const cartContainer = document.getElementById('cartContainer');
        if (cartContainer) {
            cartContainer.classList.remove('active');
            if (typeof cartExpanded !== 'undefined') cartExpanded = false;
        }
    } else {
        // Mostrar botón flotante si hay items
        if (cartFloatBtn) cartFloatBtn.style.display = 'flex';
    }

    // Actualizar badge
    if (cartBadge) {
        cartBadge.textContent = totalUnidades;
    }

    // Renderizar items con botón de eliminar
    carrito.forEach((item, index) => {
        let li = document.createElement('li');
        li.style.position = 'relative';
        li.style.paddingRight = '35px';
        
        const itemInfo = document.createElement('div');
        itemInfo.innerHTML = `
            <strong>${item.nombre}</strong>&nbsp;<small>x${item.cantidad}</small>
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
        window.location.href = `pedidos.html?id=${pedidoId}`;
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

// Función para abrir el modal de datos del cliente
function enviarPedido() {
    if (carrito.length === 0) {
        alert('El carrito está vacío. Agrega productos antes de continuar.');
        return;
    }
    
    // Si estamos en modo edición, ir directo a enviar el pedido sin pedir datos
    if (modoEdicion) {
        enviarPedidoFinal();
        return;
    }
    
    const clienteModal = document.getElementById('clienteModal');
    if (clienteModal) {
        clienteModal.style.display = 'flex';
    }
}

// Función para procesar y enviar el pedido final
function enviarPedidoFinal() {
    // Si estamos en modo edición, actualizar el pedido existente
    if (modoEdicion && pedidoEditId) {
        // Obtener el pedido actual de Firebase
        db.ref('pedidos/' + pedidoEditId).once('value')
            .then(snapshot => {
                if (!snapshot.exists()) {
                    alert('Error: No se encontró el pedido original');
                    return;
                }
                
                const pedidoExistente = snapshot.val();
                const itemsExistentes = pedidoExistente.items || [];
                
                // Agregar los nuevos items del carrito a los existentes
                const nuevosItems = [...itemsExistentes, ...carrito];
                
                // Actualizar el pedido en Firebase
                return db.ref('pedidos/' + pedidoEditId).update({
                    items: nuevosItems,
                    lastUpdated: Date.now()
                });
            })
            .then(() => {
                // Redirigir al pedido actualizado
                alert('¡Artículos agregados exitosamente al pedido!');
                window.location.href = `pedidos.html?id=${pedidoEditId}`;
            })
            .catch(error => {
                console.error('Error al actualizar pedido:', error);
                alert('Error al actualizar el pedido: ' + error.message);
            });
        return;
    }
    
    // Lógica original para pedidos nuevos
    const pedidoId = Date.now().toString(); // ID temporal
    const email = datosExtraCliente.email || 'sin-email@example.com';
    
    // Simular envío exitoso
    console.log('Enviando pedido:', {
        id: pedidoId,
        cliente: datosExtraCliente,
        items: carrito,
        fecha: new Date().toISOString()
    });
    
    // Mostrar modal de confirmación
    mostrarModalPedidoConfirmado(pedidoId, email);
    
    // Limpiar carrito
    limpiarCarrito();
    
    // Limpiar datos del cliente
    datosExtraCliente = {};
}

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('marquee-text-1').innerHTML = MARQUEE_TEXT;
    document.getElementById('marquee-text-2').innerHTML = MARQUEE_TEXT;
    
    // Cargar el carrito guardado en localStorage
    cargarCarritoLocal();
});

// Permitir cerrar el modal al hacer clic fuera del contenido
modal.addEventListener('mousedown', function(e) {
  if (e.target === modal) {
    modal.style.display = 'none';
  }
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
          window.open(`pedidos.html?id=${ultimo.id}`, '_blank');
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
