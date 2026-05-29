// join.js
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenInvitacion = urlParams.get('token');
    const joinTitle = document.getElementById('join-title');
    const joinMessage = document.getElementById('join-message');

    if (!tokenInvitacion) {
        joinTitle.textContent = 'Enlace inválido';
        joinMessage.textContent = 'No se encontró ningún token de invitación en la URL.';
        setTimeout(() => window.location.href = 'index.html', 3000);
        return;
    }

    const usuarioToken = localStorage.getItem('usuarioToken');

    // Si no ha iniciado sesión, guardamos el intento y lo mandamos al login
    if (!usuarioToken) {
        localStorage.setItem('pendingJoinToken', tokenInvitacion);
        showToast('Debes iniciar sesión o registrarte para unirte al grupo.', 'success');
        setTimeout(() => window.location.href = 'index.html', 2000);
        return;
    }

    // --- Verificación Proactiva de Expiración del Token ---
    try {
        const payload = JSON.parse(atob(usuarioToken.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            localStorage.removeItem('usuarioToken');
            localStorage.removeItem('usuarioNombre');
            localStorage.setItem('pendingJoinToken', tokenInvitacion);
            if (typeof showToast === 'function') {
                showToast('Tu sesión ha expirado. Inicia sesión para unirte al grupo.', 'error');
            }
            setTimeout(() => window.location.href = 'index.html', 2000);
            return;
        }
    } catch (e) {
        localStorage.removeItem('usuarioToken');
        window.location.href = 'index.html';
        return;
    }

    // Ya limpiamos cualquier intento pendiente para que no se quede atascado a futuro
    localStorage.removeItem('pendingJoinToken');

    // Intentar unirse al grupo comunicándonos con nuestro nuevo endpoint
    try {
        const response = await fetch('/api/grupos/unirse', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${usuarioToken}`
            },
            body: JSON.stringify({ token_invitacion: tokenInvitacion })
        });

        const data = await response.json();

        if (response.ok) {
            joinTitle.textContent = '¡Felicidades!';
            joinTitle.style.color = 'var(--secondary-emerald)';
            joinMessage.textContent = data.message + ' Redirigiendo a tu panel...';
            showToast(data.message, 'success');
        } else {
            joinTitle.textContent = 'No se pudo unir al grupo';
            joinTitle.style.color = 'var(--danger-color)';
            joinMessage.textContent = data.error;
            showToast(data.error, 'error');
        }
        
        setTimeout(() => window.location.href = 'dashboard.html', 2500);

    } catch (error) {
        console.error(error);
        joinTitle.textContent = 'Error de conexión';
        joinMessage.textContent = 'Ocurrió un error al contactar al servidor.';
        showToast('Error de conexión', 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 3000);
    }
});