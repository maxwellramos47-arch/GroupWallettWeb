document.addEventListener('DOMContentLoaded', async () => {
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
        return; 
    }
    const token = 'http-only-cookie'; // Dummy para mantener compatibilidad

    // --- Interceptor Global de Fetch ---
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.status === 401) {
            localStorage.removeItem('usuarioToken');
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
            
            localStorage.removeItem('usuarioToken');
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'login.html';
        });
    }

    // --- Cargar Gráfico de Evolución ---
    const cargarGraficoEvolucion = async () => {
        const canvas = document.getElementById('admin-growth-chart');
        if (!canvas) return;
        try {
            const res = await fetch('/api/admin/chart-data', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [
                            { label: 'MRR ($ CLP)', data: data.mrr, borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.2)', fill: true, tension: 0.4, yAxisID: 'y' },
                            { label: 'CAC ($ CLP)', data: data.cac, borderColor: '#e67e22', backgroundColor: '#e67e22', type: 'bar', borderRadius: 4, yAxisID: 'y1' }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        scales: {
                            y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Ingreso Recurrente (MRR)' } },
                            y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Costo Adquisición (CAC)' }, grid: { drawOnChartArea: false } }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: { label: (context) => `${context.dataset.label}: $${context.raw.toLocaleString('es-CL')}` }
                            }
                        }
                    }
                });
            }
        } catch (error) { console.error('Error cargando gráfico:', error); }
    };

    showSpinner();
    try {
        const response = await fetch('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            // --- Cargar Métricas SaaS ---
            if (data.saas_metrics) {
                document.getElementById('stat-mrr').textContent = `$${data.saas_metrics.mrr.toLocaleString('es-CL')}`;
                document.getElementById('stat-churn').textContent = `${data.saas_metrics.churn_rate.toFixed(1)}%`;
                document.getElementById('stat-ltv').textContent = `$${data.saas_metrics.ltv.toLocaleString('es-CL')}`;
                document.getElementById('stat-cac').textContent = `$${data.saas_metrics.cac.toLocaleString('es-CL')}`;
                document.getElementById('stat-burn').textContent = `$${data.saas_metrics.burn_rate.toLocaleString('es-CL')}`;
            }
            
            // Actualizar Métricas de Servidor y Tráfico
            if (data.server_metrics) {
                const statReq = document.getElementById('stat-requests');
                const statUp = document.getElementById('stat-uptime');
                const statRam = document.getElementById('stat-ram');
                if (statReq) statReq.textContent = data.server_metrics.total_requests;
                if (statUp) statUp.textContent = `${data.server_metrics.uptime_minutes} min`;
                if (statRam) statRam.textContent = `${data.server_metrics.ram_mb} MB`;
            }

            cargarGraficoEvolucion();
            showToast('Métricas actualizadas exitosamente.', 'success');
        } else {
            // Si no es God Mode, la API devolverá 403 y lo sacamos de aquí
            showToast(data.error || 'Acceso denegado. Modo incógnito activado.', 'error');
            setTimeout(() => window.location.href = 'dashboard.html', 2000);
        }
    } catch (error) {
        console.error(error);
        showToast('Error al conectar con la base de datos.', 'error');
    } finally {
        hideSpinner();
    }

    // --- Visor de Logs ---
    const btnCargarLogs = document.getElementById('btn-cargar-logs');
    const btnLimpiarLogs = document.getElementById('btn-limpiar-logs');
    const logViewer = document.getElementById('log-viewer');

    const cargarLogs = async () => {
        if (!logViewer) return;
        try {
            const res = await fetch('/api/admin/logs', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const logs = await res.text();
                logViewer.textContent = logs;
                logViewer.scrollTop = logViewer.scrollHeight; // Auto-scroll al final
            } else { logViewer.textContent = 'Error al cargar los logs.'; }
        } catch (error) { logViewer.textContent = 'Error de conexión al cargar logs.'; }
    };

    if (btnCargarLogs) {
        btnCargarLogs.addEventListener('click', async () => { btnCargarLogs.textContent = 'Cargando...'; await cargarLogs(); btnCargarLogs.textContent = '🔄 Actualizar Logs'; });
        cargarLogs(); // Carga automática al entrar
    }

    if (btnLimpiarLogs) {
        btnLimpiarLogs.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de que deseas vaciar el archivo de logs?')) return;
            btnLimpiarLogs.textContent = 'Limpiando...';
            try {
                const res = await fetch('/api/admin/logs', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) { showToast('Logs limpiados.', 'success'); await cargarLogs(); }
            } catch (error) { showToast('Error de red', 'error'); }
            btnLimpiarLogs.textContent = '🗑️ Limpiar Logs';
        });
    }

    // --- Registro de Gastos de Marketing (Cálculo Dinámico de CAC) ---
    const formMarketing = document.getElementById('form-admin-marketing');
    if (formMarketing) {
        formMarketing.addEventListener('submit', async (e) => {
            e.preventDefault();
            const descripcion = document.getElementById('mkt-desc').value;
            const monto = document.getElementById('mkt-monto').value;
            
            showSpinner();
            try {
                const res = await fetch('/api/admin/marketing', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ descripcion, monto })
                });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message, 'success');
                    formMarketing.reset();
                    setTimeout(() => location.reload(), 1500); // Recargar para ver CAC actualizado
                } else showToast(data.error, 'error');
            } catch (err) { showToast('Error de conexión', 'error'); } finally { hideSpinner(); }
        });
    }

    // --- Exportar Base de Correos ---
    const btnExportarCorreos = document.getElementById('btn-exportar-correos');
    if (btnExportarCorreos) {
        btnExportarCorreos.addEventListener('click', async () => {
            showSpinner();
            try {
                const response = await fetch('/api/admin/exportar-correos', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (!response.ok) throw new Error('Error al descargar la base de correos.');
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Base_Usuarios_Marketing.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                showToast('Descarga completada.', 'success');
            } catch (error) { showToast(error.message, 'error'); } finally { hideSpinner(); }
        });
    }

    // --- Gestión de Usuarios y Roles ---
    const listaAdminUsuarios = document.getElementById('lista-admin-usuarios');
    
    const cargarUsuariosAdmin = async () => {
        try {
            const res = await fetch('/api/admin/usuarios', { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const usuarios = await res.json();
                listaAdminUsuarios.innerHTML = '';
                usuarios.forEach(u => {
                    let rolActual = 'Básico (Free)';
                    if (u.estado_suscripcion === 'GOD_MODE') rolActual = '👑 Súper Admin';
                    else if (u.id_plan === 2) rolActual = '⭐ Premium';
                    
                    const estaBloqueado = u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();
                    const estadoHtml = estaBloqueado ? `<br><span style="color: var(--danger-color); font-size: 0.8rem; font-weight: bold;">Bloqueado</span>` : '';

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${u.id_usuario}</td>
                        <td><strong>${u.nombre}</strong></td>
                        <td>${u.correo}</td>
                        <td>${rolActual}${estadoHtml}</td>
                        <td>
                            <select class="select-rol" data-id="${u.id_usuario}" style="padding: 0.3rem; border-radius: 4px; font-size: 0.85rem; max-width: 150px; display: inline-block;">
                                <option value="" disabled selected>Cambiar...</option>
                                <option value="FREE">Básico (Free)</option>
                                <option value="PREMIUM">Premium</option>
                                <option value="GOD_MODE">Súper Admin</option>
                            </select>
                        </td>
                        <td>
                            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                                <button class="btn-forzar-logout" data-id="${u.id_usuario}" style="background-color: var(--primary-slate); color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Expulsar/Logout</button>
                                ${estaBloqueado 
                                    ? `<button class="btn-bloquear" data-id="${u.id_usuario}" data-horas="0" style="background-color: #27ae60; color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Desbloquear</button>`
                                    : `<button class="btn-bloquear" data-id="${u.id_usuario}" data-horas="24" style="background-color: var(--danger-color); color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Bloquear 24h</button>`
                                }
                            </div>
                        </td>
                    `;
                    listaAdminUsuarios.appendChild(tr);
                });
            }
        } catch (error) { console.error('Error cargando usuarios:', error); }
    };

    if (listaAdminUsuarios) {
        cargarUsuariosAdmin();

        listaAdminUsuarios.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-forzar-logout')) {
                const idUsuario = e.target.getAttribute('data-id');
                
                if (!confirm('¿Estás seguro de forzar el cierre de sesión de este usuario? Si está conectado, será expulsado inmediatamente.')) return;

                showSpinner();
                try {
                    const res = await fetch(`/api/admin/usuarios/${idUsuario}/forzar-logout`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(data.message, 'success');
                    } else {
                        showToast(data.error, 'error');
                    }
                } catch (error) { showToast('Error de conexión', 'error'); } finally { hideSpinner(); }
            }
        });

        listaAdminUsuarios.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-bloquear')) {
                const idUsuario = e.target.getAttribute('data-id');
                const horas = parseInt(e.target.getAttribute('data-horas'));
                
                const accion = horas === 0 ? 'desbloquear' : `bloquear por ${horas} horas`;
                if (!confirm(`¿Estás seguro de que deseas ${accion} a este usuario?`)) return;

                showSpinner();
                try {
                    const res = await fetch(`/api/admin/usuarios/${idUsuario}/bloquear`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ horas })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(data.message, 'success');
                        cargarUsuariosAdmin(); // Recargar la tabla
                    } else showToast(data.error, 'error');
                } catch (error) { showToast('Error de conexión', 'error'); } finally { hideSpinner(); }
            }
        });

        listaAdminUsuarios.addEventListener('change', async (e) => {
            if (e.target.classList.contains('select-rol')) {
                const idUsuario = e.target.getAttribute('data-id');
                const nuevoRol = e.target.value;
                
                if (!confirm(`¿Estás seguro de cambiar el rol de este usuario a ${nuevoRol}?`)) {
                    e.target.value = ''; // Resetear el select
                    return;
                }

                showSpinner();
                try {
                    const res = await fetch(`/api/admin/usuarios/${idUsuario}/rol`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nuevo_rol: nuevoRol })
                    });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(data.message, 'success');
                        setTimeout(() => location.reload(), 1500); // Recargamos para actualizar las métricas
                    } else {
                        showToast(data.error, 'error');
                        e.target.value = '';
                    }
                } catch (error) { showToast('Error de conexión', 'error'); e.target.value = ''; } finally { hideSpinner(); }
            }
        });
    }
});