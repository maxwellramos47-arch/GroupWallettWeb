// ajustes.js
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('usuarioToken');
    if (!token) {
        window.location.href = 'index.html';
        return; 
    }

    // --- Mostrar el nombre del usuario ---
    const nombreUsuario = localStorage.getItem('usuarioNombre');
    if (nombreUsuario) {
        document.querySelectorAll('.nav-profile').forEach(el => el.textContent = `Hola, ${nombreUsuario}`);
    }

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.status === 401) {
            localStorage.removeItem('usuarioToken');
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
            const tokenToRevoke = localStorage.getItem('usuarioToken');
            if (tokenToRevoke) {
                try {
                    await fetch('/api/usuarios/logout', { method: 'POST', headers: { 'Authorization': `Bearer ${tokenToRevoke}` } });
                } catch (err) {}
            }
            localStorage.removeItem('usuarioToken');
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
            
            if (perfil.id_plan === 2) {
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
            const payload = JSON.parse(atob(token.split('.')[1]));
            const idUsuario = payload.id_usuario;
            
            const res = await fetch(`/api/usuarios/${idUsuario}/banco`, { headers: { 'Authorization': `Bearer ${token}` } });
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

    cargarDatosBancarios();
});