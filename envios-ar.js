/* ==========================================================================
   ENVIOS AR · selector de tipo de entrega según la localidad del cliente
   --------------------------------------------------------------------------
   Muestra Flete + Correo Argentino + Vía Cargo + Flecha Carga, y para cada
   transportista dice si tiene sucursal (retiro en sucursal, no domicilio) en
   la localidad del cliente, la más cercana (≤ 30 km) o ninguna. Al elegir una
   transportista se elige también la sucursal concreta.

   Datos: envios/<provincia>.json, generados por scripts/generar-envios.mjs.
   Se baja sólo el archivo de la provincia del cliente, una vez por página
   (con cache:'no-cache' el navegador revalida con ETag: si el archivo no
   cambió, responde 304 sin volver a bajarlo).

   Contrato con el código de pedidos.html: los radios de transportista son
   input[name="tipoEntrega"] con los mismos value de siempre ('Motomensajeria',
   'Correo Argentino', 'Via Cargo', más 'Flecha Carga'), así que todo lo que ya
   los lee por nombre (guardado, bloqueo, fila de envío del Correo) sigue
   funcionando. Las tarjetas se dibujan una sola vez por montaje; los datos de
   cobertura sólo actualizan píldoras y estados, nunca reemplazan los radios
   (perderían los listeners que les agrega la página).

   API:
     var sel = EnviosAR.montar(contenedor, {
         provincia, localidad,                  // del cliente
         valor: { tipoEntrega, sucursalEnvio }, // lo guardado, para restaurar
         permitirLuego: false,                  // tarjeta "Lo decido después"
         alCambiar: function (valor) {},        // cada cambio de empresa o sucursal
         alCambiarUbicacion: function () {}     // muestra el link "Cambiar"
     });
     sel.valor()       → { tipoEntrega, sucursalEnvio } ('' si "Lo decido después")
     sel.validar()     → true si la elección está completa (si no, marca el error)
     sel.deshabilitar(bool)
     EnviosAR.datosParaPedido() → campos para el pedido nuevo del catálogo.

   Estilos: envios-ar.css.
   ========================================================================== */
