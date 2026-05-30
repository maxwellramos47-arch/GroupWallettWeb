// historial.js
document.addEventListener('DOMContentLoaded', async () => {
    // --- 0. Protección de Ruta ---
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'index.html';
        return; 
    }
    const token = 'http-only-cookie'; // Mantiene compatibilidad con fetch

    // --- Mostrar el nombre del usuario ---
    const nombreUsuario = localStorage.getItem('usuarioNombre');
    if (nombreUsuario) {
        document.querySelectorAll('.nav-profile').forEach(el => el.textContent = `Hola, ${nombreUsuario}`);
    }

    // --- Extraer configuración de moneda ---
    const miIdUsuarioGlobal = usuarioId.toString();
    const moneda = localStorage.getItem(`moneda_${miIdUsuarioGlobal}`) || '$';

    // Interceptor Global de Fetch para expirar token
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        let [resource, config] = args;
        if (!config) config = {};
        config.credentials = 'same-origin'; // Fuerza el envío de cookies HttpOnly siempre

        const response = await originalFetch(resource, config);
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            showToast('Tu sesión ha expirado por seguridad.', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return Promise.reject(new Error('Sesión expirada'));
        }
        return response;
    };

    // --- 1. Logout ---
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/api/usuarios/logout', { method: 'POST' }); // La cookie se envía solita
            } catch (err) { console.error('Error cerrando sesión', err); }
            
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'index.html';
        });
    }

    // --- 2. Cargar Historial ---
    const listaHistorial = document.getElementById('lista-historial');
    let datosHistorial = []; // Almacenará los datos crudos
    let historialChartInstance = null;

    let sortColumn = 'fecha_archivado';
    let sortAsc = false;

    // Convertir las cabeceras en ordenables dinámicamente
    const tablaHistorial = listaHistorial.closest('table');
    if (tablaHistorial) {
        tablaHistorial.id = 'tabla-historial';
        const theadTr = tablaHistorial.querySelector('thead tr');
        if (theadTr && !theadTr.querySelector('.sortable')) {
            theadTr.innerHTML = `
                <th class="sortable" data-sort="fecha_gasto" style="cursor: pointer; user-select: none;">Fecha Gasto ↕️</th>
                <th class="sortable" data-sort="fecha_archivado" style="cursor: pointer; user-select: none;">Archivado 🔽</th>
                <th class="sortable" data-sort="nombre_grupo" style="cursor: pointer; user-select: none;">Grupo ↕️</th>
                <th class="sortable" data-sort="descripcion" style="cursor: pointer; user-select: none;">Descripción ↕️</th>
                <th class="sortable" data-sort="pagador_nombre" style="cursor: pointer; user-select: none;">Pagador ↕️</th>
                <th class="sortable" data-sort="monto" style="cursor: pointer; user-select: none;">Monto ↕️</th>
            `;
        }
    }

    document.querySelectorAll('#tabla-historial th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (sortColumn === col) {
                sortAsc = !sortAsc;
            } else {
                sortColumn = col;
                sortAsc = true;
            }
            document.querySelectorAll('#tabla-historial th.sortable').forEach(h => {
                h.textContent = h.textContent.replace(/ 🔼| 🔽| ↕️/, ' ↕️');
            });
            th.textContent = th.textContent.replace(/ ↕️| 🔼| 🔽/, sortAsc ? ' 🔼' : ' 🔽');
            renderizarHistorial();
        });
    });

    function showSkeletonLoader(tableBody, columns, rows = 8) {
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

    const renderizarHistorial = () => {
        const filtroDesc = document.getElementById('filtro-desc').value.toLowerCase();
        const filtroInicio = document.getElementById('filtro-fecha-inicio').value;
        const filtroFin = document.getElementById('filtro-fecha-fin').value;
        
        listaHistorial.innerHTML = '';
        const totalesPorPagador = {};

        let datosFiltrados = datosHistorial.filter(h => {
            const partesFecha = h.fecha_gasto.split('/');
            const fechaGasto = new Date(`${partesFecha[2]}-${partesFecha[1]}-${partesFecha[0]}T00:00:00`);
            const pasaFiltroDesc = h.descripcion.toLowerCase().includes(filtroDesc);
            let pasaFiltroInicio = true;
            if (filtroInicio) pasaFiltroInicio = fechaGasto >= new Date(`${filtroInicio}T00:00:00`);
            let pasaFiltroFin = true;
            if (filtroFin) pasaFiltroFin = fechaGasto <= new Date(`${filtroFin}T23:59:59`);
            
            return pasaFiltroDesc && pasaFiltroInicio && pasaFiltroFin;
        });

        datosFiltrados.sort((a, b) => {
            let valA = a[sortColumn];
            let valB = b[sortColumn];
            if (sortColumn === 'fecha_gasto' || sortColumn === 'fecha_archivado') {
                valA = new Date(valA.split('/').reverse().join('-')).getTime();
                valB = new Date(valB.split('/').reverse().join('-')).getTime();
            }
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return sortAsc ? -1 : 1;
            if (valA > valB) return sortAsc ? 1 : -1;
            return 0;
        });
        
        datosFiltrados.forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${h.fecha_gasto}</td><td>${h.fecha_archivado}</td><td><span style="font-weight: 500;">${h.nombre_grupo}</span></td><td>${h.descripcion}${h.comprobante_url ? ` <a href="#" onclick="event.preventDefault(); window.openReceiptModal('${h.comprobante_url}')" title="Ver Comprobante" style="text-decoration: none; font-size: 1.1rem; margin-left: 0.3rem;">📎</a>` : ''}</td><td>${h.pagador_nombre}</td><td>${moneda}${h.monto.toFixed(2)}</td>`;
            listaHistorial.appendChild(tr);
            totalesPorPagador[h.pagador_nombre] = (totalesPorPagador[h.pagador_nombre] || 0) + h.monto;
        });

        // Renderizar gráfico para el PDF
        const ctx = document.getElementById('historialChart');
        const chartContainer = document.getElementById('chart-historial-container');
        if (ctx && Object.keys(totalesPorPagador).length > 0) {
            chartContainer.style.display = 'block';
            if (historialChartInstance) historialChartInstance.destroy();
            historialChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: Object.keys(totalesPorPagador),
                    datasets: [{
                        data: Object.values(totalesPorPagador),
                        backgroundColor: ['#2ecc71', '#3498db', '#f1c40f', '#e74c3c', '#9b59b6', '#34495e']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, animation: false } // animation: false es vital para el PDF
            });
        } else if (chartContainer) {
            chartContainer.style.display = 'none';
        }
    };

    // Inyectar los filtros dinámicamente antes de la tabla
    const tableResponsive = listaHistorial.closest('.table-responsive');
    if (tableResponsive) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
        const hotkey = isMac ? 'Cmd+K' : 'Ctrl+K';

        const controlesDiv = document.createElement('div');
        controlesDiv.innerHTML = `
            <div style="display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap;">
                <input type="text" id="filtro-desc" placeholder="Buscar por descripción... (${hotkey})" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;">
                <input type="date" id="filtro-fecha-inicio" title="Fecha inicio" style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;">
                <input type="date" id="filtro-fecha-fin" title="Fecha límite" style="padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;">
            </div>
        `;
        tableResponsive.parentNode.insertBefore(controlesDiv, tableResponsive);
        
        document.getElementById('filtro-desc').addEventListener('input', renderizarHistorial);
        document.getElementById('filtro-fecha-inicio').addEventListener('change', renderizarHistorial);
        document.getElementById('filtro-fecha-fin').addEventListener('change', renderizarHistorial);
    }

    // --- Atajo de teclado (Ctrl + K / Cmd + K) para búsqueda rápida ---
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            const inputBuscar = document.getElementById('filtro-desc');
            if (inputBuscar) {
                inputBuscar.focus();
                inputBuscar.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    showSkeletonLoader(listaHistorial, 6);
    try {
        const response = await fetch('/api/historial', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Error al cargar historial');
        
        const archivados = await response.json();
        datosHistorial = archivados;
        renderizarHistorial(); // Renderizar por primera vez con los filtros vacíos
    } catch (error) { console.error(error); }

    // --- 3. Cargar Grupos para Exportación ---
    try {
        const reqGrupos = await fetch('/api/grupos', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (reqGrupos.ok) {
            const grupos = await reqGrupos.json();
            const selectExportar = document.getElementById('grupo-exportar');
            if (selectExportar) {
                grupos.forEach(g => {
                    selectExportar.innerHTML += `<option value="${g.id_grupo}">${g.nombre_grupo}</option>`;
                });
            }
        }
    } catch (e) { console.error(e); }

    // --- 4. Descargar Reporte (CSV) ---
    const btnExportar = document.getElementById('btn-exportar');
    if (btnExportar) {
        btnExportar.addEventListener('click', async () => {
            const idGrupo = document.getElementById('grupo-exportar').value;
            if (!idGrupo) {
                showToast('Por favor, selecciona un grupo para exportar su historial.', 'error');
                return;
            }

            showSpinner();
            try {
                const response = await fetch(`/api/historial/exportar/${idGrupo}`);
                
                if (response.status === 403) {
                    const data = await response.json();
                    if (data.requires_upgrade) {
                        showToast('La exportación a Excel es exclusiva de Premium. Descubre sus beneficios...', 'info');
                        setTimeout(() => window.location.href = 'dashboard.html?showUpgrade=true', 2500);
                        return;
                    }
                }

                if (!response.ok) throw new Error('Error en la descarga');

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Reporte_Gastos_Grupo_${idGrupo}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } catch (error) {
                console.error(error);
                showToast('Ocurrió un error al intentar exportar el historial.', 'error');
            } finally {
                hideSpinner();
            }
        });
    }

    // --- 5. Descargar Reporte (PDF) ---
    if (btnExportar) {
        // Cargar librería html2pdf dinámicamente
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        document.head.appendChild(script);

        // Crear e inyectar el botón de PDF dinámicamente
        const btnExportarPdf = document.createElement('button');
        btnExportarPdf.type = 'button';
        btnExportarPdf.className = 'btn-primary';
        btnExportarPdf.style.backgroundColor = 'var(--danger-color)'; // Botón en color rojo
        btnExportarPdf.style.marginTop = '0.5rem';
        btnExportarPdf.textContent = 'Exportar a PDF';
        
        // Insertarlo justo después del botón de CSV
        btnExportar.parentNode.insertBefore(btnExportarPdf, btnExportar.nextSibling);

        btnExportarPdf.addEventListener('click', async () => {
            showSpinner();
            try {
                const res = await fetch('/api/usuarios/perfil');
                if (res.ok) {
                    const perfil = await res.json();
                    if (perfil.id_plan !== 2 && perfil.estado_suscripcion !== 'GOD_MODE') {
                        hideSpinner();
                        showToast('La exportación a PDF es exclusiva de Premium. Descubre sus beneficios...', 'info');
                        setTimeout(() => window.location.href = 'dashboard.html?showUpgrade=true', 2500);
                        return;
                    }
                }
            } catch (err) { console.error('Error al verificar suscripción:', err); }
            hideSpinner();

            const element = document.getElementById('pdf-export-area'); // Elemento a convertir (Tabla + Gráfico)
            
            if (element && window.html2pdf) {
                const opt = {
                    margin: 0.3,
                    filename: `Reporte_Gastos.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true },
                    jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' } // Horizontal para que la tabla encaje bien
                };
                html2pdf().set(opt).from(element).save();
            } else {
                showToast('La librería PDF aún se está cargando. Intenta nuevamente en un segundo.', 'error');
            }
        });
    }
});