/* ==========================================================================
   UBICACIONES AR · autocompletado de Localidad + Provincia
   --------------------------------------------------------------------------
   Convierte un input de localidad en un combobox accesible (patrón ARIA 1.2)
   que sólo acepta localidades reales de Argentina, y lo enlaza con el <select>
   de provincia:

   · Con provincia elegida, busca dentro de ella. Si no hay coincidencias,
     ofrece las de otras provincias (caso típico: alguien de Munro que eligió
     "Buenos Aires" en vez de "Gran Buenos Aires").
   · Sin provincia elegida, busca en todo el país; al elegir una localidad la
     provincia se completa sola.
   · Si se cambia la provincia y la localidad ya no le corresponde, se limpia.

   Uso:
   · Catálogos: se monta solo sobre #localidadInput / #provinciaInput (modal
     de cliente nuevo) y el handler de "Continuar" llama a
     UbicacionesAR.validarLocalidad().
   · Otras pantallas: var u = UbicacionesAR.montar(input, select); ...
     if (!u.validar()) return;   (pedidos.html, modal de editar cliente)

   El valor que queda en el input es siempre el nombre oficial, así que el
   código que lee input.value no cambia.

   Recursos: el listado (localidades-ar.json, ~31 KB comprimido) se descarga
   una sola vez por página, recién cuando hace falta (foco en el campo o
   precarga explícita), y lo comparten todas las instancias. Si la descarga
   falla, el campo vuelve a ser texto libre para no trabar el pedido.
   Estilos: ubicaciones-ar.css.

   Para regenerar el listado: node scripts/generar-localidades.mjs
   ========================================================================== */
