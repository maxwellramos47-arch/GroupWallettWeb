// ajustes.js
document.addEventListener('DOMContentLoaded', async () => {
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'index.html';
        return; 
    }
    const token = 'http-only-cookie'; // Mantiene compatibilidad

    // --- Mostrar el nombre del usuario ---
    const nombreUsuario = localStorage.getItem('usuarioNombre');
    if (nombreUsuario) {
        document.querySelectorAll('.nav-profile').forEach(el => el.textContent = `Hola, ${nombreUsuario}`);
    }

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            showToast('Tu sesión ha expirado por seguridad.', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
            return Promise.reject(new Error('Sesión expirada'));
        }
        return response;
    };

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/api/usuarios/logout', { method: 'POST' }); // La cookie se envía solita
            } catch (err) { console.error('Error cerrando sesión', err) }
            
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'index.html';
        });
    }

    // --- Manejo de Mostrar/Ocultar Contraseña ---
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-password');
        if (btn) {
            const input = btn.previousElementSibling;
            if (input && input.tagName === 'INPUT') {
                const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
                input.setAttribute('type', type);
                btn.textContent = type === 'password' ? '👁️' : '🙈';
            }
        }
    });

    // Cargar perfil actual
    showSpinner();
    try {
        const res = await fetch('/api/usuarios/perfil', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const perfil = await res.json();
            document.getElementById('perfil-nombre').value = perfil.nombre;
            document.getElementById('perfil-telefono').value = perfil.telefono || '';
            
            if (perfil.estado_suscripcion) {
                const suscripcionContainer = document.getElementById('suscripcion-container');
                if (suscripcionContainer) suscripcionContainer.style.display = 'block';
            }
            
            if (perfil.foto_url) {
                const fotoPreview = document.getElementById('perfil-foto-preview');
                if (fotoPreview) fotoPreview.src = perfil.foto_url;
            }
        }
    } catch (error) { console.error('Error al cargar perfil:', error); } finally { hideSpinner(); }

    const perfilFotoInput = document.getElementById('perfil-foto');
    const perfilFotoPreview = document.getElementById('perfil-foto-preview');
    if (perfilFotoInput && perfilFotoPreview) {
        perfilFotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                perfilFotoPreview.src = URL.createObjectURL(file);
            }
        });
    }

    document.getElementById('form-perfil').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('perfil-nombre').value;
        const telefono = document.getElementById('perfil-telefono').value;
        const password = document.getElementById('perfil-password').value;

        if (password && password.trim() !== '') {
            const regexSeguridad = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
            if (!regexSeguridad.test(password)) {
                showToast('La nueva contraseña debe tener al menos 8 caracteres, incluir una mayúscula y un número.', 'error');
                return;
            }
        }

        showSpinner();
        
        let fileKey = null;
        let foto_url_final = null;
        const archivoFoto = perfilFotoInput ? perfilFotoInput.files[0] : null;
        
        if (archivoFoto) {
            try {
                let archivoFinal = archivoFoto;
                
                // Súper-Compresión para fotos de perfil
                if (archivoFoto.type.startsWith('image/') && typeof imageCompression === 'function') {
                    const options = { maxSizeMB: 0.5, maxWidthOrHeight: 800, useWebWorker: true };
                    archivoFinal = await imageCompression(archivoFoto, options);
                }

                const resFirma = await fetch(`/api/upload/presigned-url?type=${encodeURIComponent(archivoFinal.type)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resFirma.ok) {
                    const dataFirma = await resFirma.json();
                    const resUpload = await fetch(dataFirma.url, {
                        method: 'PUT',
                        body: archivoFinal,
                        headers: { 'Content-Type': archivoFinal.type }
                    });
                    if (resUpload.ok) {
                    foto_url_final = dataFirma.publicUrl;
                        console.log('¡Foto subida a AWS S3 exitosamente! Ruta:', dataFirma.fileKey);
                    } else { showToast('Error al procesar la imagen en el Storage.', 'error'); }
                }
            } catch (err) { console.error('Error de subida:', err); }
        }

        try {
            const res = await fetch('/api/usuarios/perfil', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, telefono, foto_url: foto_url_final, password })
            });
            if (res.ok) {
                showToast('Perfil actualizado exitosamente.', 'success');
                localStorage.setItem('usuarioNombre', nombre);
                document.querySelectorAll('.nav-profile').forEach(el => el.textContent = `Hola, ${nombre}`);
            } else showToast((await res.json()).error, 'error');
        } catch (error) { console.error(error); } finally { hideSpinner(); }
    });

    // --- Cargar Datos Bancarios ---
    const cargarDatosBancarios = async () => {
        try {
            
            const res = await fetch(`/api/usuarios/${usuarioId}/banco`); // La cookie se adjunta sola gracias a credentials (ver server.js)
            if (res.ok) {
                const datos = await res.json();
                document.getElementById('banco-rut').value = datos.rut || '';
                document.getElementById('banco-nombre').value = datos.banco || '';
                document.getElementById('banco-tipo').value = datos.tipo_cuenta || '';
                document.getElementById('banco-numero').value = datos.numero_cuenta || '';
                document.getElementById('banco-correo').value = datos.correo || '';
            }
        } catch (error) { console.error('Error al cargar datos bancarios:', error); }
    };

    // --- Formateador Automático de RUT Chileno ---
    const inputRut = document.getElementById('banco-rut');
    if (inputRut) {
        inputRut.addEventListener('input', (e) => {
            let valor = e.target.value.replace(/[^0-9kK]/g, '').toUpperCase();
            
            if (valor.length > 1) {
                let cuerpo = valor.slice(0, -1);
                let dv = valor.slice(-1);
                cuerpo = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                e.target.value = `${cuerpo}-${dv}`;
            } else {
                e.target.value = valor;
            }
        });
    }

    // --- Guardar Datos Bancarios ---
    const formBanco = document.getElementById('form-banco');
    if (formBanco) {
        formBanco.addEventListener('submit', async (e) => {
            e.preventDefault();
            const rut = document.getElementById('banco-rut').value;
            const banco = document.getElementById('banco-nombre').value;
            const tipo_cuenta = document.getElementById('banco-tipo').value;
            const numero_cuenta = document.getElementById('banco-numero').value;
            const correo = document.getElementById('banco-correo').value;

            if (!rut || !numero_cuenta) return showToast('Debes proporcionar al menos tu RUT y un Número de Cuenta.', 'error');

            showSpinner();
            try {
                const res = await fetch('/api/usuarios/banco', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rut, banco, tipo_cuenta, numero_cuenta, correo })
                });
                const data = await res.json();
                if (res.ok) showToast(data.message, 'success');
                else showToast(data.error || 'Error al guardar datos bancarios.', 'error');
            } catch (error) { console.error(error); showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
        });
    }

    // --- Cancelar Suscripción Premium ---
    const btnCancelarSuscripcion = document.getElementById('btn-cancelar-suscripcion');
    if (btnCancelarSuscripcion) {
        btnCancelarSuscripcion.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de que deseas cancelar tu suscripción Premium? Perderás acceso a las funciones exclusivas de inmediato.')) return;
            
            showSpinner();
            try {
                const response = await fetch('/api/suscripciones/cancelar', {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (response.ok) {
                    showToast(data.message, 'success');
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    showToast(data.error || 'Error al cancelar suscripción.', 'error');
                }
            } catch (error) { console.error(error); showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
        });
    }

    // --- Cerrar Sesión en Todos los Dispositivos ---
    const btnLogoutAll = document.getElementById('btn-logout-all');
    if (btnLogoutAll) {
        btnLogoutAll.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro? Esto cerrará tu sesión actual y la de cualquier otro dispositivo donde estés conectado.')) return;
            
            showSpinner();
            try {
                const response = await fetch('/api/usuarios/logout-all', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    localStorage.removeItem('usuarioId');
                    localStorage.removeItem('usuarioNombre');
                    window.location.href = 'index.html';
                } else showToast((await response.json()).error, 'error');
            } catch (error) { showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
        });
    }

    // --- Cargar Sesiones Activas (Dispositivos Conectados) ---
    const cargarSesionesActivas = async () => {
        const listaSesiones = document.getElementById('lista-sesiones');
        if (!listaSesiones) return;

        try {
            const response = await fetch('/api/usuarios/sesiones');
            if (response.ok) {
                const sesiones = await response.json();
                listaSesiones.innerHTML = '';
                
                sesiones.forEach(s => {
                    const tr = document.createElement('tr');
                    const isActual = s.es_actual ? '<span style="background: var(--secondary-emerald); color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.5rem;">Actual</span>' : '';
                    const fechaAcceso = new Date(s.ultimo_acceso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

                    tr.innerHTML = `
                        <td><strong style="color: var(--primary-slate);">${s.dispositivo}</strong> ${isActual}</td>
                        <td>${s.ip}</td>
                        <td>${fechaAcceso}</td>
                        <td>
                            ${!s.es_actual ? `<button class="btn-primary btn-cerrar-sesion" data-id="${s.id_sesion}" style="background-color: var(--danger-color); padding: 0.3rem 0.6rem; font-size: 0.75rem; width: auto; margin: 0;">Desconectar</button>` : '-'}
                        </td>
                    `;
                    listaSesiones.appendChild(tr);
                });
            }
        } catch (error) { console.error('Error al cargar sesiones:', error); }
    };

    // Manejar el evento de Desconectar dispositivo específico
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-cerrar-sesion')) {
            const idSesion = e.target.getAttribute('data-id');
            if (!confirm('¿Estás seguro de desconectar este dispositivo? Su sesión se cerrará inmediatamente.')) return;
            
            showSpinner();
            try {
                const res = await fetch(`/api/usuarios/sesiones/${idSesion}`, { method: 'DELETE' });
                if (res.ok) { showToast('Dispositivo desconectado.', 'success'); cargarSesionesActivas(); }
                else { showToast((await res.json()).error, 'error'); }
            } catch (err) { showToast('Error de red', 'error'); } finally { hideSpinner(); }
        }
    });

    cargarDatosBancarios();
    cargarSesionesActivas();
});