// registro.js
document.addEventListener('DOMContentLoaded', () => {
    const formRegister = document.getElementById('form-register');

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