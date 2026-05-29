// app.js
document.addEventListener('DOMContentLoaded', () => {
    // --- 0. Protección de Ruta (Autenticación Front-end) ---
    const token = localStorage.getItem('usuarioToken');
    if (!token) {
        // Si no hay token guardado, redirigir al login y detener la ejecución
        window.location.href = 'index.html';
        return; 
    }

    // --- Extraer configuración de moneda ---
    const payloadGlobal = JSON.parse(atob(token.split('.')[1]));
    const miIdUsuarioGlobal = payloadGlobal.id_usuario.toString();
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
        const response = await originalFetch(...args);
        
        // Si el backend responde con un 401 (Token inválido o expirado)
        if (response.status === 401) {
            localStorage.removeItem('usuarioToken');
            showToast('Tu sesión ha expirado por seguridad. Por favor, vuelve a iniciar sesión.', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return Promise.reject(new Error('Sesión expirada')); // Detiene la ejecución del fetch local
        }
        
        return response;
    };

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
                botonesHtml = `<button class="btn-primary btn-pagar" data-transaccion="${idTransaccion}" data-usuario="${idUsuarioOtro}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-bottom: 0.3rem;">Marcar Pagado</button>`;
            } else {
                botonesHtml = `
                    <button class="btn-primary btn-pagar" data-transaccion="${idTransaccion}" data-usuario="${miIdUsuario}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; margin-bottom: 0.3rem; background-color: var(--primary-slate);">Pago Manual</button>
                    <button class="btn-primary btn-pagar-inapp" data-transaccion="${idTransaccion}" data-monto="${monto}" style="background-color: #f1c40f; color: var(--primary-slate); padding: 0.3rem 0.5rem; font-size: 0.8rem;">Pagar vía App</button>
                `;
            }
        }

        const btnBanco = `<button class="btn-ver-banco" data-usuario="${idUsuarioOtro}" title="Ver Datos Bancarios" style="margin-left: 0.5rem; padding: 0.2rem 0.4rem; font-size: 0.7rem; background-color: var(--primary-slate); color: white; border: none; border-radius: 4px; cursor: pointer;">🏦 Banco</button>`;

        tr.innerHTML = `
            <td>${nombreCol} ${btnBanco}</td>
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

        const token = localStorage.getItem('usuarioToken');
        const payload = JSON.parse(atob(token.split('.')[1]));
        const miIdUsuario = payload.id_usuario.toString();
        const isGod = localStorage.getItem('isGodMode') === 'true';
        const miRol = isGod ? 'Administrador' : misRolesEnGrupos[idGrupoSeleccionado];
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
                <td>${t.fecha}</td>
                <td><span style="background-color: var(--bg-light); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">${t.categoria || 'General'}</span></td>
                <td>${t.descripcion}${t.comprobante_url ? ` <a href="#" onclick="event.preventDefault(); window.openReceiptModal('${t.comprobante_url}')" title="Ver Comprobante" style="text-decoration: none; font-size: 1.1rem; margin-left: 0.3rem;">📎</a>` : ''}</td>
                <td>${t.pagador_nombre}</td>
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

        // Obtener el ID del usuario actual desencriptando el JWT de forma segura
        const token = localStorage.getItem('usuarioToken');
        let miIdUsuario = "1"; // Fallback por defecto
        if (token) {
            const payload = JSON.parse(atob(token.split('.')[1]));
            miIdUsuario = payload.id_usuario.toString();
        }

        transaccionesFiltradas.forEach(t => {
            if (t.pagador === miIdUsuario) {
                miBalance += t.monto;
            }

            if (t.participantes.includes(miIdUsuario)) {
                const division = t.monto / t.participantes.length;
                miBalance -= division;
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

    // --- 2.8. Flujo de Suscripción Premium ---
    const btnShowPayment = document.getElementById('btn-show-payment');
    const paymentFormContainer = document.getElementById('payment-form-container');
    const formSuscripcion = document.getElementById('form-suscripcion');
    const fechaExpInput = document.getElementById('fecha-exp');
    const numeroTarjetaInput = document.getElementById('numero-tarjeta');
    const cvvInput = document.getElementById('cvv');

    if (btnShowPayment && paymentFormContainer) {
        btnShowPayment.addEventListener('click', () => {
            paymentFormContainer.style.display = 'block';
            btnShowPayment.style.display = 'none'; // Ocultar el botón
        });
    }

    // Formatear campo de Fecha de Expiración (MM/YY)
    if (fechaExpInput) {
        fechaExpInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, ''); // Eliminar todo lo que no sea número
            
            if (value.length >= 2) {
                // Validar que el mes sea válido (01-12)
                let month = parseInt(value.substring(0, 2));
                if (month > 12) value = '12' + value.substring(2);
                if (month === 0) value = '01' + value.substring(2);
                
                value = value.substring(0, 2) + '/' + value.substring(2, 4);
            }
            e.target.value = value;
        });
    }

    // Formatear campo de Tarjeta de Crédito (Visa/MC: 4-4-4-4, Amex: 4-6-5)
    const iconoTarjeta = document.getElementById('icono-tarjeta');
    if (numeroTarjetaInput) {
        numeroTarjetaInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, ''); // Eliminar todo lo que no sea número
            const isAmex = value.startsWith('34') || value.startsWith('37');
            const maxLength = isAmex ? 15 : 16;
            
            value = value.substring(0, maxLength); // Limitar dígitos
            
            // Formateo visual
            if (isAmex) {
                let formatted = value.substring(0, 4);
                if (value.length > 4) formatted += ' ' + value.substring(4, 10);
                if (value.length > 10) formatted += ' ' + value.substring(10, 15);
                e.target.value = formatted;
            } else {
                e.target.value = value.replace(/(\d{4})(?=\d)/g, '$1 ');
            }
            
            // Actualizar el logotipo dinámicamente según el primer dígito
            if (iconoTarjeta) {
                if (value.startsWith('4')) {
                    iconoTarjeta.innerHTML = '<img src="https://upload.wikimedia.org/wikipedia/commons/0/04/Visa.svg" alt="Visa" style="height: 1rem; vertical-align: middle;">';
                } else if (value.startsWith('5')) {
                    iconoTarjeta.innerHTML = '<img src="https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" alt="Mastercard" style="height: 1.2rem; vertical-align: middle;">';
                } else if (isAmex) {
                    iconoTarjeta.innerHTML = '<img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/American_Express_logo_%282018%29.svg" alt="Amex" style="height: 1.2rem; vertical-align: middle;">';
                } else {
                    iconoTarjeta.innerHTML = '💳';
                }
            }
        });
    }

    // Formatear campo CVV (Solo números, máximo 4 dígitos)
    if (cvvInput) {
        cvvInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
        });
    }

    if (formSuscripcion) {
        formSuscripcion.addEventListener('submit', async (e) => {
            e.preventDefault();
            const numero_tarjeta = document.getElementById('numero-tarjeta').value;
            const fecha_exp = document.getElementById('fecha-exp').value;
            const cvv = document.getElementById('cvv').value;
            const token = localStorage.getItem('usuarioToken');

            // Validación de longitud y formato para la Tarjeta y el CVV
            const tarjetaLimpia = numero_tarjeta.replace(/\s/g, '');
            const isAmex = tarjetaLimpia.startsWith('34') || tarjetaLimpia.startsWith('37');
            
            if (isNaN(tarjetaLimpia) || (isAmex && tarjetaLimpia.length !== 15) || (!isAmex && tarjetaLimpia.length !== 16)) {
                showToast(`La tarjeta de crédito debe tener exactamente ${isAmex ? '15' : '16'} dígitos.`, 'error');
                return;
            }
            
            const cvvRegex = isAmex ? /^\d{4}$/ : /^\d{3}$/;
            if (!cvvRegex.test(cvv)) {
                showToast(`El CVV debe tener exactamente ${isAmex ? '4' : '3'} dígitos numéricos.`, 'error');
                return;
            }

            showSpinner();
            try {
                const response = await fetch('/api/suscripciones', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ numero_tarjeta, fecha_exp, cvv })
                });
                
                const data = await response.json();
                if (response.ok) {
                    showToast(data.message, 'success');
                    setTimeout(() => window.location.reload(), 1500); // Recargar para aplicar los cambios Premium en la UI
                } else {
                    showToast(data.error, 'error');
                    hideSpinner();
                }
            } catch (error) { console.error('Error en el pago:', error); hideSpinner(); }
        });
    }

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
        if (fileInput && fileInput.files.length > 0) {
            comprobante_url = await window.subirArchivoDirecto(fileInput.files[0]);
        }

        // Preparar el cuerpo de la petición
        const nuevoGasto = { id_grupo, descripcion, categoria, monto, pagador, participantes, comprobante_url };

        showSpinner();
        try {
            const token = localStorage.getItem('usuarioToken'); // Obtener el token guardado

            // Enviar los datos al backend usando fetch
            const response = await fetch('/api/gastos', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` // Adjuntar token JWT
                },
                body: JSON.stringify(nuevoGasto)
            });

            if (!response.ok) {
                throw new Error('Error en la respuesta del servidor');
            }

            const result = await response.json();
            console.log('Respuesta del servidor:', result.message);

            // Obtener fecha formateada DD/MM/YYYY para la UI local
            const hoy = new Date();
            const fechaFormateada = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;

            // 1. Modificar el Estado local
            transacciones.push({ id_transaccion: result.data.id_transaccion, id_grupo, descripcion, categoria, comprobante_url, monto, pagador, pagador_nombre, participantes, fecha: fechaFormateada });

            // 2. Renderizar UI
            renderizarTabla();
            calcularSaldos();

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
                if (!confirm('¿Estás seguro de que deseas eliminar este gasto de forma permanente?')) return;

                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-id');
                const token = localStorage.getItem('usuarioToken');

                showSpinner();
                try {
                    const response = await fetch(`/api/gastos/${idTransaccion}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (response.ok) {
                        transacciones = transacciones.filter(t => t.id_transaccion != idTransaccion);
                        renderizarTabla();
                        calcularSaldos();
                    } else {
                        const data = await response.json();
                        showToast(data.error || 'Error al eliminar el gasto.', 'error');
                    }
                } catch (error) { console.error('Error:', error); showToast('Problema de conexión con el servidor.', 'error'); } finally { hideSpinner(); }
            }
            
            // --- Lógica para Editar Gasto ---
            if (e.target.classList.contains('btn-editar')) {
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

                const token = localStorage.getItem('usuarioToken');
                showSpinner();
                try {
                    const response = await fetch(`/api/gastos/${idTransaccion}`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ descripcion: nuevaDescripcion, categoria: nuevaCategoria, monto: nuevoMonto })
                    });

                    if (response.ok) {
                        gastoActual.descripcion = nuevaDescripcion;
                        gastoActual.categoria = nuevaCategoria;
                        gastoActual.monto = nuevoMonto;
                        renderizarCategorias();
                        renderizarTabla();
                        calcularSaldos();
                    } else {
                        const data = await response.json();
                        showToast(data.error || 'Error al editar el gasto.', 'error');
                    }
                } catch (error) { console.error('Error:', error); showToast('Problema de conexión con el servidor.', 'error'); } finally { hideSpinner(); }
            }
        });
    }

    // --- 4. Inicialización (Cargar datos del servidor) ---
    const inicializarApp = async () => {
        showSkeletonLoader(listaGastos, 6);
        try {
            const token = localStorage.getItem('usuarioToken'); // Obtener el token guardado
            
            const response = await fetch('/api/gastos', {
                headers: {
                    'Authorization': `Bearer ${token}` // Adjuntar token JWT
                }
            });
            if (!response.ok) throw new Error('Error al obtener los gastos');
            
            transacciones = await response.json();
            
            renderizarCategorias();
            renderizarTabla();
            calcularSaldos();

            // Cargar dinámicamente la lista de grupos en el <select>
            const reqGrupos = await fetch('/api/grupos', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
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
                            const reqMiembros = await fetch(`/api/grupos/${idGrupo}/miembros`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
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
                            }
                        } catch (err) { console.error('Error al cargar miembros', err); } finally { hideSpinner(); }
                    });
                }
            }

            // Intentar cargar las analíticas Premium
            const reqAnalisis = await fetch('/api/finanzas/analisis', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

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
            const tokenToRevoke = localStorage.getItem('usuarioToken');
            if (tokenToRevoke) {
                try {
                    await fetch('/api/usuarios/logout', { method: 'POST', headers: { 'Authorization': `Bearer ${tokenToRevoke}` } });
                } catch (err) { console.error('Error cerrando sesión remota', err); }
            }

            localStorage.removeItem('usuarioToken'); // Eliminar el rastro de sesión local
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'index.html'; // Volver a la pantalla de Login
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
                const token = localStorage.getItem('usuarioToken');

                showSpinner();
                try {
                    const res = await fetch(`/api/usuarios/${idUsuario}/banco`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const datos = await res.json();
                    
                    if (res.ok) {
                        const mensaje = `🏦 DATOS BANCARIOS:\n\n` +
                                        `RUT: ${datos.rut || 'No especificado'}\n` +
                                        `Banco: ${datos.banco || 'No especificado'}\n` +
                                        `Tipo de Cuenta: ${datos.tipo_cuenta || 'No especificado'}\n` +
                                        `N° de Cuenta: ${datos.numero_cuenta || 'No especificado'}\n` +
                                        `Correo: ${datos.correo || 'No especificado'}\n\n` +
                                        `Selecciona "Aceptar" para copiar el Número de Cuenta al portapapeles.`;
                        if (confirm(mensaje)) {
                            const datoACopiar = datos.numero_cuenta || datos.rut;
                            if (datoACopiar) {
                                await navigator.clipboard.writeText(datoACopiar);
                                showToast('Dato copiado al portapapeles.', 'success');
                            }
                        }
                    } else showToast(datos.error || 'No se encontraron datos.', 'error');
                } catch (error) { console.error(error); showToast('Error de conexión.', 'error'); } finally { hideSpinner(); }
            }

            // Verificar si el elemento clickeado es un botón de pagar
            if (e.target.classList.contains('btn-pagar')) {
                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-transaccion');
                const idUsuario = btn.getAttribute('data-usuario');

                showSpinner();
                try {
                    const token = localStorage.getItem('usuarioToken'); // Obtener el token guardado
                    const response = await fetch('/api/cuotas/pagar', {
                        method: 'PUT',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}` // Adjuntar token JWT
                        },
                        body: JSON.stringify({ id_transaccion: idTransaccion, id_usuario: idUsuario })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // Actualizar la interfaz de usuario (DOM) si la BD se actualizó bien
                        const fila = btn.closest('tr');
                        const celdaEstado = fila.querySelector('td:nth-child(3)');
                        celdaEstado.innerHTML = '<span style="color: var(--secondary-emerald); font-weight: bold;">Pagado</span>';
                        btn.parentElement.innerHTML = '-'; // Reemplazar botón con guión

                        if (data.archivado) {
                            showToast('¡Gasto completado y archivado en el historial!', 'success');
                            transacciones = transacciones.filter(t => t.id_transaccion != idTransaccion);
                            renderizarTabla();
                            calcularSaldos();
                        }
                    } else {
                        const data = await response.json();
                        showToast(data.error || 'Error al procesar el pago.', 'error');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    showToast('Problema de conexión con el servidor.', 'error');
                } finally {
                    hideSpinner();
                }
            }
            
            // Verificar si el elemento clickeado es un pago in-app (Con comisión)
            if (e.target.classList.contains('btn-pagar-inapp')) {
                const btn = e.target;
                const idTransaccion = btn.getAttribute('data-transaccion');
                const montoBase = parseFloat(btn.getAttribute('data-monto'));
                
                const comision = montoBase * 0.0089; // 0.89%
                const total = montoBase + comision;
                
                const mensajeConfirmacion = `Detalle del Pago In-App:\n\n` +
                                            `- Cuota Base: ${moneda}${montoBase.toFixed(2)}\n` +
                                            `- Comisión GroupWallet (0.89%): ${moneda}${comision.toFixed(2)}\n` +
                                            `- Total a Debitar: ${moneda}${total.toFixed(2)}\n\n` +
                                            `¿Aceptas procesar el pago usando tu método guardado?`;
                                            
                if (!confirm(mensajeConfirmacion)) return;

                showSpinner();
                try {
                    const token = localStorage.getItem('usuarioToken');
                    const response = await fetch('/api/cuotas/pago-inapp', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ id_transaccion: idTransaccion })
                    });

                    const data = await response.json();
                    if (response.ok) {
                        const fila = btn.closest('tr');
                        fila.querySelector('td:nth-child(3)').innerHTML = '<span style="color: var(--secondary-emerald); font-weight: bold;">Pagado</span>';
                        btn.parentElement.innerHTML = '-'; // Quitar botones

                        showToast(data.message, 'success');
                        
                        if (data.detalle && data.detalle.archivado) {
                            transacciones = transacciones.filter(t => t.id_transaccion != idTransaccion);
                            renderizarTabla();
                            calcularSaldos();
                        }
                    } else showToast(data.error || 'Error al procesar el pago In-App.', 'error');
                } catch (error) { console.error(error); showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
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
                        mensajeHtml += `<li style="background: var(--bg-light); padding: 0.8rem; border-radius: 6px; margin-bottom: 0.5rem; border: 1px solid var(--border-color);"><strong style="color: var(--danger-color);">${t.deudor}</strong> debe pagarle a <strong style="color: var(--secondary-emerald);">${t.acreedor}</strong> la suma de <strong>${moneda}${t.monto.toFixed(2)}</strong></li>`;
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
                    maxSizeMB: 1,            // Límite máximo de peso (1 MB)
                    maxWidthOrHeight: 1280,  // Resolución máxima (HD)
                    useWebWorker: true       // Evita que la interfaz se congele
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
});