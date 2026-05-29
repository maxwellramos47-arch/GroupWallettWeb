// registro.js
document.addEventListener('DOMContentLoaded', () => {
    const formRegister = document.getElementById('form-register');

    // Generar CAPTCHA Matemático Simple dinámicamente
    if (formRegister && !document.getElementById('captcha-container')) {
        const btnSubmit = formRegister.querySelector('button[type="submit"]');
        if (btnSubmit) {
            const num1 = Math.floor(Math.random() * 10) + 1;
            const num2 = Math.floor(Math.random() * 10) + 1;
            window.captchaAnswer = num1 + num2;

            const captchaDiv = document.createElement('div');
            captchaDiv.id = 'captcha-container';
            captchaDiv.style.marginBottom = '1rem';
            captchaDiv.innerHTML = `
                <label style="font-weight: bold; margin-bottom: 0.5rem; display: block;">Verificación Humana: ¿Cuánto es ${num1} + ${num2}?</label>
                <input type="number" id="registro-captcha" required placeholder="Tu respuesta" style="width: 100%; padding: 0.8rem; font-size: 1.05rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background-color: var(--bg-light);">
            `;
            btnSubmit.parentNode.insertBefore(captchaDiv, btnSubmit);
        }
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

    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('registro-nombre').value;
            const correo = document.getElementById('registro-correo').value;
            const password = document.getElementById('registro-password').value;
            const confirmPassword = document.getElementById('registro-password-confirm').value;
            const tosCheckbox = document.getElementById('registro-tos');
            const captchaInput = document.getElementById('registro-captcha');

            // Validar CAPTCHA
            if (captchaInput && parseInt(captchaInput.value) !== window.captchaAnswer) {
                showToast('La respuesta de seguridad es incorrecta. Inténtalo de nuevo.', 'error');
                return;
            }

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

            showSpinner();
            try {
                const res = await fetch('/api/usuarios/registro', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, correo, password })
                });
                const data = await res.json();
                
                if (res.ok) {
                    showToast('Registro exitoso. Redirigiendo...', 'success');
                    setTimeout(() => window.location.href = 'index.html', 1500); // Lo manda al login automáticamente tras registrar
                } else {
                    showToast(data.error || 'Error al registrar', 'error');
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