(function () {
    'use strict';

    var BASE = 'envios/';

    var EMPRESAS = [
        { id: 'c', valor: 'Correo Argentino', nombre: 'Correo Argentino', logo: 'logo-correo.png', icono: 'fa-box' },
        { id: 'v', valor: 'Via Cargo', nombre: 'Vía Cargo', logo: 'logo-viacargo.png', icono: 'fa-boxes-packing' },
        { id: 'f', valor: 'Flecha Carga', nombre: 'Flecha Carga', logo: 'logo-flechacarga.png',
          logoOscuro: 'logo-flechacarga-oscuro.png', icono: 'fa-truck-ramp-box' }
    ];
    var FLETE = 'Motomensajeria';
    var RETIRO = 'Retiro en local';
    var LUEGO = '__luego';
    var VISIBLES = 4;            // sucursales antes del "Ver todas"
    var MUCHAS = 12;             // desde acá la lista completa trae filtro y scroll

    // Las tres provincias del AMBA se consultan juntas cuando la localidad no
    // aparece en la elegida: muchos clientes de GBA cargaron "Buenos Aires".
    var VECINAS = {
        'Buenos Aires': ['Gran Buenos Aires', 'CABA'],
        'Gran Buenos Aires': ['Buenos Aires', 'CABA'],
        'CABA': ['Gran Buenos Aires']
    };

    /* ---------- Utilidades ---------- */

    function sinTildes(s) {
        return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    }

    function slug(s) {
        return sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    // Misma normalización que scripts/generar-envios.mjs (las abreviaturas y
    // conectores vienen dentro de cada archivo, así no se desincronizan).
    function clave(s, norm) {
        return sinTildes(s).replace(/[.,;:'´`"()]/g, ' ').split(/\s+/).filter(Boolean)
            .filter(function (p) { return norm.conect.indexOf(p) === -1; })
            .map(function (p) { return norm.abrev[p] || p; })
            .join(' ');
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function textoKm(km) {
        return km < 1 ? 'a menos de 1 km' : 'a ' + String(km).replace('.', ',') + ' km';
    }

    function mismaSucursal(a, b) {
        return !!a && !!b && a.empresa === b.empresa && a.nombre === b.nombre && String(a.cp) === String(b.cp);
    }

    /* ---------- Datos ---------- */

    var cache = {};              // slug → Promise<archivo>
    var listos = {};             // slug → archivo (para render sincrónico)

    function cargarProvincia(prov) {
        var s = slug(prov);
        if (!s) return Promise.reject(new Error('Sin provincia'));
        if (!cache[s]) {
            cache[s] = fetch(BASE + s + '.json', { cache: 'no-cache' })
                .then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.json();
                })
                .then(function (d) {
                    // Normalización: abreviaturas y conectores de "¿Llega?"
                    d.norm = d.norm || { abrev: {}, conect: ['DE', 'DEL', 'EL', 'LA', 'LAS', 'LOS'] };
                    listos[s] = d;
                    return d;
                })
                .catch(function (err) { delete cache[s]; throw err; });
        }
        return cache[s];
    }

    function sucursal(d, e, i, km) {
        var s = d.suc[e.id][i];
        var o = { empresa: e.valor, nombre: s[0], direccion: s[1], cp: s[2], horario: s[3], telefono: s[4],
                  mapa: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s[5]) };
        if (km != null) o.km = km;
        return o;
    }

    // Busca la localidad en un archivo: exacta; si no, una única clave que la
    // contenga o esté contenida (texto libre de pedidos viejos: "San Bernardo"
    // → "Mar de Ajó - San Bernardo").
    function filaDe(d, localidad) {
        var k = clave(localidad, d.norm);
        if (!k) return null;
        if (d.loc[k]) return { k: k, fila: d.loc[k] };
        var candidatas = Object.keys(d.loc).filter(function (c) {
            return (' ' + c + ' ').indexOf(' ' + k + ' ') !== -1 || (' ' + k + ' ').indexOf(' ' + c + ' ') !== -1;
        });
        return candidatas.length === 1 ? { k: candidatas[0], fila: d.loc[candidatas[0]] } : null;
    }

    function armarResultado(d, fila, provincia) {
        var res = { estado: 'ok', provincia: provincia, empresas: {} };
        EMPRESAS.forEach(function (e, n) {
            var x = fila[n];
            if (Array.isArray(x) && x.length) {
                res.empresas[e.id] = { estado: 'local', sucursales: x.map(function (i) { return sucursal(d, e, i); }) };
            } else if (x && typeof x === 'object' && x.i != null) {
                res.empresas[e.id] = { estado: 'cercana', km: x.km, sucursales: [sucursal(d, e, x.i, x.km)] };
            } else {
                res.empresas[e.id] = { estado: 'sin', sucursales: [] };
            }
        });
        return res;
    }

    // → {estado:'ok', provincia, empresas:{c,v,f}} | {estado:'desconocida'}.
    // Si ya está en memoria responde sincrónico (devuelve el objeto, no una
    // promesa) para que el re-render de pedidos.html no parpadee.
    function consultarSync(provincia, localidad) {
        var provs = [provincia].concat(VECINAS[provincia] || []);
        for (var i = 0; i < provs.length; i++) {
            var d = listos[slug(provs[i])];
            if (!d) return null;                       // falta bajar alguno
            var f = filaDe(d, localidad);
            if (f) return armarResultado(d, f.fila, provs[i]);
        }
        return { estado: 'desconocida' };
    }

    function consultar(provincia, localidad) {
        if (!provincia || !localidad) return Promise.resolve({ estado: 'desconocida' });
        var sync = consultarSync(provincia, localidad);
        if (sync) return Promise.resolve(sync);
        // Primero la provincia elegida; las vecinas sólo si no apareció.
        return cargarProvincia(provincia).then(function (d) {
            var f = filaDe(d, localidad);
            if (f) return armarResultado(d, f.fila, provincia);
            var vecinas = VECINAS[provincia] || [];
            return Promise.all(vecinas.map(function (p) { return cargarProvincia(p).catch(function () { return null; }); }))
                .then(function () { return consultarSync(provincia, localidad) || { estado: 'desconocida' }; });
        });
    }

    /* ---------- Componente ---------- */

    var contador = 0;
    var ultimoMontado = null;    // el que lee datosParaPedido()

    function montar(contenedor, op) {
        op = op || {};
        var uid = 'env' + (++contador);
        var nombreRadio = op.nombre || 'tipoEntrega';
        var guardado = op.valor || {};
        var estado = {
            tipo: guardado.tipoEntrega || '',
            sucursal: guardado.sucursalEnvio || null,
            cobertura: null,                     // resultado de consultar()
            verTodas: false,
            deshabilitado: false
        };
        var provincia = op.provincia || '';
        var localidad = op.localidad || '';

        /* ----- Estructura (una sola vez) ----- */

        function tarjetaEmpresa(e) {
            var logo = '<img src="' + e.logo + '" alt="" class="env-logo" onerror="this.remove()">';
            if (e.logoOscuro) logo += '<img src="' + e.logoOscuro + '" alt="" class="env-logo env-logo-oscuro" onerror="this.remove()">';
            return '<label class="env-op" data-empresa="' + e.id + '" data-estado="cargando">' +
                '<input type="radio" name="' + nombreRadio + '" value="' + e.valor + '">' +
                '<span class="env-op-cuerpo">' +
                    '<span class="env-op-marca"><i class="fas ' + e.icono + '" aria-hidden="true"></i>' + logo +
                    '<span class="env-op-nombre">' + e.nombre + '</span></span>' +
                    '<span class="env-pildora"><span class="env-pildora-texto">Buscando…</span></span>' +
                '</span>' +
            '</label>';
        }

        contenedor.classList.add('env');
        contenedor.innerHTML =
            '<div class="env-ubic" hidden>' +
                '<i class="fas fa-location-dot" aria-hidden="true"></i>' +
                '<span class="env-ubic-texto"></span>' +
                (op.alCambiarUbicacion ? '<button type="button" class="env-ubic-cambiar">Cambiar</button>' : '') +
            '</div>' +
            '<div class="env-aviso" hidden></div>' +
            '<div class="env-opciones" role="radiogroup" aria-label="Tipo de entrega">' +
                '<label class="env-op" hidden><input type="radio" name="' + nombreRadio + '" value="' + RETIRO + '"></label>' +
                '<label class="env-op env-op-flete" data-estado="domicilio">' +
                    '<input type="radio" name="' + nombreRadio + '" value="' + FLETE + '">' +
                    '<span class="env-op-cuerpo">' +
                        '<span class="env-op-marca"><i class="fas fa-truck-fast" aria-hidden="true"></i>' +
                        '<span class="env-op-nombre env-op-nombre-visible">Flete</span></span>' +
                        '<span class="env-pildora"><span class="env-pildora-texto">Envío a domicilio</span></span>' +
                    '</span>' +
                '</label>' +
                EMPRESAS.map(tarjetaEmpresa).join('') +
                (op.permitirLuego
                    ? '<label class="env-op env-op-luego" data-estado="luego">' +
                        '<input type="radio" name="' + nombreRadio + '" value="' + LUEGO + '">' +
                        '<span class="env-op-cuerpo">' +
                            '<span class="env-op-marca"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i>' +
                            '<span class="env-op-nombre env-op-nombre-visible">Lo decido después</span></span>' +
                            '<span class="env-pildora"><span class="env-pildora-texto">Lo elegís en tu pedido</span></span>' +
                        '</span>' +
                      '</label>'
                    : '') +
            '</div>' +
            // interior colapsa (grid 0fr→1fr); caja lleva el padding y el borde,
            // que no pueden ir en el que colapsa porque no bajarían de su alto.
            '<div class="env-panel" data-abierto="false"><div class="env-panel-interior"><div class="env-panel-caja">' +
                '<div class="env-panel-cabecera"></div>' +
                '<label class="env-filtro" hidden><i class="fas fa-magnifying-glass" aria-hidden="true"></i>' +
                    '<input type="search" placeholder="Filtrar por calle, barrio o nombre" aria-label="Filtrar sucursales"></label>' +
                '<div class="env-sucursales" role="radiogroup"></div>' +
                '<button type="button" class="env-ver-todas" hidden></button>' +
            '</div></div></div>' +
            '<p class="env-resumen" hidden></p>' +
            '<p class="env-error" role="alert" hidden><i class="fas fa-circle-exclamation" aria-hidden="true"></i><span></span></p>';

        var $ = function (sel) { return contenedor.querySelector(sel); };
        var ubic = $('.env-ubic');
        var aviso = $('.env-aviso');
        var panel = $('.env-panel');
        var cabecera = $('.env-panel-cabecera');
        var lista = $('.env-sucursales');
        var verTodas = $('.env-ver-todas');
        var filtro = $('.env-filtro');
        var filtroInput = filtro.querySelector('input');
        var resumen = $('.env-resumen');
        var error = $('.env-error');

        function empresaDe(valor) {
            for (var i = 0; i < EMPRESAS.length; i++) if (EMPRESAS[i].valor === valor) return EMPRESAS[i];
            return null;
        }

        function radiosEmpresa() {
            return contenedor.querySelectorAll('input[name="' + nombreRadio + '"]');
        }

        /* ----- Pintado de cobertura ----- */

        function pintarUbicacion() {
            if (!localidad && !provincia) { ubic.hidden = true; return; }
            var prov = estado.cobertura && estado.cobertura.provincia ? estado.cobertura.provincia : provincia;
            ubic.querySelector('.env-ubic-texto').textContent = [localidad, prov].filter(Boolean).join(', ');
            ubic.hidden = false;
        }

        function pintarAviso() {
            var c = estado.cobertura;
            var html = '';
            if (c && c.estado === 'error') {
                html = '<i class="fas fa-wifi" aria-hidden="true"></i><span>No pudimos verificar la cobertura de las sucursales. Podés elegir la transportista igual.</span>';
            } else if (c && c.estado === 'desconocida') {
                html = '<i class="fas fa-map-location-dot" aria-hidden="true"></i><span>' +
                    (localidad
                        ? 'No reconocemos la localidad “' + esc(localidad) + '”, así que no podemos mostrar las sucursales.'
                        : 'Falta la localidad del cliente para mostrar las sucursales disponibles.') +
                    (op.alCambiarUbicacion ? ' <button type="button" class="env-aviso-accion">Actualizar datos</button>' : '') +
                    '</span>';
            }
            aviso.innerHTML = html;
            aviso.hidden = !html;
        }

        function pintarTarjetas() {
            var c = estado.cobertura;
            EMPRESAS.forEach(function (e) {
                var tarjeta = contenedor.querySelector('.env-op[data-empresa="' + e.id + '"]');
                var input = tarjeta.querySelector('input');
                var texto = tarjeta.querySelector('.env-pildora-texto');
                var est, msg, titulo = '';
                if (!c) { est = 'cargando'; msg = 'Buscando…'; }
                else if (c.estado !== 'ok') { est = 'sin-datos'; msg = 'Retiro en sucursal'; }
                else {
                    // Píldora corta (una línea en la tarjeta); el detalle va
                    // en el title y en la cabecera del panel de sucursales.
                    var x = c.empresas[e.id];
                    est = x.estado;
                    if (est === 'local') {
                        msg = x.sucursales.length === 1 ? '1 sucursal' : x.sucursales.length + ' sucursales';
                        titulo = msg + ' de ' + e.nombre + ' en ' + localidad;
                    } else if (est === 'cercana') {
                        msg = textoKm(x.km).replace(/^a/, 'A');
                        titulo = 'Sin sucursal en ' + localidad + '; la más cercana está ' + textoKm(x.km);
                    } else {
                        msg = 'Sin sucursal';
                        titulo = e.nombre + ' no tiene sucursales a menos de 30 km de ' + localidad;
                    }
                }
                tarjeta.dataset.estado = est;
                texto.textContent = msg;
                tarjeta.title = titulo;
                // Sin sucursal: no se puede elegir, salvo que ya estuviera
                // guardada (pedidos viejos): ahí se respeta y se avisa.
                var bloquear = est === 'sin' && estado.tipo !== e.valor;
                input.disabled = estado.deshabilitado || bloquear;
                tarjeta.classList.toggle('is-sin-cobertura', est === 'sin');
            });
            // Flete, "Lo decido después" y el retiro oculto sólo dependen del
            // bloqueo general
            contenedor.querySelectorAll('.env-op-flete input, .env-op-luego input, .env-op[hidden] input').forEach(function (i) {
                i.disabled = estado.deshabilitado;
            });
        }

        function sucursalesDisponibles() {
            var e = empresaDe(estado.tipo);
            var c = estado.cobertura;
            if (!e || !c || c.estado !== 'ok') return null;
            return c.empresas[e.id];
        }

        function pintarPanel() {
            var e = empresaDe(estado.tipo);
            var x = sucursalesDisponibles();
            if (!e || !x || !x.sucursales.length) {
                panel.dataset.abierto = 'false';
                lista.innerHTML = '';
                verTodas.hidden = true;
                return;
            }

            if (x.estado === 'cercana') {
                cabecera.className = 'env-panel-cabecera es-cercana';
                cabecera.innerHTML = '<i class="fas fa-route" aria-hidden="true"></i><span>' + esc(e.nombre) +
                    ' no tiene sucursal en ' + esc(localidad) + '. La más cercana está ' + esc(textoKm(x.km)) + ':</span>';
            } else {
                cabecera.className = 'env-panel-cabecera';
                cabecera.innerHTML = '<span>Elegí la sucursal de ' + esc(e.nombre) + ' donde vas a retirar</span>';
            }

            // La sucursal elegida siempre queda a la vista aunque esté más
            // abajo en la lista. En ciudades grandes (Rosario: 70 del Correo)
            // la lista completa trae filtro y scroll propio.
            var todas = x.sucursales;
            var idxElegida = -1;
            todas.forEach(function (s, i) { if (mismaSucursal(s, estado.sucursal)) idxElegida = i; });
            var conFiltro = estado.verTodas && todas.length > MUCHAS;
            filtro.hidden = !conFiltro;
            panel.classList.toggle('es-larga', conFiltro);
            if (!conFiltro) filtroInput.value = '';
            var q = conFiltro ? sinTildes(filtroInput.value).trim() : '';
            var visibles = estado.verTodas || todas.length <= VISIBLES + 1 ? todas : todas.slice(0, VISIBLES);
            var coincidencias = null;
            if (q) {
                coincidencias = todas.filter(function (s) {
                    return sinTildes(s.nombre + ' ' + s.direccion + ' ' + s.cp).indexOf(q) !== -1;
                });
                visibles = coincidencias;
            }
            if (idxElegida >= 0 && visibles.indexOf(todas[idxElegida]) === -1) visibles = visibles.concat([todas[idxElegida]]);

            lista.setAttribute('aria-label', 'Sucursales de ' + e.nombre);
            lista.innerHTML = visibles.map(function (s) {
                var i = todas.indexOf(s);
                var marcada = mismaSucursal(s, estado.sucursal);
                var datos = [s.direccion || 'Dirección no publicada', s.cp ? 'CP ' + s.cp : ''].filter(Boolean).join(' · ');
                return '<label class="env-suc' + (marcada ? ' is-elegida' : '') + '">' +
                    '<input type="radio" name="' + nombreRadio + 'Sucursal" value="' + i + '"' +
                        (marcada ? ' checked' : '') + (estado.deshabilitado ? ' disabled' : '') + '>' +
                    '<span class="env-suc-marca" aria-hidden="true"></span>' +
                    '<span class="env-suc-cuerpo">' +
                        '<span class="env-suc-nombre">' + esc(s.nombre) +
                            (s.km != null ? ' <span class="env-suc-km">' + esc(textoKm(s.km)) + '</span>' : '') + '</span>' +
                        '<span class="env-suc-dato">' + esc(datos) + '</span>' +
                        (s.horario ? '<span class="env-suc-dato env-suc-horario">' + esc(s.horario) + '</span>' : '') +
                    '</span>' +
                    '<a class="env-suc-mapa" href="' + esc(s.mapa) + '" target="_blank" rel="noopener" ' +
                        'aria-label="Ver ' + esc(s.nombre) + ' en el mapa"><i class="fas fa-map-location-dot" aria-hidden="true"></i><span>Mapa</span></a>' +
                '</label>';
            }).join('');

            if (coincidencias && !coincidencias.length) {
                lista.insertAdjacentHTML('afterbegin', '<p class="env-suc-vacio">Ninguna sucursal coincide con “' + esc(filtroInput.value.trim()) + '”.</p>');
            }

            var ocultas = estado.verTodas ? 0 : todas.length - visibles.length;
            verTodas.hidden = ocultas <= 0;
            verTodas.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i> Ver ' + ocultas + ' sucursal' + (ocultas === 1 ? '' : 'es') + ' más';
            panel.dataset.abierto = 'true';
        }

        function pintarResumen() {
            var e = empresaDe(estado.tipo);
            var s = estado.sucursal;
            var html = '';
            var x = sucursalesDisponibles();
            if (e && s && s.empresa === e.valor) {
                var vigente = !x || x.sucursales.some(function (o) { return mismaSucursal(o, s); });
                html = '<i class="fas fa-' + (vigente ? 'circle-check' : 'triangle-exclamation') + '" aria-hidden="true"></i><span>' +
                    (vigente ? 'Retirás en ' : 'La sucursal guardada no corresponde a la localidad actual: ') +
                    '<strong>' + esc(e.nombre) + ' · ' + esc(s.nombre) + '</strong>' +
                    (s.direccion ? ' — ' + esc(s.direccion) : '') + '</span>';
                resumen.classList.toggle('es-alerta', !vigente);
            } else if (estado.tipo === FLETE) {
                html = '<i class="fas fa-circle-check" aria-hidden="true"></i><span>Lo enviamos por <strong>flete</strong> a la dirección del cliente.</span>';
                resumen.classList.remove('es-alerta');
            }
            resumen.innerHTML = html;
            resumen.hidden = !html;
        }

        function pintarTodo() {
            pintarUbicacion();
            pintarAviso();
            pintarTarjetas();
            pintarPanel();
            pintarResumen();
            radiosEmpresa().forEach(function (r) {
                r.checked = r.value === (estado.tipo || '') && !!estado.tipo;
            });
        }

        /* ----- Interacción ----- */

        function notificar() {
            ocultarError();
            if (typeof op.alCambiar === 'function') op.alCambiar(api.valor());
        }

        contenedor.addEventListener('change', function (ev) {
            var t = ev.target;
            if (t.name === nombreRadio) {
                estado.tipo = t.value;
                estado.verTodas = false;
                var e = empresaDe(t.value);
                var x = sucursalesDisponibles();
                if (!e) estado.sucursal = null;
                else if (!estado.sucursal || estado.sucursal.empresa !== e.valor) {
                    // Una sola opción (o la cercana): se elige sola.
                    estado.sucursal = x && x.sucursales.length === 1 ? x.sucursales[0] : null;
                }
                pintarPanel();
                pintarResumen();
                notificar();
            } else if (t.name === nombreRadio + 'Sucursal') {
                var disp = sucursalesDisponibles();
                estado.sucursal = disp ? disp.sucursales[+t.value] : null;
                lista.querySelectorAll('.env-suc').forEach(function (l) {
                    l.classList.toggle('is-elegida', l.querySelector('input').checked);
                });
                pintarResumen();
                notificar();
            }
        });

        contenedor.addEventListener('click', function (ev) {
            if (ev.target.closest('.env-ver-todas')) {
                estado.verTodas = true;
                pintarPanel();
                if (!filtro.hidden) { filtroInput.focus({ preventScroll: true }); return; }
                var primera = lista.querySelectorAll('.env-suc')[VISIBLES];
                if (primera) primera.querySelector('input').focus({ preventScroll: true });
            } else if (ev.target.closest('.env-ubic-cambiar, .env-aviso-accion')) {
                op.alCambiarUbicacion();
            } else if (ev.target.closest('.env-suc-mapa')) {
                ev.stopPropagation();   // abrir el mapa no elige la sucursal
            }
        });

        // Al filtrar, la lista se redibuja en cada tecla: sin la animación de
        // entrada, que repetida parpadea.
        filtroInput.addEventListener('input', function () {
            lista.classList.add('sin-animacion');
            pintarPanel();
        });
        // Enter en el filtro no tiene que enviar ningún formulario de la página
        filtroInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.preventDefault(); });

        function ocultarError() { error.hidden = true; }

        /* ----- Cobertura ----- */

        var consulta = 0;
        function buscarCobertura() {
            var n = ++consulta;
            var sync = provincia && localidad ? consultarSync(provincia, localidad) : { estado: 'desconocida' };
            if (sync) { estado.cobertura = sync; pintarTodo(); return; }
            estado.cobertura = null;
            pintarTodo();
            consultar(provincia, localidad).then(function (c) {
                if (n !== consulta) return;
                estado.cobertura = c;
                pintarTodo();
            }, function () {
                if (n !== consulta) return;
                estado.cobertura = { estado: 'error' };
                pintarTodo();
            });
        }

        var api = {
            valor: function () {
                if (estado.tipo === LUEGO) return { tipoEntrega: '', sucursalEnvio: null };
                var e = empresaDe(estado.tipo);
                var s = e && estado.sucursal && estado.sucursal.empresa === e.valor ? estado.sucursal : null;
                var limpio = null;
                if (s) {
                    limpio = { empresa: s.empresa, nombre: s.nombre, direccion: s.direccion || '', cp: s.cp || '',
                               horario: s.horario || '', telefono: s.telefono || '', localidad: localidad };
                    if (s.km != null) limpio.km = s.km;
                }
                return { tipoEntrega: estado.tipo || '', sucursalEnvio: limpio };
            },
            // Elegida = alguna tarjeta marcada; y si es una transportista con
            // sucursales conocidas, también la sucursal.
            completo: function () {
                if (!estado.tipo) return false;
                if (!empresaDe(estado.tipo)) return true;
                var x = sucursalesDisponibles();
                return !x || !x.sucursales.length || !!api.valor().sucursalEnvio;
            },
            validar: function () {
                if (api.completo()) return true;
                error.querySelector('span').textContent = estado.tipo
                    ? 'Elegí la sucursal donde vas a retirar el pedido.'
                    : (op.permitirLuego ? 'Elegí cómo te lo enviamos, o “Lo decido después”.' : 'Elegí un tipo de entrega.');
                error.hidden = false;
                var foco = estado.tipo ? lista.querySelector('input') : contenedor.querySelector('input[name="' + nombreRadio + '"]:not([disabled]):not([value="' + RETIRO + '"])');
                if (foco) foco.focus();
                error.scrollIntoView({ block: 'nearest' });
                return false;
            },
            deshabilitar: function (si) {
                estado.deshabilitado = !!si;
                contenedor.classList.toggle('is-bloqueado', !!si);
                pintarTarjetas();
                lista.querySelectorAll('input').forEach(function (i) { i.disabled = !!si; });
            },
            actualizarUbicacion: function (prov, loc) {
                provincia = prov || '';
                localidad = loc || '';
                buscarCobertura();
            }
        };

        // Primer pintado: radios marcados según lo guardado, cobertura async.
        buscarCobertura();
        if (op.permitirLuego) ultimoMontado = { api: api, contenedor: contenedor };
        return api;
    }

    window.EnviosAR = {
        montar: montar,
        consultar: consultar,
        precargar: function (provincia) { return cargarProvincia(provincia).catch(function () {}); },
        // Campos que el catálogo suma al pedido nuevo. Con "Lo decido
        // después" (o sin selector) no agrega nada: el pedido nace sin
        // tipoEntrega, como siempre, y se elige después en pedidos.html.
        datosParaPedido: function () {
            // Un selector que quedó oculto (p. ej. el cliente pasó a retiro en
            // local) o fuera del DOM no cuenta.
            if (!ultimoMontado || !ultimoMontado.contenedor.isConnected ||
                ultimoMontado.contenedor.closest('[hidden]')) return {};
            var v = ultimoMontado.api.valor();
            if (!v.tipoEntrega) return {};
            var r = { tipoEntrega: v.tipoEntrega, entrega: 'Envios' };
            if (v.sucursalEnvio) r.sucursalEnvio = v.sucursalEnvio;
            return r;
        }
    };
})();
