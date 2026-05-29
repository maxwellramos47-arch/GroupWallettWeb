document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('usuarioToken');
    if (!token) {
        window.location.href = 'index.html';
        return; 
    }

    showSpinner();
    try {
        const response = await fetch('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('stat-usuarios').textContent = data.total_usuarios;
            document.getElementById('stat-premium').textContent = data.usuarios_premium;
            document.getElementById('stat-ganancia').textContent = `$${data.ganancia_estimada.toFixed(2)}`;
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

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${u.id_usuario}</td>
                        <td><strong>${u.nombre}</strong></td>
                        <td>${u.correo}</td>
                        <td>${rolActual}</td>
                        <td>
                            <select class="select-rol" data-id="${u.id_usuario}" style="padding: 0.3rem; border-radius: 4px; font-size: 0.85rem; max-width: 150px; display: inline-block;">
                                <option value="" disabled selected>Cambiar...</option>
                                <option value="FREE">Básico (Free)</option>
                                <option value="PREMIUM">Premium</option>
                                <option value="GOD_MODE">Súper Admin</option>
                            </select>
                        </td>
                        <td>
                            <button class="btn-forzar-logout" data-id="${u.id_usuario}" style="background-color: var(--danger-color); color: white; border: none; padding: 0.3rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">Cerrar Sesión</button>
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