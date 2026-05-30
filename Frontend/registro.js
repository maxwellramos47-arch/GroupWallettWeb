// registro.js
document.addEventListener('DOMContentLoaded', () => {
    const formRegister = document.getElementById('form-register');
    let captchaTokenActual = '';

    const cargarCaptcha = async () => {
        try {
            const res = await fetch('/api/usuarios/captcha');
            if (res.ok) {
                const data = await res.json();
                captchaTokenActual = data.token;
                
                let captchaDiv = document.getElementById('captcha-container');
                const btnSubmit = formRegister.querySelector('button[type="submit"]');
                
                if (!captchaDiv && btnSubmit) {
                    captchaDiv = document.createElement('div');
                    captchaDiv.id = 'captcha-container';
                    captchaDiv.style.marginBottom = '1rem';
                    btnSubmit.parentNode.insertBefore(captchaDiv, btnSubmit);
                }
                
                if (captchaDiv) {
                    captchaDiv.innerHTML = `
                        <label style="font-weight: bold; margin-bottom: 0.5rem; display: block;">Verificación Humana: ${data.question}</label>
                        <input type="number" id="registro-captcha" required placeholder="Tu respuesta" style="width: 100%; padding: 0.8rem; font-size: 1.05rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background-color: var(--bg-light);">
                    `;
                }
            }
        } catch (e) { console.error('Error cargando CAPTCHA', e); }
    };

    if (formRegister) cargarCaptcha();

    // Manejo de mostrar/ocultar contraseñas
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

    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('registro-nombre').value;
            const correo = document.getElementById('registro-correo').value;
            const telefono = document.getElementById('registro-telefono') ? document.getElementById('registro-telefono').value : null;
            const password = document.getElementById('registro-password').value;
            const confirmPassword = document.getElementById('registro-password-confirm').value;
            const tosCheckbox = document.getElementById('registro-tos');
            const captchaInput = document.getElementById('registro-captcha');
            const captchaAnswer = captchaInput ? captchaInput.value : null;

            // Validar que aceptó los Términos
            if (tosCheckbox && !tosCheckbox.checked) {
                showToast('Debes aceptar los Términos y Condiciones y la Política de Privacidad.', 'error');
                return;
            }

            // Validar que las contraseñas coincidan
            if (password !== confirmPassword) {
                showToast('Las contraseñas no coinciden. Inténtalo de nuevo.', 'error');
                return;
            }

            // Validar formato del teléfono (si fue ingresado)
            const regexTelefono = /^\+[1-9]\d{7,14}$/;
            if (telefono && telefono.trim() !== '' && !regexTelefono.test(telefono.trim())) {
                showToast('El teléfono debe incluir el código de país (Ej: +56912345678).', 'error');
                return;
            }

            showSpinner();
            try {
                const res = await fetch('/api/usuarios/registro', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, correo, telefono, password, captchaAnswer, captchaToken: captchaTokenActual })
                });
                const data = await res.json();
                
                if (res.ok) {
                    if (data.necesitaVerificacion) {
                        showToast('Registro casi listo. Verifica tu teléfono.', 'success');
                        const modal = document.getElementById('modal-verificacion-telefono');
                        if (modal) {
                            modal.style.display = 'flex';
                            const formVerificacion = document.getElementById('form-verificacion-telefono');
                            formVerificacion.onsubmit = async (eVerif) => {
                                eVerif.preventDefault();
                                const codigo = document.getElementById('codigo-verificacion').value;
                                await verificarTelefono(data.id_usuario, codigo);
                            };

                            const btnReenviar = document.getElementById('btn-reenviar-codigo');
                            if (btnReenviar) {
                                btnReenviar.onclick = async (eReenviar) => {
                                    eReenviar.preventDefault();
                                    const originalText = btnReenviar.textContent;
                                    btnReenviar.textContent = 'Enviando...';
                                    btnReenviar.style.pointerEvents = 'none';

                                    try {
                                        const resReenvio = await fetch('/api/usuarios/reenviar-codigo', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id_usuario: data.id_usuario })
                                        });
                                        const dataReenvio = await resReenvio.json();
                                        if (resReenvio.ok) showToast(dataReenvio.message, 'success');
                                        else showToast(dataReenvio.error, 'error');
                                    } catch (err) { showToast('Error de red al reenviar el código.', 'error'); } 
                                    finally {
                                        setTimeout(() => { btnReenviar.textContent = originalText; btnReenviar.style.pointerEvents = 'auto'; }, 10000); // Aumentar a 10s para evitar spam
                                    }
                                };
                            }
                        }
                    } else {
                        showToast('Registro exitoso. Redirigiendo...', 'success');
                        setTimeout(() => {
                            // Pasamos el correo a la página de login para autocompletar
                            window.location.href = `login.html?correo=${encodeURIComponent(correo)}`;
                        }, 1500);
                    }
                } else {
                    showToast(data.error || 'Error al registrar', 'error');
                    cargarCaptcha(); // Refrescar el CAPTCHA si falló el registro
                    if (document.getElementById('registro-captcha')) document.getElementById('registro-captcha').value = '';
                }
            } catch (error) {
                console.error(error);
                showToast('Error de conexión al intentar registrarse.', 'error');
            } finally {
                hideSpinner();
            }
        });
    }

    async function verificarTelefono(id_usuario, codigo) {
        showSpinner();
        try {
            const res = await fetch('/api/usuarios/verificar-telefono', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_usuario, codigo })
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, 'success');
                setTimeout(() => window.location.href = 'login.html', 2000);
            } else {
                showToast(data.error, 'error');
            }
        } catch (error) { showToast('Error de conexión.', 'error'); } 
        finally { hideSpinner(); }
    }
});