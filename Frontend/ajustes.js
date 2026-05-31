// ajustes.js
document.addEventListener('DOMContentLoaded', async () => {
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
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
        let [resource, config] = args;
        if (!config) config = {};
        config.credentials = 'same-origin'; // Fuerza el envío de cookies HttpOnly siempre

        const response = await originalFetch(resource, config);
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            showToast('Tu sesión ha expirado por seguridad.', 'error');
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
                await fetch('/api/usuarios/logout', { method: 'POST' }); // La cookie se envía solita
            } catch (err) { console.error('Error cerrando sesión', err) }
            
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'login.html';
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

    // --- Medidor de Fuerza de Contraseña ---
    const pwInput = document.getElementById('perfil-password');
    const pwBar = document.getElementById('password-strength-bar');
    const pwText = document.getElementById('password-strength-text');

    if (pwInput && pwBar && pwText) {
        pwInput.addEventListener('input', (e) => {
            const val = e.target.value;
            if (!val) {
                pwBar.style.width = '0%';
                pwText.textContent = '';
                return;
            }
            let strength = 0;
            if (val.length >= 8) strength += 1;
            if (/[A-Z]/.test(val)) strength += 1;
            if (/[0-9]/.test(val)) strength += 1;
            if (/[^A-Za-z0-9]/.test(val)) strength += 1;

            if (strength <= 1) { pwBar.style.width = '25%'; pwBar.style.backgroundColor = 'var(--danger-color)'; pwText.textContent = 'Débil'; }
            else if (strength === 2) { pwBar.style.width = '50%'; pwBar.style.backgroundColor = '#f1c40f'; pwText.textContent = 'Regular'; }
            else if (strength === 3) { pwBar.style.width = '75%'; pwBar.style.backgroundColor = '#3498db'; pwText.textContent = 'Buena'; }
            else { pwBar.style.width = '100%'; pwBar.style.backgroundColor = 'var(--secondary-emerald)'; pwText.textContent = 'Fuerte'; }
        });
    }

    let eliminarFotoFlag = false;

    // Cargar perfil actual
    showSpinner();
    try {
        const res = await fetch('/api/usuarios/perfil', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const perfil = await res.json();
            document.getElementById('perfil-nombre').value = perfil.nombre;
            document.getElementById('perfil-correo').value = perfil.correo || 'No registrado';
            document.getElementById('perfil-telefono').value = perfil.telefono || 'No registrado';
            
            const btnEmail = document.getElementById('btn-agregar-correo');
            const btnPhone = document.getElementById('btn-agregar-telefono');
            if (!perfil.correo || !perfil.correo_verificado) btnEmail.style.display = 'block';
            if (!perfil.telefono || !perfil.telefono_verificado) btnPhone.style.display = 'block';

            if (perfil.id_plan === 2 || perfil.id_plan === 3) {
                const suscripcionContainer = document.getElementById('suscripcion-container');
                if (suscripcionContainer) suscripcionContainer.style.display = 'block';
            }
            
            if (perfil.foto_url) {
                const fotoPreview = document.getElementById('perfil-foto-preview');
                if (fotoPreview) fotoPreview.src = perfil.foto_url;
                const btnEliminarFoto = document.getElementById('btn-eliminar-foto');
                if (btnEliminarFoto) btnEliminarFoto.style.display = 'block';
            }

            if (perfil.correo) {
                const lblCorreo = document.getElementById('label-correo');
                if (lblCorreo) lblCorreo.innerHTML = `Correo Electrónico <span style="color: ${perfil.correo_verificado ? 'var(--secondary-emerald)' : 'var(--danger-color)'}; font-size: 0.8rem; font-weight: bold; margin-left: 0.5rem;">${perfil.correo_verificado ? '✔️ Verificado' : '⚠️ No verificado'}</span>`;
            }
            if (perfil.telefono) {
                const labelTelefono = document.getElementById('label-telefono');
                if (labelTelefono) {
                    if (perfil.telefono_verificado) {
                        labelTelefono.innerHTML = `Teléfono (Verificación por SMS) <span style="color: var(--secondary-emerald); font-size: 0.8rem; font-weight: bold; margin-left: 0.5rem;">✔️ Verificado</span>`;
                    } else {
                        labelTelefono.innerHTML = `Teléfono (Verificación por SMS) <span style="color: var(--danger-color); font-size: 0.8rem; font-weight: bold; margin-left: 0.5rem;">⚠️ No verificado</span>`;
                    }
                }
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

    const btnEliminarFoto = document.getElementById('btn-eliminar-foto');
    if (btnEliminarFoto) {
        btnEliminarFoto.addEventListener('click', () => {
            if (perfilFotoPreview) perfilFotoPreview.src = 'https://via.placeholder.com/60';
            if (perfilFotoInput) perfilFotoInput.value = '';
            btnEliminarFoto.style.display = 'none';
            eliminarFotoFlag = true;
        });
    }

    // --- Preferencias Locales ---
    const inputUmbralHormiga = document.getElementById('ajustes-umbral-hormiga');
    if (inputUmbralHormiga) {
        inputUmbralHormiga.value = localStorage.getItem(`umbralHormiga_${usuarioId}`) || 15;
    }
    
    const btnGuardarPreferencias = document.getElementById('btn-guardar-preferencias');
    if (btnGuardarPreferencias) {
        btnGuardarPreferencias.addEventListener('click', () => {
            const val = parseFloat(inputUmbralHormiga.value);
            if (!isNaN(val) && val > 0) {
                localStorage.setItem(`umbralHormiga_${usuarioId}`, val);
                showToast('Preferencia guardada exitosamente.', 'success');
            } else { showToast('Ingresa un monto válido para el umbral.', 'error'); }
        });
    }

    // --- Agregar Contacto Faltante ---
    const modalContacto = document.getElementById('modal-agregar-contacto');
    const btnEmail = document.getElementById('btn-agregar-correo');
    const btnPhone = document.getElementById('btn-agregar-telefono');
    let currentContactMethod = null;
    let tempContactToken = null;

    const openContactModal = (method) => {
        currentContactMethod = method;
        modalContacto.style.display = 'flex';
        document.getElementById('step-contacto-1').style.display = 'block';
        document.getElementById('step-contacto-2').style.display = 'none';
        document.getElementById('contacto-input').value = '';
        document.getElementById('contacto-codigo').value = '';
        
        if (method === 'email') {
            document.getElementById('modal-contacto-title').textContent = 'Agregar Correo';
            document.getElementById('contacto-input').placeholder = 'tu@correo.com';
        } else {
            document.getElementById('modal-contacto-title').textContent = 'Agregar Teléfono';
            document.getElementById('contacto-input').placeholder = '+569...';
        }
    };

    if (btnEmail) btnEmail.addEventListener('click', () => openContactModal('email'));
    if (btnPhone) btnPhone.addEventListener('click', () => openContactModal('sms'));
    document.getElementById('btn-cerrar-modal-contacto')?.addEventListener('click', () => modalContacto.style.display = 'none');

    document.getElementById('btn-enviar-codigo-contacto')?.addEventListener('click', async () => {
        const valor = document.getElementById('contacto-input').value;
        if (!valor) return;
        showSpinner();
        try {
            const isEmail = currentContactMethod === 'email';
            const url = isEmail ? '/api/usuarios/enviar-codigo-email' : '/api/usuarios/enviar-codigo-registro';
            const payload = isEmail ? { correo: valor } : { telefono: valor };
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json();
            if (res.ok) {
                tempContactToken = data.verificationToken;
                document.getElementById('step-contacto-1').style.display = 'none';
                document.getElementById('step-contacto-2').style.display = 'block';
                showToast('Código enviado', 'success');
            } else showToast(data.error, 'error');
        } catch (err) {} finally { hideSpinner(); }
    });

    document.getElementById('btn-verificar-contacto')?.addEventListener('click', async () => {
        const valor = document.getElementById('contacto-input').value;
        const codigo = document.getElementById('contacto-codigo').value;
        showSpinner();
        try {
            const res = await fetch('/api/usuarios/verificar-metodo-contacto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ metodo: currentContactMethod, valor, verificationToken: tempContactToken, codigo })
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, 'success');
                modalContacto.style.display = 'none';
                setTimeout(() => location.reload(), 1500);
            } else showToast(data.error, 'error');
        } catch (err) {} finally { hideSpinner(); }
    });

    document.getElementById('form-perfil').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('perfil-nombre').value;
        const password_actual = document.getElementById('perfil-password-actual').value;
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
        let foto_url_final = eliminarFotoFlag ? null : undefined;
        const archivoFoto = perfilFotoInput ? perfilFotoInput.files[0] : null;
        
        if (archivoFoto) {
            try {
                let archivoFinal = archivoFoto;
                
                // Súper-Compresión para fotos de perfil
                if (archivoFoto.type.startsWith('image/') && typeof imageCompression === 'function') {
                    const options = { maxSizeMB: 0.2, maxWidthOrHeight: 800, useWebWorker: true, fileType: 'image/webp' };
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
                        eliminarFotoFlag = false;
                        console.log('¡Foto subida a AWS S3 exitosamente! Ruta:', dataFirma.fileKey);
                    } else { showToast('Error al procesar la imagen en el Storage.', 'error'); }
                }
            } catch (err) { console.error('Error de subida:', err); }
        }

        try {
            const res = await fetch('/api/usuarios/perfil', {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre, telefono, foto_url: foto_url_final, password_actual, nueva_password: password, eliminar_foto: eliminarFotoFlag })
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
                    window.location.href = 'login.html';
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