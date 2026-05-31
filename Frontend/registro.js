// registro.js
document.addEventListener('DOMContentLoaded', () => {
    const formRegister = document.getElementById('form-register');
    let captchaTokenActual = '';
    let pendingRegistrationData = null;
    let currentVerificationToken = null;
    let selectedMethod = null;

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
                        <label style="font-weight: bold; margin-bottom: 0.5rem; display: block;">CAPTCHA: ${data.question}</label>
                        <input type="number" id="registro-captcha" required placeholder="Tu respuesta" style="width: 100%; padding: 0.8rem; font-size: 1.05rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background-color: var(--bg-light);">
                    `;
                }
            }
        } catch (e) { console.error('Error cargando CAPTCHA', e); }
    };

    if (formRegister) cargarCaptcha();

    const methodSelection = document.getElementById('method-selection');
    const btnMethodEmail = document.getElementById('btn-method-email');
    const btnMethodSms = document.getElementById('btn-method-sms');
    const btnBackMethod = document.getElementById('btn-back-method');
    const groupCorreo = document.getElementById('group-correo');
    const groupTelefono = document.getElementById('group-telefono');

    const selectMethod = (method) => {
        selectedMethod = method;
        methodSelection.style.display = 'none';
        formRegister.style.display = 'block';
        if (method === 'email') {
            groupCorreo.style.display = 'block';
            document.getElementById('registro-correo').required = true;
            groupTelefono.style.display = 'none';
            document.getElementById('registro-telefono').required = false;
        } else {
            groupTelefono.style.display = 'block';
            document.getElementById('registro-telefono').required = true;
            groupCorreo.style.display = 'none';
            document.getElementById('registro-correo').required = false;
        }
    };

    if (btnMethodEmail) btnMethodEmail.addEventListener('click', () => selectMethod('email'));
    if (btnMethodSms) btnMethodSms.addEventListener('click', () => selectMethod('sms'));
    if (btnBackMethod) btnBackMethod.addEventListener('click', () => {
        formRegister.style.display = 'none';
        methodSelection.style.display = 'block';
        selectedMethod = null;
    });

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

            pendingRegistrationData = { nombre, correo, telefono, password, captchaAnswer, captchaToken: captchaTokenActual };

            if (telefono && telefono.trim() !== '') {
                showSpinner();
                try {
                    const res = await fetch('/api/usuarios/enviar-codigo-registro', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            telefono, 
                            oldToken: currentVerificationToken 
                        })
                    });
                    const data = await res.json();
                    
                    if (res.ok) {
                        currentVerificationToken = data.verificationToken;
                        showToast('Código SMS enviado. Verifica tu teléfono.', 'success');
                        const modal = document.getElementById('modal-verificacion-telefono');
                        if (modal) modal.style.display = 'flex';
                    } else {
                        showToast(data.error, 'error');
                        cargarCaptcha();
                        if (document.getElementById('registro-captcha')) document.getElementById('registro-captcha').value = '';
                    }
                } catch (error) { showToast('Error de conexión al solicitar SMS.', 'error'); } 
                finally { hideSpinner(); }
        });
    }

    async function ejecutarRegistroFinal(codigo = null) {
        showSpinner();
        try {
            const payload = { ...pendingRegistrationData };
            if (codigo) {
                payload.verificationToken = currentVerificationToken;
                payload.codigoVerificacion = codigo;
            }

            const res = await fetch('/api/usuarios/registro', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            if (res.ok) {
                showToast('Registro exitoso. Redirigiendo...', 'success');
                setTimeout(() => { window.location.href = `login.html?correo=${encodeURIComponent(payload.correo || payload.telefono)}`; }, 1500);
            } else {
                showToast(data.error || 'Error al registrar', 'error');
                cargarCaptcha();
                if (document.getElementById('registro-captcha')) document.getElementById('registro-captcha').value = '';
            }
        } catch (error) { showToast('Error de conexión al registrarse.', 'error'); } 
        finally { hideSpinner(); }
    }

    const formVerificacion = document.getElementById('form-verificacion');
    if (formVerificacion) {
        formVerificacion.onsubmit = async (eVerif) => {
            eVerif.preventDefault();
            const codigo = document.getElementById('codigo-verificacion').value;
            await ejecutarRegistroFinal(codigo);
        };
    }

    const btnReenviar = document.getElementById('btn-reenviar-codigo');
    if (btnReenviar) {
        btnReenviar.onclick = async (eReenviar) => {
            eReenviar.preventDefault();
            if (!pendingRegistrationData) return;

            const originalText = btnReenviar.textContent;
            btnReenviar.textContent = 'Enviando...';
            btnReenviar.style.pointerEvents = 'none';

            try {
                const isEmail = pendingRegistrationData.metodo === 'email';
                const url = isEmail ? '/api/usuarios/enviar-codigo-email' : '/api/usuarios/enviar-codigo-registro';
                const payload = isEmail ? { correo: pendingRegistrationData.correo, oldToken: currentVerificationToken } : { telefono: pendingRegistrationData.telefono, oldToken: currentVerificationToken };
                const resReenvio = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const dataReenvio = await resReenvio.json();
                if (resReenvio.ok) {
                    currentVerificationToken = dataReenvio.verificationToken;
                    showToast('Nuevo código enviado.', 'success');
                } else { showToast(dataReenvio.error, 'error'); }
            } catch (err) { showToast('Error de red al reenviar el código.', 'error'); } 
            finally { setTimeout(() => { btnReenviar.textContent = originalText; btnReenviar.style.pointerEvents = 'auto'; }, 10000); }
        };
    }
});