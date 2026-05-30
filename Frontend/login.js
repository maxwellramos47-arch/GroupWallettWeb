// login.js
document.addEventListener('DOMContentLoaded', () => {
    const formLogin = document.getElementById('form-login');

    // Pre-llenar correo si viene desde el registro
    const urlParams = new URLSearchParams(window.location.search);
    const correoFromRegister = urlParams.get('correo');
    if (correoFromRegister) {
        document.getElementById('correo').value = decodeURIComponent(correoFromRegister);
    }

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

    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const correo = document.getElementById('correo').value;
        const password = document.getElementById('password').value;
        const rememberMe = document.getElementById('remember-me')?.checked || false;

        showSpinner();
        try {
            const response = await fetch('/api/usuarios/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ correo, password, rememberMe })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('usuarioId', data.id_usuario); // Guardamos ID en lugar del Token vulnerable
                localStorage.setItem('usuarioNombre', data.nombre);
                
                if (data.estado_suscripcion === 'vencido') {
                    localStorage.setItem('mostrarAvisoVencido', 'true');
                }
                
                const pendingJoinToken = localStorage.getItem('pendingJoinToken');
                if (pendingJoinToken) {
                    window.location.href = `/join.html?token=${pendingJoinToken}`;
                } else {
                    window.location.href = '/dashboard.html';
                }
            } else {
                showToast(data.error || 'Error al iniciar sesión', 'error');
                hideSpinner();
            }
        } catch (error) {
            console.error('Error de red:', error);
            showToast('No se pudo conectar con el servidor.', 'error');
            hideSpinner();
        }
    });

    // Flujo de Recuperación de Contraseña
    const linkForgot = document.getElementById('link-forgot');
    const recoverySection = document.getElementById('recovery-section');
    const formRecovery = document.getElementById('form-recovery');
    const formReset = document.getElementById('form-reset');

    // Cambiar dinámicamente el texto del botón para mejor UX
    if (formRecovery) {
        const btnSubmitRecovery = formRecovery.querySelector('button[type="submit"]');
        if (btnSubmitRecovery) btnSubmitRecovery.textContent = 'Enviar Recuperación';
    }

    // Detectar si venimos desde un enlace de recuperación en el correo
    const urlParamsLogin = new URLSearchParams(window.location.search);
    const urlResetToken = urlParamsLogin.get('reset_token');

    if (urlResetToken && recoverySection && formRecovery && formReset) {
        recoverySection.style.display = 'block';
        formRecovery.style.display = 'none';
        formReset.style.display = 'block';
        
        const tokenInput = document.getElementById('reset-token');
        if (tokenInput) {
            tokenInput.value = urlResetToken;
            tokenInput.style.display = 'none'; // Ocultamos el campo del token visualmente
            if (tokenInput.previousElementSibling && tokenInput.previousElementSibling.tagName === 'LABEL') {
                tokenInput.previousElementSibling.style.display = 'none';
            }
        }
        
        const tokenMsg = document.getElementById('token-msg');
        if (tokenMsg) tokenMsg.textContent = 'Enlace verificado. Ingresa tu nueva contraseña.';
    }

    linkForgot.addEventListener('click', (e) => {
        e.preventDefault();
        recoverySection.style.display = recoverySection.style.display === 'none' ? 'block' : 'none';
    });

    formRecovery.addEventListener('submit', async (e) => {
        e.preventDefault();
        const correo = document.getElementById('recovery-correo').value;
        showSpinner();
        try {
            const res = await fetch('/api/usuarios/recuperar-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ correo })
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message, 'success');
                formRecovery.style.display = 'none';
                document.getElementById('token-msg').textContent = `Revisa tu bandeja de entrada y haz clic en el enlace enviado.`;
            } else {
                showToast(data.error, 'error');
            }
        } catch (error) { console.error(error); } finally { hideSpinner(); }
    });

    formReset.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('reset-token').value;
        const new_password = document.getElementById('reset-password').value;
        showSpinner();
        try {
            const res = await fetch('/api/usuarios/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, new_password })
            });
            const data = await res.json();
            if (res.ok) { 
                showToast(data.message, 'success'); 
                setTimeout(() => window.location.href = 'login.html', 1500); // Limpia los parámetros de la URL
            } else {
                showToast(data.error, 'error');
                hideSpinner();
            }
        } catch (error) { console.error(error); hideSpinner(); }
    });

    // ==========================================
    // Flujo de Registro (Alternar y Procesar)
    // ==========================================
    const formRegister = document.getElementById('form-register');
    const linkRegister = document.getElementById('link-register') || document.getElementById('btn-register');
    const linkLogin = document.getElementById('link-login') || document.getElementById('btn-login');
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

    // Cambiar al formulario de registro
    if (linkRegister && formRegister) {
        linkRegister.addEventListener('click', (e) => {
            e.preventDefault();
            showSpinner(); // Mostrar pantalla de carga
            
            setTimeout(() => {
                hideSpinner(); // Ocultar carga después de 1 segundo
                formLogin.style.display = 'none';
                if (recoverySection) recoverySection.style.display = 'none';
                formRegister.style.display = 'block';

                // Agregar dinámicamente el campo de confirmación de contraseña si no existe
                if (!document.getElementById('registro-password-confirm')) {
                    const passField = document.getElementById('registro-password');
                    if (passField) {
                        const wrapper = document.createElement('div');
                        wrapper.style.marginTop = '1rem';
                        wrapper.innerHTML = `<label style="font-weight: bold; margin-bottom: 0.5rem; display: block;">Confirmar Contraseña</label>
                        <div style="display: flex; gap: 0.5rem; align-items: stretch;">
                            <input type="password" id="registro-password-confirm" placeholder="Repite tu contraseña" required style="flex: 1; padding: 0.8rem; font-size: 1.05rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background-color: var(--bg-light);">
                            <button type="button" class="toggle-password" style="background-color: var(--bg-light); border: 1px solid var(--border-color); border-radius: 6px; padding: 0 1rem; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;" title="Mostrar/Ocultar">👁️</button>
                        </div>`;
                        passField.parentNode.insertBefore(wrapper, passField.nextSibling);
                    }
                }
                
                // Agregar dinámicamente los Términos y Condiciones si no existen
                if (!document.getElementById('registro-tos')) {
                    const confirmWrapper = document.getElementById('registro-password-confirm') ? document.getElementById('registro-password-confirm').parentNode.parentNode : null;
                    if (confirmWrapper) {
                        const wrapperTos = document.createElement('div');
                        wrapperTos.style.marginTop = '1rem';
                        wrapperTos.style.marginBottom = '1rem';
                        wrapperTos.style.display = 'flex';
                        wrapperTos.style.alignItems = 'center';
                        wrapperTos.style.gap = '0.5rem';
                        wrapperTos.innerHTML = `
                            <input type="checkbox" id="registro-tos" required style="width: auto; padding: 0; margin: 0; transform: scale(1.1); cursor: pointer;">
                            <label for="registro-tos" style="margin: 0; font-size: 0.85rem; color: var(--text-muted); cursor: pointer; font-weight: normal;">
                                Acepto los <a href="#" onclick="event.preventDefault(); alert('Términos y Condiciones:\\n\\nAl usar GroupWallet te comprometes a proporcionar datos veraces y a no usar la plataforma para fines ilícitos o lavado de activos. Nos reservamos el derecho de suspender cuentas sospechosas.')" style="color: var(--secondary-emerald); text-decoration: underline;">Términos y Condiciones</a> y la <a href="#" onclick="event.preventDefault(); alert('Política de Privacidad:\\n\\nTus datos de acceso están encriptados con AES-256 y contraseñas hasheadas. No compartiremos ni venderemos tu información personal o financiera a terceros.')" style="color: var(--secondary-emerald); text-decoration: underline;">Política de Privacidad</a>.
                            </label>
                        `;
                        confirmWrapper.parentNode.insertBefore(wrapperTos, confirmWrapper.nextSibling);
                    }
                }

                // Cargar CAPTCHA dinámico desde Backend
                cargarCaptcha();

                const btnSubmit = formRegister.querySelector('button[type="submit"]');
                if (btnSubmit) btnSubmit.textContent = 'Registrarse';
            }, 1000); // 1000 ms = 1 segundo de carga simulada
        });
    }

    // Volver al formulario de inicio de sesión
    if (linkLogin && formRegister) {
        linkLogin.addEventListener('click', (e) => {
            e.preventDefault();
            formRegister.style.display = 'none';
            formLogin.style.display = 'block';
        });
    }

    // Enviar los datos para crear la cuenta
    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('registro-nombre').value;
            const correo = document.getElementById('registro-correo').value;
            const password = document.getElementById('registro-password').value;
            const confirmPassword = document.getElementById('registro-password-confirm') ? document.getElementById('registro-password-confirm').value : null;
            const tosCheckbox = document.getElementById('registro-tos');
            const captchaInput = document.getElementById('registro-captcha');
            const captchaAnswer = captchaInput ? captchaInput.value : null;

            // Validar que aceptó los Términos
            if (tosCheckbox && !tosCheckbox.checked) {
                showToast('Debes aceptar los Términos y Condiciones y la Política de Privacidad.', 'error');
                return;
            }

            // Validar que las contraseñas coincidan
            if (confirmPassword !== null && password !== confirmPassword) {
                showToast('Las contraseñas no coinciden. Inténtalo de nuevo.', 'error');
                return;
            }

            showSpinner();
            try {
                const res = await fetch('/api/usuarios/registro', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, correo, password, captchaAnswer, captchaToken: captchaTokenActual })
                });
                const data = await res.json();
                
                if (res.ok) {
                    showToast('Registro exitoso. Ahora puedes iniciar sesión.', 'success');
                    formRegister.reset();
                    formRegister.style.display = 'none';
                    formLogin.style.display = 'block';
                    document.getElementById('correo').value = correo;
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
});