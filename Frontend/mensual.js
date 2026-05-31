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

    // --- Cierre de Sesión (Logout) ---
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
    const miIdUsuario = usuarioId.toString();
    
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
        const moneda = localStorage.getItem(`moneda_${miIdUsuario}`) || '$';
        
        let filtradas = transacciones.filter(t => {
            const partes = t.fecha.split('/'); // Postgres devuelve DD/MM/YYYY
            const dMes = parseInt(partes[1]) - 1;
            const dAnio = parseInt(partes[2]);
            const matchesGroup = idGrupo ? t.id_grupo == idGrupo : true;
            return dMes === currentMonth && dAnio === currentYear && matchesGroup;
        });

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
                <td>${moneda}${t.monto.toFixed(2)}</td>
                <td>${botones}</td>
            `;
            listaGastosMensual.appendChild(tr);
        });

        // --- Algoritmo de Gastos Hormiga (≤ $15.00) ---
        const umbralHormiga = 15.00;
        let hormigaSuma = 0, hormigaCount = 0;
        filtradas.forEach(t => {
            if (t.monto <= umbralHormiga) { hormigaSuma += t.monto; hormigaCount++; }
        });
        document.getElementById('hormiga-total').textContent = `${moneda}${hormigaSuma.toFixed(2)}`;
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

        if (lblGastado && lblLimite && barra && lblPorcentaje) {
            lblGastado.textContent = `${moneda}${totalGastadoMes.toFixed(2)}`;
            lblLimite.textContent = `${moneda}${presupuesto.toFixed(2)}`;

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
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        }
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

        // Cargar y escuchar cambios en la moneda
        const selectMoneda = document.getElementById('select-moneda');
        if (selectMoneda) {
            selectMoneda.value = localStorage.getItem(`moneda_${miIdUsuario}`) || '$';
            selectMoneda.addEventListener('change', (e) => {
                localStorage.setItem(`moneda_${miIdUsuario}`, e.target.value);
                showToast('Moneda actualizada.', 'success');
                renderMonth(); // Re-renderizar la vista para aplicar la nueva moneda
            });
        }

        showSkeletonLoader(document.getElementById('lista-gastos-mensual'), 6);
        try {
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
                const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1280, useWebWorker: true, fileType: 'image/webp' };
                archivoFinal = await imageCompression(archivo, options);
            }

            const resFirma = await fetch(`/api/upload/presigned-url?type=${encodeURIComponent(archivoFinal.type)}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!resFirma.ok) throw new Error('Error al obtener la firma.');
            const { url, publicUrl } = await resFirma.json();
            const resUpload = await fetch(url, { method: 'PUT', body: archivoFinal, headers: { 'Content-Type': archivoFinal.type } });
            if (!resUpload.ok) throw new Error('Error al subir a la nube.');
            return publicUrl;
        } catch (e) { showToast('No se pudo subir el archivo.', 'error'); return null; } finally { hideSpinner(); }
    };

    // --- 7. Exportar Reportes Mensuales (Exclusivo Premium) ---
    const scriptPdf = document.createElement('script');
    scriptPdf.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    document.head.appendChild(scriptPdf);

    const initExportButtons = () => {
        const chartContainer = document.getElementById('grafico-mensual')?.closest('.card');
        if (!chartContainer) return;

        const divBotones = document.createElement('div');
        divBotones.style = "display: flex; gap: 1rem; margin-top: 1.5rem; flex-wrap: wrap; justify-content: center;";

        const btnPdf = document.createElement('button');
        btnPdf.className = 'btn-primary';
        btnPdf.style.backgroundColor = 'var(--danger-color)'; 
        btnPdf.style.width = 'auto';
        btnPdf.textContent = '📄 Exportar a PDF';
        
        const btnCsv = document.createElement('button');
        btnCsv.className = 'btn-primary';
        btnCsv.style.backgroundColor = '#27ae60'; 
        btnCsv.style.width = 'auto';
        btnCsv.textContent = '📊 Exportar a Excel';

        divBotones.appendChild(btnPdf);
        divBotones.appendChild(btnCsv);
        chartContainer.appendChild(divBotones);

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
            showSpinner();
            if (!await validarPremium()) { hideSpinner(); return; }
            
            divBotones.style.display = 'none'; // Ocultar botones para que no salgan en la foto del PDF
            const element = document.querySelector('.dashboard-container');
            const nombreMes = document.getElementById('label-mes-actual').textContent.replace(/ /g, '_');
            
            const opt = { margin: 0.3, filename: `Reporte_Mensual_${nombreMes}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } };
            
            if (window.html2pdf) await html2pdf().set(opt).from(element).save();
            else showToast('La librería PDF aún se está cargando...', 'error');
            
            divBotones.style.display = 'flex';
            hideSpinner();
        });

        btnCsv.addEventListener('click', async () => {
            if (!await validarPremium()) return;
            const m = currentDate.getMonth(); const a = currentDate.getFullYear();
            window.location.href = `/api/finanzas/exportar-mensual?mes=${m}&anio=${a}`; // El navegador manda tu Cookie Segura automáticamente
        });
    };

    setTimeout(initExportButtons, 1500); // Esperar a que rendericen los gráficos en el DOM
});