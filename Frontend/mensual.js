document.addEventListener('DOMContentLoaded', () => {
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
        return; 
    }
    const token = 'http-only-cookie'; // Mantiene compatibilidad con fetch

    // --- Interceptor Global de Fetch ---
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            if (typeof showToast === 'function') {
                showToast('Tu sesión ha expirado por seguridad. Por favor, vuelve a iniciar sesión.', 'error');
            }
            setTimeout(() => window.location.href = 'login.html', 2000);
            return Promise.reject(new Error('Sesión expirada'));
        }
        return response;
    };

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/api/usuarios/logout', { method: 'POST' });
            } catch (err) { console.error('Error cerrando sesión', err); }
            
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'login.html';
        });
    }

    let currentDate = new Date();
    let transacciones = [];
    let misRolesEnGrupos = {};
    let chartMensualInstance = null;
    let isPremium = false;
    const miIdUsuario = usuarioId.toString();
    const moneda = localStorage.getItem(`moneda_${miIdUsuario}`) || '$';

    // --- Modo Privacidad ---
    let isPrivacyMode = localStorage.getItem(`privacidad_${miIdUsuario}`) === 'true';
    const maskAmount = (monto) => isPrivacyMode ? '***' : `${moneda}${parseFloat(monto).toFixed(2)}`;
    const btnTogglePrivacidad = document.getElementById('btn-toggle-privacidad');
    if (btnTogglePrivacidad) {
        btnTogglePrivacidad.textContent = isPrivacyMode ? '🙈' : '👁️';
        btnTogglePrivacidad.addEventListener('click', () => {
            isPrivacyMode = !isPrivacyMode;
            localStorage.setItem(`privacidad_${miIdUsuario}`, isPrivacyMode);
            btnTogglePrivacidad.textContent = isPrivacyMode ? '🙈' : '👁️';
            renderMonth();
        });
    }
    
    let sortColumn = 'dia';
    let sortAsc = true;

    document.querySelectorAll('#tabla-gastos-mensual th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (sortColumn === col) {
                sortAsc = !sortAsc;
            } else {
                sortColumn = col;
                sortAsc = true;
            }
            document.querySelectorAll('#tabla-gastos-mensual th.sortable').forEach(h => {
                h.textContent = h.textContent.replace(/ 🔼| 🔽| ↕️/, ' ↕️');
            });
            th.textContent = th.textContent.replace(/ ↕️| 🔼| 🔽/, sortAsc ? ' 🔼' : ' 🔽');
            renderMonth();
        });
    });

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

    // --- Manejo de UI: Mes Actual ---
    const renderMonth = () => {
        const monthLabel = currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
        document.getElementById('label-mes-actual').textContent = monthLabel;

        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();
        
        // --- Manejo de Categorías Dinámicas ---
        const selectCategoria = document.getElementById('categoria-gasto-mensual');
        const inputNuevaCategoria = document.getElementById('nueva-categoria-gasto-mensual');

        if (selectCategoria && inputNuevaCategoria && !selectCategoria.dataset.listener) {
            selectCategoria.dataset.listener = true;
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
        
        const categoriasUnicas = new Set(['Supermercado', 'Transporte', 'Restaurantes', 'Ocio', 'Servicios', 'General']);
        transacciones.forEach(t => { if (t.categoria) categoriasUnicas.add(t.categoria); });
        if (selectCategoria && selectCategoria.options.length <= 1) {
            selectCategoria.innerHTML = '<option value="" disabled selected>Selecciona una categoría</option>';
            categoriasUnicas.forEach(cat => selectCategoria.innerHTML += `<option value="${cat}">${cat}</option>`);
            selectCategoria.innerHTML += `<option value="nuevo" style="font-weight: bold; color: var(--secondary-emerald);">+ Crear nueva categoría...</option>`;
        }

        const listaGastosMensual = document.getElementById('lista-gastos-mensual');
        listaGastosMensual.innerHTML = '';

        const idGrupo = document.getElementById('filtro-grupo-mensual')?.value;
        
        let filtradas = transacciones.filter(t => {
            const partes = t.fecha.split('/'); // Postgres devuelve DD/MM/YYYY
            const dMes = parseInt(partes[1]) - 1;
            const dAnio = parseInt(partes[2]);
            const matchesGroup = idGrupo ? t.id_grupo == idGrupo : true;
            return dMes === currentMonth && dAnio === currentYear && matchesGroup;
        });

        // --- Calcular Gasto del Mes Anterior ---
        let prevMonth = currentMonth - 1;
        let prevYear = currentYear;
        if (prevMonth < 0) { prevMonth = 11; prevYear -= 1; }
        
        const filtradasPrev = transacciones.filter(t => {
            const partes = t.fecha.split('/');
            const dMes = parseInt(partes[1]) - 1;
            const dAnio = parseInt(partes[2]);
            const matchesGroup = idGrupo ? t.id_grupo == idGrupo : true;
            return dMes === prevMonth && dAnio === prevYear && matchesGroup;
        });
        const totalPrevMes = filtradasPrev.reduce((sum, t) => sum + t.monto, 0);

        filtradas.sort((a, b) => {
            let valA = sortColumn === 'dia' ? parseInt(a.fecha.split('/')[0]) : a[sortColumn];
            let valB = sortColumn === 'dia' ? parseInt(b.fecha.split('/')[0]) : b[sortColumn];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });

        if (filtradas.length === 0) {
            listaGastosMensual.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No hay gastos registrados en este mes.</td></tr>';
            return;
        }

        filtradas.forEach(t => {
            const tr = document.createElement('tr');
            const miRol = misRolesEnGrupos[t.id_grupo];
            let botones = '-';
            if (miRol === 'Administrador' || miIdUsuario === t.pagador) {
                botones = `<button class="btn-eliminar" data-id="${t.id_transaccion}" style="background-color: var(--danger-color); color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer;">X</button>`;
            }
            
            tr.innerHTML = `
                <td><span style="font-weight: bold; color: var(--secondary-emerald);">${t.fecha.split('/')[0]}</span></td>
                <td><span style="background-color: var(--bg-light); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">${t.categoria || 'General'}</span></td>
                <td>${escapeHTML(t.descripcion)}${t.comprobante_url ? ` <a href="#" onclick="event.preventDefault(); window.openReceiptModal('${escapeHTML(t.comprobante_url)}')" title="Ver Comprobante" style="text-decoration: none; font-size: 1.1rem; margin-left: 0.3rem;">📎</a>` : ` <button class="btn-subir-comprobante" data-id="${t.id_transaccion}" title="Subir comprobante" style="background: none; border: none; font-size: 1.1rem; margin-left: 0.3rem; cursor: pointer;">📤</button>`}</td>
                <td>${t.pagador_nombre}</td>
                <td>${maskAmount(t.monto)}</td>
                <td>${botones}</td>
            `;
            listaGastosMensual.appendChild(tr);
        });

        // --- Algoritmo de Gastos Hormiga Dinámico ---
        const umbralHormiga = parseFloat(localStorage.getItem(`umbralHormiga_${miIdUsuario}`)) || 15.00;
        const descHormiga = document.getElementById('hormiga-desc');
        if (descHormiga) descHormiga.textContent = `Fugas de dinero silenciosas (menores o iguales a ${moneda}${umbralHormiga.toFixed(2)}).`;

        let hormigaSuma = 0, hormigaCount = 0;
        filtradas.forEach(t => {
            if (t.monto <= umbralHormiga) { hormigaSuma += t.monto; hormigaCount++; }
        });
        document.getElementById('hormiga-total').textContent = maskAmount(hormigaSuma);
        document.getElementById('hormiga-cantidad').textContent = `${hormigaCount} transacciones`;
        const tipEl = document.getElementById('hormiga-tip');
        if (hormigaSuma > 50) tipEl.textContent = '💡 Tip: ¡Cuidado! Estás perdiendo bastante dinero en compras pequeñas. Podrías invertir ese dinero.';
        else if (hormigaSuma > 0) tipEl.textContent = '💡 Tip: Vas bien, pero si preparas tu propio café o reduces estos antojos, ahorrarás mucho más a fin de mes.';
        else tipEl.textContent = '💡 Tip: ¡Excelente! Cero gastos hormiga registrados en este mes. Mantén el control.';

        // --- Barra de Progreso del Presupuesto ---
        const totalGastadoMes = filtradas.reduce((sum, t) => sum + t.monto, 0);
        const presupuesto = parseFloat(localStorage.getItem(`presupuesto_${miIdUsuario}`)) || 0;
        
        const barra = document.getElementById('barra-presupuesto');
        const lblGastado = document.getElementById('lbl-gastado');
        const lblLimite = document.getElementById('lbl-limite');
        const lblPorcentaje = document.getElementById('lbl-porcentaje');
        const lblComparacion = document.getElementById('lbl-comparacion');

        if (lblGastado && lblLimite && barra && lblPorcentaje) {
            lblGastado.textContent = maskAmount(totalGastadoMes);
            lblLimite.textContent = maskAmount(presupuesto);

            if (lblComparacion) {
                if (isPremium) {
                    if (totalPrevMes > 0) {
                        const diff = totalGastadoMes - totalPrevMes;
                        const pct = Math.abs((diff / totalPrevMes) * 100).toFixed(1);
                        if (diff > 0) {
                            lblComparacion.innerHTML = `<span style="color: var(--danger-color); font-size: 0.8rem; font-weight: bold;" title="Gastaste ${moneda}${diff.toFixed(2)} más que el mes pasado">↑ ${pct}%</span>`;
                        } else if (diff < 0) {
                            lblComparacion.innerHTML = `<span style="color: var(--secondary-emerald); font-size: 0.8rem; font-weight: bold;" title="Ahorraste ${moneda}${Math.abs(diff).toFixed(2)} respecto al mes pasado">↓ ${pct}%</span>`;
                        } else {
                            lblComparacion.innerHTML = `<span style="color: var(--text-muted); font-size: 0.8rem; font-weight: bold;" title="Mismo gasto que el mes pasado">= 0%</span>`;
                        }
                    } else {
                        lblComparacion.innerHTML = ``; // No hay datos del mes anterior
                    }
                } else {
                    lblComparacion.innerHTML = `<a href="historial.html" title="Compara con el mes anterior (Exclusivo Premium)" style="color: #f1c40f; text-decoration: none; font-size: 0.9rem; cursor: pointer; margin-left: 0.2rem;">🔒</a>`;
                }
            }

            if (presupuesto > 0) {
                let porcentaje = (totalGastadoMes / presupuesto) * 100;
                lblPorcentaje.textContent = porcentaje.toFixed(1);
                
                barra.style.width = `${Math.min(porcentaje, 100)}%`;
                
                if (porcentaje >= 100) barra.style.backgroundColor = 'var(--danger-color)'; // Alerta: Excedido
                else if (porcentaje >= 80) barra.style.backgroundColor = '#f1c40f'; // Precaución: Cerca del límite
                else barra.style.backgroundColor = 'var(--secondary-emerald)'; // Seguro
            } else {
                lblPorcentaje.textContent = '0';
                barra.style.width = '0%';
                barra.style.backgroundColor = 'var(--secondary-emerald)';
            }
        }

        // --- Gráfico de Líneas (Gasto Acumulado) ---
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const dailyTotals = new Array(daysInMonth).fill(0);
        filtradas.forEach(t => { dailyTotals[parseInt(t.fecha.split('/')[0]) - 1] += t.monto; });
        
        let runningTotal = 0;
        const cumulativeTotals = dailyTotals.map(daily => runningTotal += daily);
        
        const ctx = document.getElementById('grafico-mensual');
        if (chartMensualInstance) chartMensualInstance.destroy();
        if (ctx) {
            chartMensualInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array.from({length: daysInMonth}, (_, i) => i + 1),
                    datasets: [{ label: 'Total Acumulado ($)', data: cumulativeTotals, borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.2)', fill: true, tension: 0.3 }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { 
                        legend: { display: false },
                        tooltip: { callbacks: { label: (context) => 'Total Acumulado: ' + maskAmount(context.raw) } }
                    }, 
                    scales: { y: { beginAtZero: true, ticks: { callback: (value) => maskAmount(value) } } } 
                }
            });
        }

        // --- UX: Cálculo en vivo y Selección de Participantes ---
        const actualizarCalculoVivo = () => {
            const monto = parseFloat(document.getElementById('monto-gasto').value) || 0;
            const checkboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]:checked');
            const numParticipantes = checkboxes.length;
            const resumenEl = document.getElementById('calculo-vivo-resumen');
            if (resumenEl) {
                if (monto > 0 && numParticipantes > 0) {
                    const porPersona = (monto / numParticipantes).toFixed(2);
                    resumenEl.textContent = `Se dividirán ${moneda}${monto.toFixed(2)} entre ${numParticipantes} personas (${moneda}${porPersona} c/u).`;
                } else resumenEl.textContent = '';
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
    };

    // --- Obtener y Reflejar Cuota de Subida de Archivos ---
    const cargarCuotaComprobantes = async () => {
        const quotaContainer = document.getElementById('upload-quota-container');
        const quotaText = document.getElementById('upload-quota-text');
        const quotaBar = document.getElementById('upload-quota-bar');
        const fileInput = document.getElementById('comprobante-gasto-mensual');
        if (!quotaContainer) return;

        try {
            const res = await fetch('/api/upload/quota', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                if (data.isFree) {
                    quotaContainer.style.display = 'block';
                    const percentage = Math.min((data.used / data.limit) * 100, 100);
                    quotaBar.style.width = `${percentage}%`;
                    
                    if (data.used >= data.limit) {
                        quotaBar.style.backgroundColor = 'var(--danger-color)';
                        fileInput.disabled = true;
                        quotaText.innerHTML = `${data.used}/${data.limit} <a href="dashboard.html?showUpgrade=true" style="color: var(--danger-color); text-decoration: underline;">¡Mejora a Premium!</a>`;
                    } else {
                        quotaText.textContent = `${data.used}/${data.limit}`;
                        quotaBar.style.backgroundColor = data.used >= 4 ? '#f1c40f' : 'var(--secondary-emerald)'; // Amarillo si llega a 4
                        fileInput.disabled = false;
                    }
                } else {
                    quotaContainer.style.display = 'none';
                    fileInput.disabled = false;
                }
            }
        } catch (e) { console.error('Error cargando cuota:', e); }
    };

    document.getElementById('btn-prev-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderMonth();
    });

    document.getElementById('btn-next-month').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderMonth();
    });

    // --- Inicialización y Fetch de Datos ---
    const inicializar = async () => {
        // Cargar presupuesto guardado
        const presGuardado = localStorage.getItem(`presupuesto_${miIdUsuario}`);
        if (presGuardado && document.getElementById('input-presupuesto')) {
            document.getElementById('input-presupuesto').value = presGuardado;
        }
        
        document.getElementById('btn-guardar-presupuesto')?.addEventListener('click', () => {
            const inputVal = parseFloat(document.getElementById('input-presupuesto').value);
            if (!isNaN(inputVal) && inputVal > 0) {
                localStorage.setItem(`presupuesto_${miIdUsuario}`, inputVal);
                showToast('Presupuesto guardado exitosamente.', 'success');
                renderMonth();
            } else showToast('Ingrese un presupuesto válido mayor a 0.', 'error');
        });


        showSkeletonLoader(document.getElementById('lista-gastos-mensual'), 6);
        try {
            cargarCuotaComprobantes();
            // Cargar Gastos
            const resGastos = await fetch('/api/gastos', { headers: { 'Authorization': `Bearer ${token}` } });
            if (resGastos.ok) transacciones = await resGastos.json();

            // Cargar Grupos
            const resGrupos = await fetch('/api/grupos', { headers: { 'Authorization': `Bearer ${token}` } });
            if (resGrupos.ok) {
                const grupos = await resGrupos.json();
                const selectGrupo = document.getElementById('grupo-gasto');
                const filtroGrupo = document.getElementById('filtro-grupo-mensual');
                grupos.forEach(g => {
                    selectGrupo.innerHTML += `<option value="${g.id_grupo}">${g.nombre_grupo}</option>`;
                    if (filtroGrupo) filtroGrupo.innerHTML += `<option value="${g.id_grupo}">${g.nombre_grupo}</option>`;
                    misRolesEnGrupos[g.id_grupo] = g.rol;
                });

                selectGrupo.addEventListener('change', async (e) => {
                    renderMonth();
                    const reqMiembros = await fetch(`/api/grupos/${e.target.value}/miembros`, { headers: { 'Authorization': `Bearer ${token}` } });
                    if (reqMiembros.ok) {
                        const miembros = await reqMiembros.json();
                        const selectPagador = document.getElementById('pagador-gasto');
                        const cbGroup = document.querySelector('.checkbox-group');
                        selectPagador.innerHTML = ''; cbGroup.innerHTML = '';
                        miembros.forEach(m => {
                            selectPagador.innerHTML += `<option value="${m.id_usuario}">${m.nombre}</option>`;
                            cbGroup.innerHTML += `<label><input type="checkbox" value="${m.id_usuario}" checked> ${m.nombre}</label>`;
                        });
                        document.getElementById('btn-toggle-participantes').textContent = 'Desmarcar Todos';
                        actualizarCalculoVivo();
                    }
                });

                if (filtroGrupo) filtroGrupo.addEventListener('change', renderMonth);
            }
            
            // Establecer el input date al día de hoy por defecto
            document.getElementById('fecha-gasto').value = new Date().toISOString().split('T')[0];
            renderMonth();
        } catch (e) { console.error(e); }
    };

    // --- Manejo de Eventos: Guardar Gasto con Fecha ---
    document.getElementById('form-gasto-mensual').addEventListener('submit', async (e) => {
        e.preventDefault();

        const id_grupo = parseInt(document.getElementById('grupo-gasto').value);
        const descripcion = document.getElementById('desc-gasto').value;
        const selectCategoria = document.getElementById('categoria-gasto-mensual');
        const inputNuevaCategoria = document.getElementById('nueva-categoria-gasto-mensual');
        let categoria = selectCategoria.value === 'nuevo' ? inputNuevaCategoria.value.trim() : selectCategoria.value;
        if (!categoria) return showToast('Debes seleccionar o crear una categoría.', 'error');
        const monto = parseFloat(document.getElementById('monto-gasto').value);
        const pagador = document.getElementById('pagador-gasto').value;
        const fecha = document.getElementById('fecha-gasto').value; // Formato YYYY-MM-DD
        const participantes = Array.from(document.querySelectorAll('.checkbox-group input:checked')).map(cb => cb.value);

        if (isNaN(monto) || monto <= 0 || participantes.length === 0) return showToast('Datos inválidos.', 'error');

        let comprobante_url = null;
        const fileInput = document.getElementById('comprobante-gasto-mensual');

        // --- Lógica de Sincronización (Background Sync) ---
        if (!navigator.onLine) {
            if (fileInput && fileInput.files.length > 0) {
                showToast('Aviso: Los comprobantes no se pueden subir sin red. El gasto se guardará sin imagen.', 'error');
            }
            const nuevoGasto = { id_grupo, descripcion, categoria, monto, pagador, participantes, fecha, comprobante_url: null };
            const colaGastos = JSON.parse(localStorage.getItem('colaGastosOffline') || '[]');
            colaGastos.push(nuevoGasto);
            localStorage.setItem('colaGastosOffline', JSON.stringify(colaGastos));
            
            showToast('Estás offline. El gasto se ha guardado localmente y se sincronizará al reconectar.', 'info');
            document.getElementById('form-gasto-mensual').reset();
            return;
        }

        if (fileInput && fileInput.files.length > 0) {
            comprobante_url = await window.subirArchivoDirecto(fileInput.files[0]);
        }

        showSpinner();
        try {
            const res = await fetch('/api/gastos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ id_grupo, descripcion, categoria, monto, pagador, participantes, fecha, comprobante_url })
            });
            if (res.ok) {
                showToast('Gasto agregado al calendario.', 'success');
                setTimeout(() => window.location.reload(), 1000); // Recargamos para traer la fecha formateada del backend
            } else showToast((await res.json()).error, 'error');
        } catch (error) { showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
    });

    // --- Eliminar Gasto ---
    document.getElementById('lista-gastos-mensual').addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-eliminar')) {
            if (!confirm('¿Eliminar este gasto permanentemente?')) return;
            showSpinner();
            try {
                const res = await fetch(`/api/gastos/${e.target.getAttribute('data-id')}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) {
                    transacciones = transacciones.filter(t => t.id_transaccion != e.target.getAttribute('data-id'));
                    renderMonth();
                } else showToast((await res.json()).error, 'error');
            } catch (err) {} finally { hideSpinner(); }
        }
    });

    inicializar();

    // Subida de archivos compartida para el modo mensual
    window.subirArchivoDirecto = async (archivo) => {
        if (!archivo) return null;
        showSpinner();
        try {
            let archivoFinal = archivo;
            
            if (archivo.type.startsWith('image/') && typeof imageCompression === 'function') {
                const userQuality = localStorage.getItem(`compresion_${usuarioId}`) || 'medium';
                let maxMB = 0.5, maxWidth = 1280;
                
                if (userQuality === 'high') { maxMB = 1; maxWidth = 1920; }
                else if (userQuality === 'low') { maxMB = 0.2; maxWidth = 800; }

                const options = { maxSizeMB: maxMB, maxWidthOrHeight: maxWidth, useWebWorker: true, fileType: 'image/webp' };
                archivoFinal = await imageCompression(archivo, options);
            }

            const resFirma = await fetch(`/api/upload/presigned-url?type=${encodeURIComponent(archivoFinal.type)}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!resFirma.ok) {
                const errData = await resFirma.json();
                throw new Error(errData.error || 'Error al obtener la firma de subida.');
            }
            const { url, publicUrl } = await resFirma.json();
            const resUpload = await fetch(url, { method: 'PUT', body: archivoFinal, headers: { 'Content-Type': archivoFinal.type } });
            if (!resUpload.ok) throw new Error('Error al subir a la nube.');
            return publicUrl;
        } catch (e) { showToast(e.message || 'No se pudo subir el archivo.', 'error'); return null; } finally { hideSpinner(); }
    };

    // --- 7. Exportar Reportes Mensuales (Exclusivo Premium) ---
    const initExportButtons = () => {
        const container = document.getElementById('export-buttons-container');
        if (!container) return;

        const btnPdf = document.createElement('button');
        btnPdf.className = 'btn-primary';
        btnPdf.style.backgroundColor = 'var(--danger-color)'; 
        btnPdf.style.width = 'auto';
        btnPdf.style.padding = '0.4rem 0.8rem';
        btnPdf.style.fontSize = '0.85rem';
        btnPdf.textContent = '📄 PDF';
        
        const btnCsv = document.createElement('button');
        btnCsv.className = 'btn-primary';
        btnCsv.style.backgroundColor = '#27ae60'; 
        btnCsv.style.width = 'auto';
        btnCsv.style.padding = '0.4rem 0.8rem';
        btnCsv.style.fontSize = '0.85rem';
        btnCsv.textContent = '📊 Excel';

        container.appendChild(btnPdf);
        container.appendChild(btnCsv);

        const validarPremium = async () => {
            const res = await fetch('/api/finanzas/analisis'); // Ruta protegida por verificarPremium en el Backend
            if (res.status === 403) {
                showToast('La exportación de reportes es exclusiva de Premium. Descubre sus beneficios...', 'info');
                setTimeout(() => window.location.href = 'dashboard.html?showUpgrade=true', 2500);
                return false;
            }
            return true;
        };

        btnPdf.addEventListener('click', async () => {
            if (!await validarPremium()) return;
            const m = currentDate.getMonth(); const a = currentDate.getFullYear();
            window.location.href = `/api/finanzas/exportar-mensual-pdf?mes=${m}&anio=${a}`;
        });

        btnCsv.addEventListener('click', async () => {
            if (!await validarPremium()) return;
            const m = currentDate.getMonth(); const a = currentDate.getFullYear();
            window.location.href = `/api/finanzas/exportar-mensual?mes=${m}&anio=${a}`; // El navegador manda tu Cookie Segura automáticamente
        });
    };

    setTimeout(initExportButtons, 1500); // Esperar a que rendericen los gráficos en el DOM
});