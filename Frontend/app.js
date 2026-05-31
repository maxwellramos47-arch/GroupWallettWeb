// app.js
document.addEventListener('DOMContentLoaded', () => {
    // --- 0. Protección de Ruta (Autenticación Front-end) ---
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
        return; 
    }
    const token = 'http-only-cookie'; // Dummy token temporal para no romper código fetch heredado

    // --- Función de Escape HTML para prevenir inyecciones XSS ---
    const escapeHTML = (str) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    };

    // --- Extraer configuración de moneda ---
    const miIdUsuarioGlobal = usuarioId.toString();
    const moneda = localStorage.getItem(`moneda_${miIdUsuarioGlobal}`) || '$';
    
    const labelMontoGasto = document.querySelector('label[for="monto-gasto"]');
    if (labelMontoGasto) labelMontoGasto.textContent = `Monto (${moneda})`;

    // --- Mostrar el nombre del usuario ---
    const nombreUsuario = localStorage.getItem('usuarioNombre');
    if (nombreUsuario) {
        document.querySelectorAll('.nav-profile').forEach(el => el.textContent = `Hola, ${nombreUsuario}`);
    }

    // --- Mostrar aviso de suscripción vencida ---
    if (localStorage.getItem('mostrarAvisoVencido') === 'true') {
        showToast('Tu suscripción Premium ha expirado. Has vuelto al Plan Básico.', 'error');
        localStorage.removeItem('mostrarAvisoVencido');
    }

    // --- 0.5. Interceptor Global de Fetch ---
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        let [resource, config] = args;
        if (!config) config = {};
        config.credentials = 'same-origin'; // Fuerza el envío de cookies HttpOnly siempre

        const response = await originalFetch(resource, config);
        
        // Si el backend responde con un 401 (Token inválido o expirado)
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            showToast('Tu sesión ha expirado por seguridad. Por favor, vuelve a iniciar sesión.', 'error');
            setTimeout(() => window.location.href = 'login.html', 2000);
            return Promise.reject(new Error('Sesión expirada')); // Detiene la ejecución del fetch local
        }
        
        return response;
    };

    // --- 0.8. Lógica de Confirmación de Pagos (Retorno desde Stripe) ---
    const urlParams = new URLSearchParams(window.location.search);
    
    // 1. Confirmación de Suscripción Premium
    if (urlParams.get('upgrade') === 'success') {
        const paymentId = urlParams.get('payment_id') || urlParams.get('preapproval_id');
        if (paymentId) {
            showSpinner();
            fetch('/api/suscripciones/confirmar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_id: paymentId })
            }).then(res => res.json()).then(data => {
                hideSpinner();
                if (data.message) {
                    showToast(data.message, 'success');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    setTimeout(() => window.location.reload(), 2000);
                } else showToast(data.error, 'error');
            }).catch(() => { hideSpinner(); showToast('Error verificando pago.', 'error'); });
        }
    } else if (urlParams.get('upgrade') === 'canceled') {
        showToast('El pago de la suscripción fue cancelado.', 'info');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Confirmación de Pago In-App de Cuotas
    if (urlParams.get('pago_cuota') === 'success') {
        const paymentId = urlParams.get('payment_id');
        const idTransaccion = urlParams.get('id_t');
        if (paymentId && idTransaccion) {
            showSpinner();
            fetch('/api/cuotas/confirmar-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payment_id: paymentId, id_transaccion: idTransaccion })
            }).then(res => res.json()).then(data => {
                hideSpinner();
                if (data.message) {
                    showToast(data.message, 'success');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    // Nota: No hace falta recargar la web. WebSockets (cuota_pagada) actualizará la tabla solo.
                } else showToast(data.error, 'error');
            }).catch(() => { hideSpinner(); showToast('Error verificando pago de cuota.', 'error'); });
        }
    } else if (urlParams.get('pago_cuota') === 'canceled') {
        showToast('El pago de la cuota fue cancelado.', 'info');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    // --- 1. Variables y Nodos del DOM ---
    const formGasto = document.getElementById('form-gasto');
    const listaGastos = document.getElementById('lista-gastos');
    const saldoTeDeben = document.querySelector('.stat.positive h4');
    const saldoDebes = document.querySelector('.stat.negative h4');
    const inputBuscarGasto = document.getElementById('buscar-gasto');

    // Detectar SO para mostrar el atajo correcto
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
    if (inputBuscarGasto) {
        inputBuscarGasto.placeholder = `Buscar por palabra o monto... (${isMac ? 'Cmd+K' : 'Ctrl+K'})`;
    }

    // Estado de la aplicación: Arreglo de transacciones
    let transacciones = [];
    let misRolesEnGrupos = {}; // Nuevo estado para guardar roles
    let premiumChartInstance = null; // Instancia global del gráfico
    let currentPage = 1; // Estado de la paginación actual
    const itemsPerPage = 10; // Límite de gastos por página

    // --- Manejo de Ordenamiento de Columnas ---
    let sortColumn = 'fecha';
    let sortAsc = false;

    document.querySelectorAll('#tabla-gastos th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (sortColumn === col) {
                sortAsc = !sortAsc;
            } else {
                sortColumn = col;
                sortAsc = true;
            }
            
            document.querySelectorAll('#tabla-gastos th.sortable').forEach(h => {
                h.textContent = h.textContent.replace(/ 🔼| 🔽| ↕️/, ' ↕️');
            });
            th.textContent = th.textContent.replace(/ ↕️| 🔼| 🔽/, sortAsc ? ' 🔼' : ' 🔽');
            
            renderizarTabla();
        });
    });

    // --- WebSockets: Sincronización en Tiempo Real ---
    if (typeof io !== 'undefined') {
        const socket = io();
        
        // Escuchar cuando alguien elimina un gasto
        socket.on('gasto_eliminado', (data) => {
            const prevLength = transacciones.length;
            // Filtramos la transacción eliminada de nuestra memoria local
            transacciones = transacciones.filter(t => t.id_transaccion != data.id_transaccion);
            
            // Si realmente teníamos ese gasto en memoria, actualizamos todo el UI
            if (transacciones.length < prevLength) {
                renderizarTabla();
                calcularSaldos();
                actualizarGraficosAnalisis();
            }
        });

        // Escuchar orden de cierre de sesión forzado (Desde Panel de Súper Admin)
        socket.on('forzar_logout', (data) => {
            const tokenActual = localStorage.getItem('usuarioToken');
            if (tokenActual) {
                const payload = JSON.parse(atob(tokenActual.split('.')[1]));
                if (payload.id_usuario == data.id_usuario) {
                    localStorage.removeItem('usuarioToken');
                    localStorage.removeItem('usuarioNombre');
                    window.location.href = 'login.html'; // Expulsado al login instantáneamente
                }
            }
        });

        // NUEVO: Escuchar cuando alguien paga una cuota
        socket.on('cuota_pagada', (data) => {
            const { id_transaccion, id_usuario, archivado } = data;
            const t = transacciones.find(tr => tr.id_transaccion == id_transaccion);

            if (t) {
                let nombrePagador = 'Un miembro';
                if (t.participantes_detalle) {
                    const p = t.participantes_detalle.find(pd => pd.id_usuario == id_usuario);
                    if (p && p.estado_pago !== 'Pagado') {
                        p.estado_pago = 'Pagado';
                        nombrePagador = p.nombre;
                    }
                }

                // Si yo soy el acreedor (al que le debían el dinero), me emociono y muestro notificación
                if (t.pagador == miIdUsuarioGlobal && id_usuario != miIdUsuarioGlobal) {
                    showToast(`🔔 ¡${nombrePagador} ha pagado su cuota de "${t.descripcion}"!`, 'success');
                    
                    try {
                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        if (AudioContext) {
                            const ctx = new AudioContext();
                            const osc = ctx.createOscillator();
                            const gainNode = ctx.createGain();
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(880, ctx.currentTime);
                            gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
                            osc.connect(gainNode);
                            gainNode.connect(ctx.destination);
                            osc.start();
                            osc.stop(ctx.currentTime + 0.15);
                        }
                    } catch (e) {} // Fallback silencioso si el navegador bloquea el audio
                }

                if (archivado) transacciones = transacciones.filter(tr => tr.id_transaccion != id_transaccion);
                
                renderizarTabla();
                calcularSaldos();
                actualizarGraficosAnalisis();
            }
        });
    }

    // --- Evento de Búsqueda ---
    if (inputBuscarGasto) {
        inputBuscarGasto.addEventListener('input', () => {
            currentPage = 1; // Volver a la página 1 al buscar
            renderizarTabla();
        });
    }

    // --- Atajo de teclado (Ctrl + K / Cmd + K) para búsqueda rápida ---
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault(); // Evita que el navegador abra su propio buscador
            if (inputBuscarGasto) {
                inputBuscarGasto.focus();
                inputBuscarGasto.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    // --- Manejo de Categorías Dinámicas ---
    const selectCategoria = document.getElementById('categoria-gasto');
    const inputNuevaCategoria = document.getElementById('nueva-categoria-gasto');
    const selectFiltroCategoria = document.getElementById('filtro-categoria');

    if (selectCategoria && inputNuevaCategoria) {
        selectCategoria.addEventListener('change', (e) => {
            if (e.target.value === 'nuevo') {
                inputNuevaCategoria.style.display = 'block';
                inputNuevaCategoria.required = true;
                inputNuevaCategoria.focus();
            } else {
                inputNuevaCategoria.style.display = 'none';
                inputNuevaCategoria.required = false;
            }
        });
    }

    if (selectFiltroCategoria) {
        selectFiltroCategoria.addEventListener('change', () => {
            currentPage = 1;
            renderizarTabla();
        });
    }

    const renderizarCategorias = () => {
        const categoriasUnicas = new Set(['Supermercado', 'Transporte', 'Restaurantes', 'Ocio', 'Servicios', 'General']);
        transacciones.forEach(t => { if (t.categoria) categoriasUnicas.add(t.categoria); });

        const poblarSelect = (select, incluyeNuevo = false) => {
            if (!select) return;
            const valActual = select.value;
            select.innerHTML = incluyeNuevo ? '<option value="" disabled selected>Selecciona una categoría</option>' : '<option value="">Todas las categorías</option>';
            categoriasUnicas.forEach(cat => select.innerHTML += `<option value="${cat}">${cat}</option>`);
            if (incluyeNuevo) select.innerHTML += `<option value="nuevo" style="font-weight: bold; color: var(--secondary-emerald);">+ Crear nueva categoría...</option>`;
            if (valActual && (categoriasUnicas.has(valActual) || (incluyeNuevo && valActual === 'nuevo'))) select.value = valActual;
        };

        poblarSelect(selectCategoria, true);
        poblarSelect(selectFiltroCategoria, false);
    };

    // --- 1.5. UX: Cálculo en vivo y Selección de Participantes ---
    const actualizarCalculoVivo = () => {
        const monto = parseFloat(document.getElementById('monto-gasto').value) || 0;
        const checkboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]:checked');
        const numParticipantes = checkboxes.length;
        const resumenEl = document.getElementById('calculo-vivo-resumen');

        if (resumenEl) {
            if (monto > 0 && numParticipantes > 0) {
                const porPersona = (monto / numParticipantes).toFixed(2);
                resumenEl.textContent = `Se dividirán ${moneda}${monto.toFixed(2)} entre ${numParticipantes} personas (${moneda}${porPersona} c/u).`;
            } else {
                resumenEl.textContent = '';
            }
        }
    };

    document.getElementById('monto-gasto')?.addEventListener('input', actualizarCalculoVivo);
    document.querySelector('.checkbox-group')?.addEventListener('change', actualizarCalculoVivo);

    document.getElementById('btn-toggle-participantes')?.addEventListener('click', (e) => {
        const checkboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        e.target.textContent = !allChecked ? 'Desmarcar Todos' : 'Marcar Todos';
        actualizarCalculoVivo();
    });

    // --- 2. Funciones de Lógica y Cálculo ---

    function showSkeletonLoader(tableBody, columns, rows = 5) {
        if (!tableBody) return;
        tableBody.innerHTML = '';
        for (let i = 0; i < rows; i++) {
            const tr = document.createElement('tr');
            tr.className = 'skeleton-row';
            let tds = '';
            for (let j = 0; j < columns; j++) {
                tds += `<td><div class="skeleton" style="width: ${Math.random() * 40 + 50}%"></div></td>`;
            }
            tr.innerHTML = tds;
            tableBody.appendChild(tr);
        }
    }

    const crearFilaCuota = (contenedor, nombreCol, idUsuarioOtro, monto, estado, idTransaccion, soyAcreedor, miIdUsuario) => {
        const tr = document.createElement('tr');
        
        let estadoHtml = estado === 'Pagado' 
            ? `<span style="color: var(--secondary-emerald); font-weight: bold;">Pagado</span>` 
            : `<span style="color: var(--danger-color); font-weight: bold;">Pendiente</span>`;

        let botonesHtml = '-';
        if (estado === 'Pendiente') {
            if (soyAcreedor) {
                botonesHtml = `<button class="btn-primary btn-pagar" data-transaccion="${idTransaccion}" data-usuario="${idUsuarioOtro}" data-monto="${monto}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-bottom: 0.3rem;">Marcar Pagado</button>`;
            } else {
                botonesHtml = `
                    <button class="btn-primary btn-pagar" data-transaccion="${idTransaccion}" data-usuario="${miIdUsuario}" data-monto="${monto}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-bottom: 0.3rem; background-color: var(--primary-slate);">Pagado (Manual)</button>
                    <button class="btn-primary btn-pago-inapp" data-transaccion="${idTransaccion}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-bottom: 0.3rem; background-color: #6772E5;">💳 Pagar Tarjeta</button>
                `;
            }
        }

        const btnBanco = `<button class="btn-ver-banco" data-usuario="${idUsuarioOtro}" title="Ver Datos Bancarios" style="margin-left: 0.5rem; padding: 0.2rem 0.4rem; font-size: 0.7rem; background-color: var(--primary-slate); color: white; border: none; border-radius: 4px; cursor: pointer;">🏦 Banco</button>`;

        tr.innerHTML = `
            <td>${escapeHTML(nombreCol)} ${btnBanco}</td>
            <td>${moneda}${monto.toFixed(2)}</td>
            <td>${estadoHtml}</td>
            <td>${botonesHtml}</td>
        `;
        contenedor.appendChild(tr);
    };

    // Función para renderizar la tabla dinámicamente
    const renderizarTabla = () => {
        listaGastos.innerHTML = ''; // Limpiamos la tabla actual
        
        const listaCuotas = document.getElementById('lista-cuotas');
        if (listaCuotas) listaCuotas.innerHTML = '';

        const selectGrupo = document.getElementById('grupo-gasto');
        const idGrupoSeleccionado = selectGrupo ? selectGrupo.value : '';
        const queryBusqueda = inputBuscarGasto ? inputBuscarGasto.value.toLowerCase() : '';
        const idCategoriaSeleccionada = selectFiltroCategoria ? selectFiltroCategoria.value : '';

        // Filtrar por el grupo seleccionado (si existe selección)
        let transaccionesFiltradas = idGrupoSeleccionado 
            ? transacciones.filter(t => t.id_grupo == idGrupoSeleccionado)
            : transacciones;
            
        // Aplicar filtro de búsqueda en tiempo real
        if (queryBusqueda) {
            transaccionesFiltradas = transaccionesFiltradas.filter(t => 
                t.descripcion.toLowerCase().includes(queryBusqueda) || 
                (t.categoria && t.categoria.toLowerCase().includes(queryBusqueda)) ||
                t.monto.toString().includes(queryBusqueda) ||
                t.pagador_nombre.toLowerCase().includes(queryBusqueda)
            );
        }
        if (idCategoriaSeleccionada) {
            transaccionesFiltradas = transaccionesFiltradas.filter(t => t.categoria === idCategoriaSeleccionada);
        }

        const miIdUsuario = usuarioId.toString();
        const miRol = misRolesEnGrupos[idGrupoSeleccionado];
        // --- 2.1. Lógica para poblar listaCuotas (Se calcula sobre TODAS las transacciones) ---
        transaccionesFiltradas.forEach(t => {
            if (listaCuotas && t.participantes_detalle) {
                const cuotaAsignada = t.monto / t.participantes.length;

                if (t.pagador === miIdUsuario) { // Si yo pagué, muestro a mis deudores
                    t.participantes_detalle.forEach(p => {
                        if (p.id_usuario !== miIdUsuario) {
                            crearFilaCuota(listaCuotas, p.nombre, p.id_usuario, cuotaAsignada, p.estado_pago, t.id_transaccion, true, miIdUsuario);
                        }
                    });
                } 
                else if (t.participantes.includes(miIdUsuario)) { // Si soy deudor, muestro a mi acreedor
                    const miDetalle = t.participantes_detalle.find(p => p.id_usuario === miIdUsuario);
                    if (miDetalle) {
                        crearFilaCuota(listaCuotas, `A ${t.pagador_nombre} (${t.descripcion})`, t.pagador, cuotaAsignada, miDetalle.estado_pago, t.id_transaccion, false, miIdUsuario);
                    }
                }
            }
        });

        if (listaCuotas && listaCuotas.innerHTML === '') {
            listaCuotas.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No hay cuotas pendientes o asociadas a ti en este grupo.</td></tr>';
        }

        // --- 2.1.5. Ordenamiento de la Tabla ---
        transaccionesFiltradas.sort((a, b) => {
            let valA = a[sortColumn];
            let valB = b[sortColumn];

            if (sortColumn === 'fecha') {
                valA = new Date(a.fecha.split('/').reverse().join('-')).getTime();
                valB = new Date(b.fecha.split('/').reverse().join('-')).getTime();
            }

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });

        // --- 2.2. Lógica para poblar listaGastos (Paginación) ---
        const totalPages = Math.ceil(transaccionesFiltradas.length / itemsPerPage);
        if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
        if (currentPage === 0 && totalPages > 0) currentPage = 1;
        
        const startIdx = (currentPage - 1) * itemsPerPage;
        const paginatedTransacciones = transaccionesFiltradas.slice(startIdx, startIdx + itemsPerPage);

        paginatedTransacciones.forEach(t => {
            const tr = document.createElement('tr');

            let botonEditarHTML = '';
            let botonEliminarHTML = '';
            if (miRol === 'Administrador' || miIdUsuario == t.pagador) {
                botonEditarHTML = `<button class="btn-editar" data-id="${t.id_transaccion}" style="background-color: var(--secondary-emerald); color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 0.3rem;">✎</button>`;
                botonEliminarHTML = `<button class="btn-eliminar" data-id="${t.id_transaccion}" style="background-color: var(--danger-color); color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-weight: bold;">X</button>`;
            }

            tr.innerHTML = `
                <td>${escapeHTML(t.fecha)}</td>
                <td><span style="background-color: var(--bg-light); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">${escapeHTML(t.categoria || 'General')}</span></td>
                <td>${escapeHTML(t.descripcion)}${t.comprobante_url ? ` <a href="#" onclick="event.preventDefault(); window.openReceiptModal('${escapeHTML(t.comprobante_url)}')" title="Ver Comprobante" style="text-decoration: none; font-size: 1.1rem; margin-left: 0.3rem;">📎</a>` : ` <button class="btn-subir-comprobante" data-id="${t.id_transaccion}" title="Subir comprobante" style="background: none; border: none; font-size: 1.1rem; margin-left: 0.3rem; cursor: pointer;">📤</button>`}</td>
                <td>${escapeHTML(t.pagador_nombre)}</td>
                <td>${moneda}${t.monto.toFixed(2)}</td>
                <td>${botonEditarHTML}${botonEliminarHTML}</td>
            `;
            listaGastos.appendChild(tr);
        });

        // --- 2.3. Renderizar botones de paginación ---
        const paginationContainer = document.getElementById('pagination-container');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
            if (totalPages > 1) {
                for (let i = 1; i <= totalPages; i++) {
                    const btn = document.createElement('button');
                    btn.textContent = i;
                    btn.className = 'btn-primary';
                    btn.style.width = 'auto';
                    btn.style.padding = '0.3rem 0.6rem';
                    if (i !== currentPage) btn.style.backgroundColor = 'var(--text-muted)';
                    btn.addEventListener('click', () => {
                        currentPage = i;
                        renderizarTabla();
                    });
                    paginationContainer.appendChild(btn);
                }
            }
        }
    };

    // Función algorítmica para calcular saldos del usuario principal ("1" - Tú)
    const calcularSaldos = () => {
        let miBalance = 0; 
        
        const selectGrupo = document.getElementById('grupo-gasto');
        const idGrupoSeleccionado = selectGrupo ? selectGrupo.value : '';

        const transaccionesFiltradas = idGrupoSeleccionado 
            ? transacciones.filter(t => t.id_grupo == idGrupoSeleccionado)
            : transacciones;

        let miIdUsuario = usuarioId || "1";

        transaccionesFiltradas.forEach(t => {
            if (t.participantes_detalle) {
                const division = t.monto / t.participantes.length;
                
                if (t.pagador == miIdUsuario) {
                    // Yo pagué. Sumar a mi balance SOLO lo que los demás me deben AÚN (Pendiente)
                    t.participantes_detalle.forEach(p => {
                        if (p.id_usuario != miIdUsuario && p.estado_pago === 'Pendiente') {
                            miBalance += division;
                        }
                    });
                } else if (t.participantes.includes(miIdUsuario)) {
                    // Otro pagó. Si yo estoy y sigo pendiente, resto a mi balance.
                    const miDetalle = t.participantes_detalle.find(p => p.id_usuario == miIdUsuario);
                    if (miDetalle && miDetalle.estado_pago === 'Pendiente') {
                        miBalance -= division;
                    }
                }
            }
        });

        // Actualizar el DOM según si el balance es a favor (positivo) o en contra (negativo)
        if (miBalance >= 0) {
            saldoTeDeben.textContent = `${moneda}${miBalance.toFixed(2)}`;
            saldoDebes.textContent = `${moneda}0.00`;
        } else {
            saldoTeDeben.textContent = `${moneda}0.00`;
            saldoDebes.textContent = `${moneda}${Math.abs(miBalance).toFixed(2)}`;
        }
    };

    // --- 2.7 Función Global para actualizar Analíticas Premium en tiempo real ---
    const actualizarGraficosAnalisis = async () => {
        try {
            const reqAnalisis = await fetch('/api/finanzas/analisis');
            if (reqAnalisis.ok) {
                const datosAnalisis = await reqAnalisis.json();
                
                const catFrecuente = document.getElementById('cat-frecuente');
                if (catFrecuente) { // Si existe en el DOM, actualizamos toda la tarjeta
                    catFrecuente.textContent = datosAnalisis.categoria_frecuente;
                    document.getElementById('ahorro-proyectado').textContent = `${moneda}${datosAnalisis.ahorro_proyectado.toFixed(2)}`;
                    document.getElementById('gasto-mayor').textContent = `${moneda}${datosAnalisis.mayor_gasto.toFixed(2)}`;
                    document.getElementById('gasto-promedio').textContent = `${moneda}${datosAnalisis.gasto_promedio.toFixed(2)}`;
                    document.getElementById('total-gastado').textContent = `${moneda}${datosAnalisis.total_gastado.toFixed(2)}`;

                    if (premiumChartInstance && datosAnalisis.distribucion_gastos) {
                        premiumChartInstance.data.labels = datosAnalisis.distribucion_gastos.etiquetas;
                        premiumChartInstance.data.datasets[0].data = datosAnalisis.distribucion_gastos.valores;
                        premiumChartInstance.update();
                    }
                }
            }
        } catch (e) { console.error('Error actualizando gráficos:', e); }
    };

    // --- 2.8. Flujo de Suscripción Premium ---
    const btnShowPayment = document.getElementById('btn-show-payment');
    if (btnShowPayment) {
        btnShowPayment.addEventListener('click', async () => {
            showSpinner();
            const token = localStorage.getItem('usuarioToken');
            try {
                const response = await fetch('/api/suscripciones/checkout', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (response.ok && data.url) {
                    window.location.href = data.url; // Redirigir a Stripe
                } else {
                    showToast(data.error || 'Error conectando a MercadoPago.', 'error');
                    hideSpinner();
                }
            } catch (error) { showToast('Problema de conexión.', 'error'); hideSpinner(); }
        });
    }

    // --- 2.9. Sistema de Referidos ---
    const cargarReferidos = async () => {
        try {
            const res = await fetch('/api/usuarios/referidos', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                const refCountEl = document.getElementById('ref-count');
                if (refCountEl) refCountEl.textContent = data.referidos_count;
                
                const refLinkEl = document.getElementById('ref-link');
                const link = `${window.location.origin}/registro.html?ref=${usuarioId}`;
                if (refLinkEl) refLinkEl.value = link;
                
                const btnCopyRef = document.getElementById('btn-copy-ref');
                if (btnCopyRef) {
                    btnCopyRef.addEventListener('click', async () => {
                        await navigator.clipboard.writeText(link);
                        const origText = btnCopyRef.textContent;
                        btnCopyRef.textContent = '¡Copiado!';
                        setTimeout(() => btnCopyRef.textContent = origText, 2000);
                    });
                }
            }
        } catch (e) { console.error('Error cargando referidos:', e); }
    };

    // --- 2.9.5. Sistema de Gamificación (Cargar Logros) ---
    const cargarLogros = async () => {
        try {
            const res = await fetch('/api/usuarios/perfil', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const perfil = await res.json();
                const contenedor = document.getElementById('lista-logros');
                if (contenedor && perfil.logros) {
                    contenedor.innerHTML = '';
                    if (perfil.logros.length === 0) {
                        contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">Registra tus primeros gastos para empezar a ganar medallas.</p>';
                    } else {
                        const mapaLogros = {
                            'FIRST_EXPENSE': { icon: '🌱', name: 'Rompehielo', desc: 'Registraste tu primer gasto en la plataforma.' },
                            'TEN_EXPENSES': { icon: '🚀', name: 'Gastador Frecuente', desc: 'Alcanzaste 10 gastos registrados.' },
                            'FIFTY_EXPENSES': { icon: '👑', name: 'Maestro Financiero', desc: 'Tienes más de 50 gastos. ¡Eres un experto!' }
                        };
                        perfil.logros.forEach(id => {
                            const l = mapaLogros[id] || { icon: '🏅', name: 'Logro Misterioso', desc: 'Medalla secreta.' };
                            contenedor.innerHTML += `<div style="display: flex; align-items: center; gap: 0.5rem; background: var(--bg-light); padding: 0.5rem 1rem; border-radius: 50px; border: 1px solid var(--border-color); cursor: default;" title="${l.desc}"><span style="font-size: 1.5rem;">${l.icon}</span> <strong style="font-size: 0.85rem;">${l.name}</strong></div>`;
                        });
                    }
                }
            }
        } catch(e) { console.error(e); }
    };

    // --- 2.10. Onboarding Interactivo (Tour Guiado) ---
    const iniciarOnboarding = () => {
        const onboardingKey = `onboarding_completed_${usuarioId}`;
        // Solo mostrar si el usuario no tiene la marca de "completado"
        if (!localStorage.getItem(onboardingKey) && window.driver) {
            const driverObj = window.driver.js.driver({
                showProgress: true,
                doneBtnText: '¡Entendido!',
                closeBtnText: 'Saltar',
                nextBtnText: 'Siguiente',
                prevBtnText: 'Anterior',
                allowClose: false, // Evita que se cierre al hacer clic fuera
                steps: [
                    {
                        popover: {
                            title: '¡Bienvenido a GroupWallet! 🎉',
                            description: 'Vamos a dar un rápido paseo de 4 pasos para enseñarte cómo dividir gastos sin perder amigos.',
                            position: 'center'
                        }
                    },
                    {
                        element: '.main-nav a[href="grupos.html"]',
                        popover: { title: '1. Crea tu primer grupo', description: 'Todo empieza aquí. Ve a la pestaña "Mis Grupos", crea uno (Ej. "Viaje a la Playa") e invita a tus amigos.', position: 'bottom' }
                    },
                    {
                        element: '#form-gasto',
                        popover: { title: '2. Registra los gastos', description: 'Cuando alguien compre algo, regístralo aquí. Nosotros haremos la matemática difícil para saber cómo dividirlo.', position: 'right' }
                    },
                    {
                        element: '.balance-card',
                        popover: { title: '3. Revisa tus saldos', description: 'Aquí verás un resumen rápido de cuánto dinero te deben en total, o cuánto debes tú al grupo.', position: 'left' }
                    },
                    {
                        element: '#referral-banner',
                        popover: { title: '4. ¡Gana Premium Gratis! 🎁', description: 'Copia este enlace y envíaselo a 3 amigos. Si se registran, ¡obtendrás un mes de plan Premium completamente gratis!', position: 'bottom' }
                    }
                ],
                onDestroyStarted: () => {
                    if (!driverObj.hasNextStep() || confirm('¿Seguro que quieres saltar el tutorial?')) {
                        localStorage.setItem(onboardingKey, 'true');
                        driverObj.destroy();
                    }
                }
            });
            setTimeout(() => driverObj.drive(), 1000); // Dar 1 segundo para que la página termine de pintar los elementos
        }
    };

    // --- 3. Manejo de Eventos ---
    formGasto.addEventListener('submit', async (e) => {
        e.preventDefault(); // Evitar que la página se recargue

        // Capturar valores
        const descripcion = document.getElementById('desc-gasto').value;
        let categoria = selectCategoria.value === 'nuevo' ? inputNuevaCategoria.value.trim() : selectCategoria.value;
        if (!categoria) return showToast('Debes seleccionar o crear una categoría.', 'error');
        
        const monto = parseFloat(document.getElementById('monto-gasto').value);
        
        const selectPagador = document.getElementById('pagador-gasto');
        const pagador = selectPagador.value;
        const pagador_nombre = selectPagador.options[selectPagador.selectedIndex].text;

        // Capturar checkboxes seleccionados
        const checkboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]:checked');
        const participantes = Array.from(checkboxes).map(cb => cb.value);

        // Validación avanzada del monto (no negativo ni cero)
        if (isNaN(monto) || monto <= 0) {
            showToast('Por favor, ingresa un monto válido mayor a cero.', 'error');
            return;
        }

        if (participantes.length === 0) {
            showToast('Debes seleccionar al menos un participante.', 'error');
            return;
        }

        // Obtener el ID del grupo seleccionado dinámicamente desde el menú desplegable
        const id_grupo = parseInt(document.getElementById('grupo-gasto').value);

        let comprobante_url = null;
        const fileInput = document.getElementById('comprobante-gasto');

        // --- Lógica de Sincronización (Background Sync) ---
        if (!navigator.onLine) {
            if (fileInput && fileInput.files.length > 0) {
                showToast('Aviso: Los comprobantes no se pueden subir sin red. El gasto se guardará sin imagen.', 'error');
            }
            const nuevoGasto = { id_grupo, descripcion, categoria, monto, pagador, participantes, comprobante_url: null };
            const colaGastos = JSON.parse(localStorage.getItem('colaGastosOffline') || '[]');
            colaGastos.push(nuevoGasto);
            localStorage.setItem('colaGastosOffline', JSON.stringify(colaGastos));
            
            showToast('Estás offline. El gasto se ha guardado localmente y se sincronizará al reconectar.', 'info');
            formGasto.reset();
            document.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(cb => cb.checked = true);
            return;
        }

        if (fileInput && fileInput.files.length > 0) {
            comprobante_url = await window.subirArchivoDirecto(fileInput.files[0]);
        }

        // Preparar el cuerpo de la petición
        const nuevoGasto = { id_grupo, descripcion, categoria, monto, pagador, participantes, comprobante_url };

        showSpinner();
        try {
            // Enviar los datos al backend usando fetch
            const response = await fetch('/api/gastos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(nuevoGasto)
            });

            if (!response.ok) {
                throw new Error('Error en la respuesta del servidor');
            }

            const dataResp = await response.json();
            
            // 🎉 ¡Verificar si el usuario desbloqueó un logro!
            if (dataResp.nuevo_logro) {
                if (typeof confetti === 'function') confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
                showToast(`🏆 ¡Logro Desbloqueado! ${dataResp.nuevo_logro}`, 'success');
                cargarLogros(); // Refrescar las medallas en la UI
            }

            // Refetch inmediato a la DB para tener todos los datos limpios (incluyendo 'estado_pago' de los participantes)
            const resRefresh = await fetch('/api/gastos');
            if (resRefresh.ok) {
                transacciones = await resRefresh.json();
            }

            // 2. Renderizar UI
            renderizarCategorias();
            renderizarTabla();
            calcularSaldos();
            actualizarGraficosAnalisis();

            // 3. Resetear UI
            formGasto.reset();
            document.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(cb => cb.checked = true);
        } catch (error) {
            console.error('Error al registrar el gasto:', error);
            showToast('Hubo un problema al registrar el gasto. Revisa la consola para más detalles.', 'error');
        } finally {
            hideSpinner();
        }
    });

    // --- 3.5. Manejo de Eventos: Eliminar Gasto ---
    if (listaGastos) {
        listaGastos.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-eliminar')) {
                if (!navigator.onLine) {
                    showToast('Acción bloqueada: Verifica tu conexión a internet.', 'error');
                    return;
                }

                if (!confirm('¿Estás seguro de que deseas eliminar este gasto de forma permanente?')) return;

                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-id');

                showSpinner();
                try {
                    const response = await fetch(`/api/gastos/${idTransaccion}`, {
                        method: 'DELETE'
                    });

                    if (response.ok) {
                        transacciones = transacciones.filter(t => t.id_transaccion != idTransaccion);
                        renderizarTabla();
                        calcularSaldos();
                        actualizarGraficosAnalisis();
                    } else {
                        const data = await response.json();
                        showToast(data.error || 'Error al eliminar el gasto.', 'error');
                    }
                } catch (error) { console.error('Error:', error); showToast('Problema de conexión con el servidor.', 'error'); } finally { hideSpinner(); }
            }
            
            // --- Lógica para Editar Gasto ---
            if (e.target.classList.contains('btn-editar')) {
                if (!navigator.onLine) {
                    showToast('Acción bloqueada: Verifica tu conexión a internet.', 'error');
                    return;
                }

                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-id');
                const gastoActual = transacciones.find(t => t.id_transaccion == idTransaccion);
                
                if (!gastoActual) return;

                const nuevaDescripcion = prompt('Editar descripción del gasto:', gastoActual.descripcion);
                if (nuevaDescripcion === null) return; // Si cancela el prompt

                let nuevaCategoria = prompt('Editar categoría del gasto:', gastoActual.categoria || 'General');
                if (nuevaCategoria === null) return; 
                nuevaCategoria = nuevaCategoria.trim();

                const nuevoMontoStr = prompt(`Editar monto (${moneda}):`, gastoActual.monto);
                if (nuevoMontoStr === null) return;
                const nuevoMonto = parseFloat(nuevoMontoStr);

                if (!nuevaDescripcion.trim() || !nuevaCategoria || isNaN(nuevoMonto) || nuevoMonto <= 0) {
                    showToast('Datos inválidos. La descripción/categoría no pueden estar vacías y el monto debe ser mayor a 0.', 'error');
                    return;
                }

                showSpinner();
                try {
                    const response = await fetch(`/api/gastos/${idTransaccion}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ descripcion: nuevaDescripcion, categoria: nuevaCategoria, monto: nuevoMonto })
                    });

                    if (response.ok) {
                        gastoActual.descripcion = nuevaDescripcion;
                        gastoActual.categoria = nuevaCategoria;
                        gastoActual.monto = nuevoMonto;
                        renderizarCategorias();
                        renderizarTabla();
                        calcularSaldos();
                        actualizarGraficosAnalisis();
                    } else {
                        const data = await response.json();
                        showToast(data.error || 'Error al editar el gasto.', 'error');
                    }
                } catch (error) { console.error('Error:', error); showToast('Problema de conexión con el servidor.', 'error'); } finally { hideSpinner(); }
            }
        });
    }

    // --- 3.9. Cargar Historial de Pagos In-App Recibidos ---
    const cargarPagosRecibidos = async () => {
        const listaPagos = document.getElementById('lista-pagos-recibidos');
        if (!listaPagos) return;

        try {
            const response = await fetch('/api/usuarios/pagos-recibidos');
            if (response.ok) {
                const pagos = await response.json();
                listaPagos.innerHTML = '';
                
                if (pagos.length === 0) {
                    listaPagos.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No has recibido pagos in-app aún.</td></tr>';
                    return;
                }
                
                pagos.forEach(p => {
                    const tr = document.createElement('tr');
                    const fecha = new Date(p.fecha_pago).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
                    tr.innerHTML = `<td>${fecha}</td><td>${p.pagador.nombre}</td><td style="color: var(--secondary-emerald); font-weight: bold;">${moneda}${parseFloat(p.monto_original).toFixed(2)}</td>`;
                    listaPagos.appendChild(tr);
                });
            }
        } catch (error) { console.error('Error al cargar pagos recibidos:', error); }
    };

    // --- 4. Inicialización (Cargar datos del servidor) ---
    const inicializarApp = async () => {
        showSkeletonLoader(listaGastos, 6);
        try {
            const response = await fetch('/api/gastos');
            if (!response.ok) throw new Error('Error al obtener los gastos');
            
            transacciones = await response.json();
            
            renderizarCategorias();
            renderizarTabla();
            calcularSaldos();
            cargarPagosRecibidos();
            cargarReferidos();
            cargarLogros();
            
            iniciarOnboarding(); // Disparar el tour si corresponde

            // Cargar dinámicamente la lista de grupos en el <select>
            const reqGrupos = await fetch('/api/grupos');
            if (reqGrupos.ok) {
                const grupos = await reqGrupos.json();
                const selectGrupoGasto = document.getElementById('grupo-gasto');
                if (selectGrupoGasto) {
                    selectGrupoGasto.innerHTML = '<option value="" disabled selected>Selecciona un grupo</option>';
                    misRolesEnGrupos = {}; // Limpiar roles
                    grupos.forEach(g => {
                        selectGrupoGasto.innerHTML += `<option value="${g.id_grupo}">${g.nombre_grupo}</option>`;
                        misRolesEnGrupos[g.id_grupo] = g.rol; // Guardar el rol
                    });

                    // Agregar el evento para filtrar la tabla dinámicamente
                    selectGrupoGasto.addEventListener('change', async (e) => {
                        const idGrupo = e.target.value;
                        currentPage = 1; // Volver a la primera página al cambiar de grupo
                        renderizarTabla();
                        calcularSaldos();

                        showSpinner();
                        // Cargar miembros del grupo seleccionado en los inputs dinámicamente
                        try {
                            const reqMiembros = await fetch(`/api/grupos/${idGrupo}/miembros`);
                            if (reqMiembros.ok) {
                                const miembros = await reqMiembros.json();
                                const selectPagador = document.getElementById('pagador-gasto');
                                const checkboxGroup = document.querySelector('.checkbox-group');
                                
                                selectPagador.innerHTML = '<option value="" disabled selected>Selecciona un integrante</option>';
                                checkboxGroup.innerHTML = '';
                                
                                miembros.forEach(m => {
                                    selectPagador.innerHTML += `<option value="${m.id_usuario}">${m.nombre}</option>`;
                                    checkboxGroup.innerHTML += `<label><input type="checkbox" value="${m.id_usuario}" checked> ${m.nombre}</label>`;
                                });
                                
                                document.getElementById('btn-toggle-participantes').textContent = 'Desmarcar Todos';
                                actualizarCalculoVivo();
                            }
                        } catch (err) { console.error('Error al cargar miembros', err); } finally { hideSpinner(); }
                    });
                }
            }

            // Intentar cargar las analíticas Premium
            const reqAnalisis = await fetch('/api/finanzas/analisis');

            if (reqAnalisis.ok) {
                const datosAnalisis = await reqAnalisis.json();
                // Si es premium, ocultar el blur (desbloquear) y rellenar datos
                const blurOverlay = document.getElementById('blur-premium-cta');
                if (blurOverlay) blurOverlay.style.display = 'none';
                
                // Eliminar la clase que oculta/recorta la tarjeta
                const analisisContent = document.getElementById('analisis-content');
                if (analisisContent) analisisContent.classList.remove('locked-content');
                
                // Ocultar el banner superior de "Plan Básico" ya que el usuario es Premium
                const upgradeBanner = document.querySelector('.upgrade-banner');
                if (upgradeBanner) upgradeBanner.style.display = 'none';

                document.getElementById('cat-frecuente').textContent = datosAnalisis.categoria_frecuente;
                document.getElementById('ahorro-proyectado').textContent = `${moneda}${datosAnalisis.ahorro_proyectado.toFixed(2)}`;
                document.getElementById('gasto-mayor').textContent = `${moneda}${datosAnalisis.mayor_gasto.toFixed(2)}`;
                document.getElementById('gasto-promedio').textContent = `${moneda}${datosAnalisis.gasto_promedio.toFixed(2)}`;
                document.getElementById('total-gastado').textContent = `${moneda}${datosAnalisis.total_gastado.toFixed(2)}`;

                // Inicializar gráfico de Chart.js
                const chartContainer = document.getElementById('chart-container');
                const canvas = document.getElementById('premiumChart');
                
                if (chartContainer && canvas && datosAnalisis.distribucion_gastos) {
                    chartContainer.style.background = 'none'; // Quitar el fondo rayado falso
                    chartContainer.style.height = 'auto'; // Ajustar altura
                    canvas.style.display = 'block'; // Mostrar el canvas

                    if (premiumChartInstance) premiumChartInstance.destroy();

                    premiumChartInstance = new Chart(canvas, {
                        type: document.getElementById('tipo-grafico').value || 'doughnut',
                        data: {
                            labels: datosAnalisis.distribucion_gastos.etiquetas,
                            datasets: [{
                                data: datosAnalisis.distribucion_gastos.valores,
                                backgroundColor: ['#2ecc71', '#3498db', '#f1c40f', '#e74c3c'],
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { position: 'right' }
                            }
                        }
                    });

                    // Escuchar cambios en el selector de tipo de gráfico
                    const selectTipoGrafico = document.getElementById('tipo-grafico');
                    if (selectTipoGrafico) {
                        selectTipoGrafico.addEventListener('change', (e) => {
                            premiumChartInstance.config.type = e.target.value;
                            premiumChartInstance.update();
                        });
                    }
                }
            } else {
                // Si es 403 (No premium), se deja la UI borrosa por defecto para incitar a la compra.
            }
        } catch (error) {
            console.error('Error inicializando la app:', error);
        } finally {
        }
    };

    // --- 5. Configurar Notificaciones Push ---
    const configurarNotificacionesPush = async () => {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    const swRegistration = await navigator.serviceWorker.ready;
                    
                    // Obtener la llave pública del servidor
                    const resClave = await fetch('/api/usuarios/vapidPublicKey', { headers: { 'Authorization': `Bearer ${token}` } });
                    const { publicKey } = await resClave.json();
                    
                    if (!publicKey) return;
                    
                    // Convertir Base64 a Uint8Array
                    const padding = '='.repeat((4 - publicKey.length % 4) % 4);
                    const base64 = (publicKey + padding).replace(/\-/g, '+').replace(/_/g, '/');
                    const rawData = window.atob(base64);
                    const applicationServerKey = new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
                    
                    const subscription = await swRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
                    
                    // Guardar la suscripción en el backend
                    await fetch('/api/usuarios/suscripcion-push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(subscription)
                    });
                }
            } catch (error) { console.error('Error al configurar notificaciones Push:', error); }
        }
    };

    // Ejecutar la inicialización al cargar la página
    inicializarApp();
    configurarNotificacionesPush();

    // --- 6. Cierre de Sesión (Logout) ---
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/api/usuarios/logout', { method: 'POST' }); // La cookie se envía solita
            } catch (err) { console.error('Error cerrando sesión remota', err); }

            localStorage.removeItem('usuarioId'); // Eliminar el rastro de sesión local
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'login.html'; // Volver a la pantalla de Login
        });
    }

    // --- 7. Marcar Cuota como Pagada ---
    const listaCuotas = document.getElementById('lista-cuotas');
    if (listaCuotas) {
        listaCuotas.addEventListener('click', async (e) => {
            // --- Ver Datos Bancarios del Participante ---
            if (e.target.classList.contains('btn-ver-banco')) {
                const btn = e.target;
                const idUsuario = btn.getAttribute('data-usuario');

                showSpinner();
                try {
                    const res = await fetch(`/api/usuarios/${idUsuario}/banco`);
                    const datos = await res.json();
                    
                    if (res.ok) {
                        const bancoOverlay = document.createElement('div');
                        bancoOverlay.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 10005; padding: 1rem;";
                        const bancoBox = document.createElement('div');
                        bancoBox.className = "card";
                        bancoBox.style = "max-width: 350px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.3); position: relative;";
                        
                        // --- Detectar Celular y Generar Deep Link de App Bancaria ---
                        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                        let btnAbrirApp = '';
                        if (isMobile && datos.banco) {
                            let appScheme = '';
                            const bancoStr = datos.banco.toLowerCase();
                            if (bancoStr.includes('estado')) appScheme = 'bancoestado://';
                            else if (bancoStr.includes('santander')) appScheme = 'santander://';
                            else if (bancoStr.includes('chile')) appScheme = 'bancochile://';
                            else if (bancoStr.includes('mach')) appScheme = 'mach://';
                            else if (bancoStr.includes('tenpo')) appScheme = 'tenpo://';
                            else if (bancoStr.includes('mercado pago')) appScheme = 'mercadopago://';
                            
                            if (appScheme) {
                                btnAbrirApp = `<a href="${appScheme}" class="btn-primary" style="display: block; text-align: center; text-decoration: none; margin-top: 1rem; background-color: var(--primary-slate); padding: 0.6rem;">📱 Abrir App de ${datos.banco}</a>`;
                            }
                        }

                        bancoBox.innerHTML = `
                            <button id="btn-cerrar-banco" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted); line-height: 1;">&times;</button>
                            <h3 style="margin-top: 0; margin-bottom: 1rem; color: var(--primary-slate);">🏦 Datos para Transferir</h3>
                            <p style="margin: 0; font-size: 0.9rem;"><strong>Banco:</strong> ${datos.banco || 'No especificado'}</p>
                            <p style="margin: 0; font-size: 0.9rem;"><strong>Tipo:</strong> ${datos.tipo_cuenta || 'No especificado'}</p>
                            <p style="margin: 0; font-size: 0.9rem;"><strong>Correo:</strong> ${datos.correo || 'No especificado'}</p>
                            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center;">
                                <input type="text" readonly value="${datos.rut || ''}" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; background: var(--bg-light);" placeholder="RUT no registrado">
                                <button class="btn-copiar-dato btn-primary" data-valor="${datos.rut || ''}" style="width: auto; padding: 0.5rem; font-size: 0.8rem; background-color: var(--secondary-emerald);">Copiar RUT</button>
                            </div>
                            <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center;">
                                <input type="text" readonly value="${datos.numero_cuenta || ''}" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; background: var(--bg-light);" placeholder="N° Cuenta no registrado">
                                <button class="btn-copiar-dato btn-primary" data-valor="${datos.numero_cuenta || ''}" style="width: auto; padding: 0.5rem; font-size: 0.8rem; background-color: var(--secondary-emerald);">Copiar N°</button>
                            </div>
                            <button id="btn-copiar-todos-datos" class="btn-primary" style="display: block; margin-top: 1rem; width: 100%; background-color: var(--primary-slate); padding: 0.6rem;">📋 Copiar Todos los Datos</button>
                            ${btnAbrirApp}
                        `;
                        bancoOverlay.appendChild(bancoBox);
                        document.body.appendChild(bancoOverlay);

                        document.getElementById('btn-cerrar-banco').addEventListener('click', () => document.body.removeChild(bancoOverlay));
                        
                        bancoBox.querySelectorAll('.btn-copiar-dato').forEach(btnCopiar => {
                            btnCopiar.addEventListener('click', async (eCopiar) => {
                                const btn = eCopiar.target;
                                const val = btn.getAttribute('data-valor');
                                if (val) {
                                    await navigator.clipboard.writeText(val);
                                    showToast('Copiado al portapapeles', 'success');
                                    
                                    const originalText = btn.textContent;
                                    const originalBg = btn.style.backgroundColor;
                                    btn.textContent = '✔️ Copiado';
                                    btn.style.backgroundColor = '#27ae60';
                                    setTimeout(() => {
                                        btn.textContent = originalText;
                                        btn.style.backgroundColor = originalBg;
                                    }, 2000);
                                } else {
                                    showToast('El usuario no registró este dato.', 'error');
                                }
                            });
                        });
                        
                        const btnCopiarTodos = document.getElementById('btn-copiar-todos-datos');
                        if (btnCopiarTodos) {
                            btnCopiarTodos.addEventListener('click', async (e) => {
                                const btn = e.target;
                                const textoCompleto = `🏦 *Datos de Transferencia*\n*Banco:* ${datos.banco || 'No especificado'}\n*Tipo:* ${datos.tipo_cuenta || 'No especificado'}\n*RUT:* ${datos.rut || 'No especificado'}\n*N° Cuenta:* ${datos.numero_cuenta || 'No especificado'}\n*Correo:* ${datos.correo || 'No especificado'}`;
                                try {
                                    await navigator.clipboard.writeText(textoCompleto);
                                    showToast('Todos los datos copiados al portapapeles', 'success');
                                    
                                    const originalText = btn.textContent;
                                    const originalBg = btn.style.backgroundColor;
                                    btn.textContent = '✔️ ¡Copiados!';
                                    btn.style.backgroundColor = 'var(--secondary-emerald)';
                                    setTimeout(() => {
                                        btn.textContent = originalText;
                                        btn.style.backgroundColor = originalBg;
                                    }, 2000);
                                } catch (err) {
                                    showToast('Error al copiar los datos', 'error');
                                }
                            });
                        }
                    } else showToast(datos.error || 'No se encontraron datos.', 'error');
                } catch (error) { console.error(error); showToast('Error de conexión.', 'error'); } finally { hideSpinner(); }
            }

            // Verificar si el elemento clickeado es un botón de pagar
            if (e.target.classList.contains('btn-pagar')) {
                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-transaccion');
                const idUsuario = btn.getAttribute('data-usuario');
                const montoEsperado = btn.getAttribute('data-monto');

                // En lugar de pagar directamente, abrimos el modal para pedir comprobante
                const modalPago = document.getElementById('modal-pago-overlay');
                if (modalPago) {
                    document.getElementById('pago-id-transaccion').value = idTransaccion;
                    document.getElementById('pago-id-usuario').value = idUsuario;
                    document.getElementById('pago-monto-esperado').value = montoEsperado;
                    const lblMonto = document.getElementById('monto-esperado-label');
                    if(lblMonto) lblMonto.textContent = `${moneda}${parseFloat(montoEsperado).toFixed(2)}`;
                    modalPago.style.display = 'flex';
                }
            }
            
            // --- Pagar Cuota vía Stripe In-App ---
            if (e.target.classList.contains('btn-pago-inapp')) {
                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-transaccion');
                
                showSpinner();
                try {
                    const response = await fetch('/api/cuotas/checkout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id_transaccion })
                    });
                    const data = await response.json();
                    if (response.ok && data.url) window.location.href = data.url; // Redirigir a MercadoPago
                    else showToast(data.error || 'Error conectando con MercadoPago.', 'error');
                } catch (error) { showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
            }
        });
    }

    // --- 7.5. Copiar Resumen de Deudas para WhatsApp ---
    const btnCopiarResumen = document.getElementById('btn-copiar-resumen');
    if (btnCopiarResumen) {
        btnCopiarResumen.addEventListener('click', async () => {
            const listaCuotasLocal = document.getElementById('lista-cuotas');
            if (!listaCuotasLocal || listaCuotasLocal.innerText.includes('No hay cuotas pendientes')) {
                return showToast('No hay deudas para copiar en este momento.', 'error');
            }

            let textoResumen = '💸 *Resumen de Deudas - GroupWallet* 💸\n\n';
            const filas = listaCuotasLocal.querySelectorAll('tr');
            
            filas.forEach(fila => {
                const celdas = fila.querySelectorAll('td');
                if (celdas.length >= 3) {
                    const nombre = celdas[0].textContent.replace('🏦 Banco', '').trim();
                    const monto = celdas[1].textContent.trim();
                    const estado = celdas[2].textContent.trim();
                    const icono = estado === 'Pagado' ? '✅' : '❌';
                    textoResumen += `${icono} *${nombre}* - ${monto} (${estado})\n`;
                }
            });

            textoResumen += '\n_Generado desde GroupWallet_';

            try {
                await navigator.clipboard.writeText(textoResumen);
                showToast('Resumen copiado. ¡Pégalo en tu grupo de WhatsApp!', 'success');
                
                const originalText = btnCopiarResumen.innerHTML;
                btnCopiarResumen.innerHTML = '✔️ ¡Copiado!';
                setTimeout(() => {
                    btnCopiarResumen.innerHTML = originalText;
                }, 2000);
            } catch (err) { showToast('Error al copiar al portapapeles.', 'error'); }
        });
    }

    // --- 7.6. Liquidar Deudas (Algoritmo de Optimización) ---
    const btnLiquidarDeudas = document.getElementById('btn-liquidar-deudas');
    if (btnLiquidarDeudas) {
        btnLiquidarDeudas.addEventListener('click', async () => {
            const idGrupo = document.getElementById('grupo-gasto')?.value;
            if (!idGrupo) return showToast('Selecciona un grupo primero.', 'error');

            showSpinner();
            try {
                const res = await fetch(`/api/grupos/${idGrupo}/liquidar`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) {
                    if (data.length === 0) {
                        return showToast('¡Todo al día! No hay deudas que liquidar en este grupo.', 'success');
                    }
                    
                    let mensajeHtml = `<div style="text-align: left; margin-bottom: 1rem;"><p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;">Para resolver todas las deudas con la menor cantidad de transferencias posibles, sigan este plan:</p><ul style="list-style: none; padding: 0;">`;
                    
                    data.forEach(t => {
                        mensajeHtml += `<li style="background: var(--bg-light); padding: 0.8rem; border-radius: 6px; margin-bottom: 0.5rem; border: 1px solid var(--border-color);"><strong style="color: var(--danger-color);">${escapeHTML(t.deudor)}</strong> debe pagarle a <strong style="color: var(--secondary-emerald);">${escapeHTML(t.acreedor)}</strong> la suma de <strong>${moneda}${t.monto.toFixed(2)}</strong></li>`;
                    });
                    mensajeHtml += `</ul></div>`;
                    
                    // Crear un modal dinámico
                    const modalOverlay = document.createElement('div');
                    modalOverlay.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000; padding: 1rem;";
                    const modalBox = document.createElement('div');
                    modalBox.className = "card";
                    modalBox.style = "max-width: 500px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.2);";
                    modalBox.innerHTML = `
                        <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">🤝 Plan de Liquidación</h3>
                        ${mensajeHtml}
                        <button class="btn-primary" id="btn-enviar-ws-todos" style="margin-top: 1rem; background-color: #25D366;">📲 Enviar a todos por WhatsApp (Bot)</button>
                        <button class="btn-primary" id="btn-cerrar-modal" style="margin-top: 1rem;">Entendido</button>
                    `;
                    modalOverlay.appendChild(modalBox);
                    document.body.appendChild(modalOverlay);
                    
                    document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
                        document.body.removeChild(modalOverlay);
                    });

                    document.getElementById('btn-enviar-ws-todos').addEventListener('click', async (e) => {
                        const btn = e.target;
                        btn.disabled = true;
                        btn.textContent = 'Enviando...';
                        try {
                            const resWs = await fetch(`/api/grupos/${idGrupo}/liquidar/whatsapp`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ transferencias: data })
                            });
                            const resData = await resWs.json();
                            if (resWs.ok) showToast(resData.message, 'success');
                            else showToast(resData.error, 'error');
                        } catch (err) { showToast('Error al enviar WhatsApps', 'error'); } finally {
                            btn.textContent = 'Enviado';
                        }
                    });
                    
                } else showToast(data.error, 'error');
            } catch (err) { showToast('Error al calcular liquidación.', 'error'); } finally { hideSpinner(); }
        });
    }

    // --- 7.8. Lógica del Modal de Confirmación de Pago ---
    const formConfirmarPago = document.getElementById('form-confirmar-pago');
    if (formConfirmarPago) {
        formConfirmarPago.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!navigator.onLine) {
                showToast('Acción bloqueada: Verifica tu conexión a internet.', 'error');
                return;
            }

            const idTransaccion = document.getElementById('pago-id-transaccion').value;
            const idUsuario = document.getElementById('pago-id-usuario').value;
            const montoEsperado = parseFloat(document.getElementById('pago-monto-esperado').value);
            const fileInput = document.getElementById('pago-comprobante');
            
            let comprobante_url = null;
            if (fileInput && fileInput.files.length > 0) {
                comprobante_url = await window.subirArchivoDirecto(fileInput.files[0]);
                
                if (comprobante_url) {
                    showToast('Analizando comprobante con Google Vision AI...', 'info');
                    try {
                        const ocrRes = await fetch('/api/finanzas/ocr', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ imageUrl: comprobante_url })
                        });
                        if (ocrRes.ok) {
                            const dataOCR = await ocrRes.json();
                            if (dataOCR.monto && Math.abs(dataOCR.monto - montoEsperado) < 0.01) {
                                showToast(`✅ Validación exitosa. Banco: ${dataOCR.banco} | El monto coincide exactamente.`, 'success');
                            } else if (dataOCR.monto) {
                                showToast(`⚠️ El monto detectado ($${dataOCR.monto}) no coincide con la cuota esperada ($${montoEsperado}).`, 'error');
                                if (!confirm(`El comprobante indica un pago de $${dataOCR.monto}, pero se esperaban $${montoEsperado}. ¿Deseas continuar y registrar el pago de todas formas?`)) {
                                    hideSpinner();
                                    return;
                                }
                            } else {
                                showToast(`✅ Banco validado: ${dataOCR.banco}. Monto no detectado de forma clara.`, 'success');
                            }
                        } else {
                            showToast('⚠️ No pudimos leer los datos automáticamente, pero tu comprobante se subió.', 'error');
                        }
                    } catch (e) { console.error('OCR Error', e); }
                }
            }

            showSpinner();
            try {
                const response = await fetch('/api/cuotas/pagar', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_transaccion: idTransaccion, id_usuario: idUsuario, comprobante_url })
                });

                if (response.ok) {
                    const data = await response.json();
                    document.getElementById('modal-pago-overlay').style.display = 'none';
                    formConfirmarPago.reset();
                    
                    if (data.archivado) {
                        showToast('¡Gasto completado y archivado en el historial!', 'success');
                        transacciones = transacciones.filter(t => t.id_transaccion != idTransaccion);
                    } else {
                        showToast('Pago confirmado con éxito.', 'success');
                        const t = transacciones.find(tr => tr.id_transaccion == idTransaccion);
                        if (t && t.participantes_detalle) {
                            const p = t.participantes_detalle.find(pd => pd.id_usuario == idUsuario);
                            if (p) p.estado_pago = 'Pagado';
                        }

                        // Nueva lógica para notificar por WhatsApp/Email
                        const acreedor = transacciones.find(t => t.id_transaccion == idTransaccion)?.pagador_nombre;
                        if (acreedor) {
                            const notifOverlay = document.createElement('div');
                            notifOverlay.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10001; padding: 1rem;";
                            const notifBox = document.createElement('div');
                            notifBox.className = "card";
                            notifBox.style = "max-width: 400px; width: 100%;";
                            notifBox.innerHTML = `
                                <h3 style="margin-top: 0;">💬 Notificar Pago</h3>
                                <p>¿Quieres avisarle a <strong>${escapeHTML(acreedor)}</strong> que ya pagaste?</p>
                                <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
                                    <button id="btn-si-notificar-ws" class="btn-primary" style="background-color: #25D366; flex: 1;">📱 WhatsApp</button>
                                    <button id="btn-si-notificar-email" class="btn-primary" style="background-color: var(--primary-slate); flex: 1;">✉️ Correo</button>
                                </div>
                                <button id="btn-no-notificar" class="btn-primary" style="background-color: var(--text-muted); margin-top: 0.5rem;">No, gracias</button>
                            `;
                            notifOverlay.appendChild(notifBox);
                            document.body.appendChild(notifOverlay);

                            const closeNotifModal = () => document.body.removeChild(notifOverlay);
                            document.getElementById('btn-no-notificar').addEventListener('click', closeNotifModal);

                            const handleNotification = async (e, url) => {
                                const btn = e.target;
                                btn.disabled = true;
                                btn.textContent = 'Enviando...';
                                try {
                                    const resNotif = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_transaccion: idTransaccion }) });
                                    const dataNotif = await resNotif.json();
                                    if (resNotif.ok) showToast(dataNotif.message, 'success');
                                    else showToast(dataNotif.error, 'error');
                                } catch (err) { showToast('Error de red al notificar.', 'error'); } finally { closeNotifModal(); }
                            };

                            document.getElementById('btn-si-notificar-ws').addEventListener('click', (e) => handleNotification(e, '/api/cuotas/notificar-pago'));
                            document.getElementById('btn-si-notificar-email').addEventListener('click', (e) => handleNotification(e, '/api/cuotas/notificar-pago-email'));
                        }
                    }
                    
                    // Reflejar cambios visuales de inmediato
                    renderizarTabla();
                    calcularSaldos();
                    actualizarGraficosAnalisis();

                } else showToast((await response.json()).error, 'error');
            } catch (error) { showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
        });

        document.getElementById('btn-cerrar-modal-pago').addEventListener('click', () => {
            document.getElementById('modal-pago-overlay').style.display = 'none';
            formConfirmarPago.reset();
        });
    }

    // --- 8. Subida Segura de Archivos a la Nube (AWS S3) ---
    // Podrás usarla en un evento change de un input file: onchange="subirArchivoDirecto(this.files[0])"
    window.subirArchivoDirecto = async (archivo) => {
        if (!archivo) return null;
        
        showSpinner();
        try {
            let archivoFinal = archivo;
            
            // Compresión al vuelo (Solo si es imagen)
            if (archivo.type.startsWith('image/') && typeof imageCompression === 'function') {
                const options = { 
                    maxSizeMB: 0.5,          // Límite máximo de peso (500 KB)
                    maxWidthOrHeight: 1280,  // Resolución máxima (HD)
                    useWebWorker: true,      // Evita que la interfaz se congele
                    fileType: 'image/webp'   // Convertir a WebP para máximo ahorro en S3
                };
                archivoFinal = await imageCompression(archivo, options);
            }

            const token = localStorage.getItem('usuarioToken');
            
            // Paso 1: Pedir la URL firmada (Notarizada) al servidor Node.js
            const resFirma = await fetch(`/api/upload/presigned-url?type=${encodeURIComponent(archivoFinal.type)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!resFirma.ok) throw new Error('Error al obtener la firma de subida.');
            const { url, publicUrl } = await resFirma.json();
            
            // Paso 2: Subir el archivo directamente a AWS S3 (Saltándonos Node.js para ahorrar CPU/RAM)
            const resUpload = await fetch(url, {
                method: 'PUT',
                body: archivoFinal,
                headers: {
                    'Content-Type': archivoFinal.type // S3 necesita saber qué tipo de archivo recibe
                }
            });
            
            if (!resUpload.ok) throw new Error('Error al subir el archivo a la nube.');
            
            showToast('Archivo subido exitosamente.', 'success');
            return publicUrl; // Devuelve la ruta pública generada por el backend
        } catch (error) {
            console.error('Error en subida:', error);
            showToast('No se pudo subir el archivo.', 'error');
            return null;
        } finally { hideSpinner(); }
    };

    // --- 9. Event Listener Global para Subir Comprobante a Gasto Existente ---
    document.addEventListener('click', async (e) => {
        const btnSubir = e.target.closest('.btn-subir-comprobante');
        if (btnSubir) {
            const idTransaccion = btnSubir.getAttribute('data-id');
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg, image/png, application/pdf';
            input.onchange = async (ev) => {
                const file = ev.target.files[0];
                if (!file) return;
                
                const url = await window.subirArchivoDirecto(file);
                if (url) {
                    showSpinner();
                    try {
                        const tokenStr = localStorage.getItem('usuarioToken') || 'http-only-cookie';
                        const res = await fetch(`/api/gastos/${idTransaccion}/comprobante`, {
                            method: 'PUT',
                            headers: { 'Authorization': `Bearer ${tokenStr}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ comprobante_url: url })
                        });
                        if (res.ok) {
                            showToast('Comprobante asociado exitosamente', 'success');
                            setTimeout(() => location.reload(), 1000);
                        } else showToast('Error al asociar el comprobante', 'error');
                    } catch (err) { showToast('Error de red', 'error'); } finally { hideSpinner(); }
                }
            };
            input.click();
        }
    });
});