(function () {
    'use strict';

    // Subir la versión al regenerar el JSON: invalida la caché del navegador.
    var URL_DATOS = 'localidades-ar.json?v=2026-11-17';
    var MAX_RESULTADOS = 60;

    /* ---------- Datos (compartidos) ---------- */

    var promesa = null;          // una sola descarga por página
    var items = null;            // [{nombre, depto, prov, n, h}]
    var porProvincia = null;     // {prov: [item]}
    var falloCarga = false;

    // Minúsculas sin tildes. Conserva el largo del texto original (cada letra
    // acentuada en NFC pasa a base + diacrítico y el diacrítico se descarta),
    // lo que permite reusar los índices para resaltar la coincidencia.
    function normalizar(s) {
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function limpiarConsulta(s) {
        return normalizar(s).replace(/\s+/g, ' ').trim();
    }

    function cargar() {
        if (promesa) return promesa;
        promesa = fetch(URL_DATOS)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (datos) {
                items = [];
                porProvincia = {};
                Object.keys(datos.p).forEach(function (prov) {
                    porProvincia[prov] = datos.p[prov].map(function (par) {
                        var i = par.indexOf('|');
                        var nombre = par.slice(0, i);
                        var depto = par.slice(i + 1);
                        var it = {
                            nombre: nombre,
                            depto: depto,
                            prov: prov,
                            n: normalizar(nombre),
                            h: normalizar(nombre + ' ' + depto)
                        };
                        items.push(it);
                        return it;
                    });
                });
                falloCarga = false;
                return items;
            })
            .catch(function (err) {
                console.warn('No se pudo cargar el listado de localidades:', err);
                falloCarga = true;
                promesa = null;          // permite reintentar en el próximo foco
                throw err;
            });
        return promesa;
    }

    /* ---------- Búsqueda ---------- */

    // Menor es mejor: igual > empieza con > alguna palabra empieza con >
    // contiene > sólo coincide por partido/departamento.
    function puntaje(it, q) {
        if (it.n === q) return 0;
        if (it.n.indexOf(q) === 0) return 1;
        if (it.n.indexOf(' ' + q) !== -1) return 2;
        if (it.n.indexOf(q) !== -1) return 3;
        return 4;
    }

    function buscarEn(lista, q) {
        if (!q) return lista.slice(0, MAX_RESULTADOS);
        var tokens = q.split(' ');
        var res = [];
        for (var i = 0; i < lista.length; i++) {
            var it = lista[i];
            var ok = true;
            for (var t = 0; t < tokens.length; t++) {
                if (it.h.indexOf(tokens[t]) === -1) { ok = false; break; }
            }
            if (ok) res.push({ it: it, p: puntaje(it, q) });
        }
        // A igual puntaje gana el nombre más corto (el más parecido a lo
        // escrito: "Rosario" antes que "Rosario del Saladillo"); después el
        // sort estable conserva el orden alfabético del JSON.
        res.sort(function (a, b) { return a.p - b.p || a.it.n.length - b.it.n.length; });
        return res.slice(0, MAX_RESULTADOS).map(function (r) { return r.it; });
    }

    /* ---------- Instancia ---------- */

    var esMovil = window.matchMedia('(max-width: 600px)');
    var contador = 0;

    function montar(input, selectProv) {
        if (!input || !selectProv) return null;
        if (input._ubicacionesAR) return input._ubicacionesAR;

        var uid = input.id || ('ubic' + (++contador));

        var seleccion = null;    // item elegido; null si el texto no es una elección válida
        var opciones = [];       // items mostrados ahora
        var activo = -1;         // índice resaltado con el teclado
        var abierto = false;

        /* ----- DOM ----- */

        var grupo = input.closest('.form-group') || input.parentNode;
        grupo.classList.add('ubic-grupo');

        var listbox = document.createElement('ul');
        listbox.id = uid + 'Listbox';
        listbox.className = 'ubic-listbox';
        listbox.setAttribute('role', 'listbox');
        listbox.setAttribute('aria-label', 'Localidades');
        listbox.hidden = true;

        var estado = document.createElement('div');   // anuncios para lector de pantalla
        estado.className = 'ubic-sr';
        estado.setAttribute('role', 'status');
        estado.setAttribute('aria-live', 'polite');

        var error = document.createElement('p');
        error.id = uid + 'Error';
        error.className = 'form-error ubic-error';
        error.setAttribute('role', 'alert');
        error.hidden = true;
        error.innerHTML = '<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span></span>';

        grupo.appendChild(listbox);
        grupo.appendChild(estado);
        grupo.appendChild(error);

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', listbox.id);
        input.setAttribute('aria-describedby', error.id);
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');

        function actualizarPlaceholder() {
            input.placeholder = selectProv.value
                ? 'Buscá tu localidad en ' + selectProv.value
                : 'Escribí tu localidad';
        }

        function mostrarError(msg) {
            error.querySelector('span').textContent = msg;
            error.hidden = false;
            input.classList.add('is-invalid');
            input.setAttribute('aria-invalid', 'true');
        }

        function ocultarError() {
            if (error.hidden) return;
            error.hidden = true;
            input.classList.remove('is-invalid');
            input.removeAttribute('aria-invalid');
        }

        /* ----- Render ----- */

        function resaltar(texto, q) {
            var frag = document.createDocumentFragment();
            var n = normalizar(texto);
            var i = q && n.length === texto.length ? n.indexOf(q) : -1;
            if (i === -1) {
                frag.appendChild(document.createTextNode(texto));
                return frag;
            }
            var mark = document.createElement('mark');
            mark.textContent = texto.slice(i, i + q.length);
            frag.appendChild(document.createTextNode(texto.slice(0, i)));
            frag.appendChild(mark);
            frag.appendChild(document.createTextNode(texto.slice(i + q.length)));
            return frag;
        }

        function filaInfo(texto, clase) {
            var li = document.createElement('li');
            li.className = 'ubic-info' + (clase ? ' ' + clase : '');
            li.setAttribute('role', 'presentation');
            li.textContent = texto;
            return li;
        }

        // Se llama después de cada render: la lista cuelga dentro del área con
        // scroll del modal y, con el campo cerca del borde inferior, quedaría
        // fuera de vista. En pantallas chicas se sube el campo arriba de todo
        // una vez al abrir (el teclado ocupa la mitad inferior); en escritorio
        // se hace el desplazamiento mínimo cada vez que la lista cambia de alto.
        function abrir() {
            var nuevo = !abierto;
            abierto = true;
            listbox.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            if (esMovil.matches) { if (nuevo) input.scrollIntoView({ block: 'start' }); }
            else listbox.scrollIntoView({ block: 'nearest' });
        }

        function cerrar() {
            if (!abierto) return;
            abierto = false;
            listbox.hidden = true;
            activo = -1;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        }

        function renderMensaje(texto) {
            listbox.textContent = '';
            opciones = [];
            activo = -1;
            listbox.appendChild(filaInfo(texto));
            abrir();
        }

        function render() {
            if (!items) return;
            var q = limpiarConsulta(input.value);
            var prov = selectProv.value;
            var propias = prov && porProvincia[prov] ? buscarEn(porProvincia[prov], q) : [];
            var otras = [];

            if (!prov) {
                if (!q) { renderMensaje('Escribí el nombre de tu localidad'); return; }
                otras = buscarEn(items, q);
            } else if (q && propias.length === 0) {
                otras = buscarEn(items, q);
            }

            listbox.textContent = '';
            opciones = [];
            activo = -1;
            input.removeAttribute('aria-activedescendant');
            var frag = document.createDocumentFragment();

            function agregar(it, mostrarProv) {
                var li = document.createElement('li');
                li.id = uid + '-op-' + opciones.length;
                li.className = 'ubic-op';
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');
                li.dataset.i = opciones.length;

                var nom = document.createElement('span');
                nom.className = 'ubic-op-nombre';
                nom.appendChild(resaltar(it.nombre, q));
                var det = document.createElement('span');
                det.className = 'ubic-op-detalle';
                det.textContent = mostrarProv ? it.depto + ' · ' + it.prov : it.depto;

                li.appendChild(nom);
                li.appendChild(det);
                frag.appendChild(li);
                opciones.push(it);
            }

            propias.forEach(function (it) { agregar(it, false); });

            if (otras.length) {
                frag.appendChild(filaInfo(
                    prov ? 'No está en ' + prov + '. ¿Es alguna de estas?' : 'Coincidencias en todo el país',
                    'ubic-encabezado'
                ));
                otras.forEach(function (it) { agregar(it, true); });
            }

            if (!opciones.length) {
                frag.appendChild(filaInfo('No encontramos “' + input.value.trim() + '”. Revisá cómo está escrito.'));
            } else if (!q && prov && porProvincia[prov].length > opciones.length) {
                frag.appendChild(filaInfo('Escribí para filtrar entre ' + porProvincia[prov].length + ' localidades'));
            }

            listbox.appendChild(frag);
            listbox.scrollTop = 0;
            abrir();

            estado.textContent = opciones.length
                ? opciones.length + (opciones.length === 1 ? ' resultado' : ' resultados')
                : 'Sin resultados';
        }

        function marcarActivo(i) {
            var prev = listbox.querySelector('.ubic-op.is-activa');
            if (prev) { prev.classList.remove('is-activa'); prev.setAttribute('aria-selected', 'false'); }
            activo = i;
            if (i < 0) { input.removeAttribute('aria-activedescendant'); return; }
            var li = document.getElementById(uid + '-op-' + i);
            if (!li) return;
            li.classList.add('is-activa');
            li.setAttribute('aria-selected', 'true');
            input.setAttribute('aria-activedescendant', li.id);
            li.scrollIntoView({ block: 'nearest' });
        }

        /* ----- Selección ----- */

        function elegir(it) {
            seleccion = it;
            input.value = it.nombre;
            ocultarError();
            if (selectProv.value !== it.prov) {
                selectProv.value = it.prov;
                selectProv.dispatchEvent(new Event('change', { bubbles: true }));
            }
            cerrar();
            estado.textContent = it.nombre + ', ' + it.prov + ' seleccionada';
        }

        // Si el texto coincide exacto con una única localidad (p. ej. lo
        // completó el autocompletado del navegador, el usuario lo escribió
        // entero sin tocar la lista, o ya venía cargado), se da por elegida.
        function resolverExacta() {
            if (!items || seleccion) return;
            var q = limpiarConsulta(input.value);
            if (!q) return;
            var prov = selectProv.value;
            var lista = prov && porProvincia[prov] ? porProvincia[prov] : items;
            var exactas = lista.filter(function (it) { return it.n === q; });
            if (exactas.length === 1) elegir(exactas[0]);
        }

        /* ----- Eventos ----- */

        input.addEventListener('focus', function () {
            if (items) { render(); return; }
            renderMensaje('Cargando localidades…');
            cargar().then(function () {
                if (document.activeElement === input) render();
                else resolverExacta();
            }, function () {
                cerrar();   // sin listado: el campo queda como texto libre
            });
        });

        input.addEventListener('blur', function () {
            cerrar();
            resolverExacta();
        });

        input.addEventListener('input', function () {
            seleccion = null;
            ocultarError();
            if (items) render();
        });

        input.addEventListener('keydown', function (e) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (!abierto) { render(); return; }
                    if (opciones.length) marcarActivo(activo < opciones.length - 1 ? activo + 1 : 0);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (abierto && opciones.length) marcarActivo(activo > 0 ? activo - 1 : opciones.length - 1);
                    break;
                case 'Enter':
                    if (abierto && opciones.length) {
                        e.preventDefault();
                        elegir(opciones[activo >= 0 ? activo : 0]);
                    }
                    break;
                case 'Escape':
                    // stopPropagation: con la lista abierta, Escape sólo la
                    // cierra. Sin esto llega a los handlers de document que
                    // cierran el modal entero.
                    if (abierto) { e.preventDefault(); e.stopPropagation(); cerrar(); }
                    break;
                case 'Tab':
                    if (abierto && activo >= 0) elegir(opciones[activo]);
                    break;
            }
        });

        // mousedown con preventDefault evita que el input pierda el foco (y
        // cierre la lista) antes del click. No se usa pointerdown: bloquearía
        // el scroll táctil de la lista.
        listbox.addEventListener('mousedown', function (e) { e.preventDefault(); });

        listbox.addEventListener('click', function (e) {
            var li = e.target.closest('.ubic-op');
            if (li) elegir(opciones[+li.dataset.i]);
        });

        listbox.addEventListener('mousemove', function (e) {
            var li = e.target.closest('.ubic-op');
            if (li && +li.dataset.i !== activo) marcarActivo(+li.dataset.i);
        });

        selectProv.addEventListener('change', function () {
            actualizarPlaceholder();
            if (seleccion && seleccion.prov !== selectProv.value) {
                seleccion = null;
                input.value = '';
            }
            resolverExacta();
        });

        actualizarPlaceholder();

        var instancia = {
            // true si la localidad es una elección válida del listado. Si el
            // listado no pudo cargarse se acepta el texto libre: mejor un
            // pedido con la localidad escrita a mano que uno que no se envía.
            validar: function () {
                if (falloCarga || !items) return true;
                resolverExacta();
                if (seleccion && seleccion.prov === selectProv.value) return true;
                mostrarError(input.value.trim()
                    ? 'Elegí la localidad de la lista de sugerencias.'
                    : 'Escribí y elegí la localidad.');
                input.focus();
                return false;
            },
            // Para cuando el código carga un valor en el input desde afuera
            // (p. ej. al abrir un modal de edición): olvida la elección
            // anterior y, si el listado ya está, reconoce el valor nuevo.
            sincronizar: function () {
                seleccion = null;
                ocultarError();
                actualizarPlaceholder();
                cargar().then(resolverExacta, function () {});
            }
        };
        input._ubicacionesAR = instancia;
        return instancia;
    }

    /* ---------- Instancia por defecto (modal de cliente de los catálogos) ---------- */

    var porDefecto = montar(document.getElementById('localidadInput'), document.getElementById('provinciaInput'));

    // Precarga: al elegir "Nuevo Cliente" el listado empieza a bajar mientras
    // el usuario completa nombre, email y teléfono.
    var btnNuevo = document.getElementById('btnNuevoUsuario');
    if (btnNuevo) {
        btnNuevo.addEventListener('click', function () { cargar().catch(function () {}); });
    }

    /* ---------- API pública ---------- */

    window.UbicacionesAR = {
        montar: montar,
        precargar: function () { return cargar().catch(function () {}); },
        validarLocalidad: function () { return porDefecto ? porDefecto.validar() : true; }
    };
})();
