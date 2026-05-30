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

    const usuarioId = localStorage.getItem('usuarioId');

    // Si no ha iniciado sesión, guardamos el intento y lo mandamos al login
    if (!usuarioId) {
        localStorage.setItem('pendingJoinToken', tokenInvitacion);
        
        joinTitle.textContent = '¡Has sido invitado!';
        joinTitle.style.color = 'var(--primary-slate)';
        joinMessage.innerHTML = 'Para unirte a este grupo y dividir gastos, necesitas <strong style="color: var(--secondary-emerald);">iniciar sesión</strong> o <strong style="color: var(--primary-slate);">crear una cuenta</strong>.';
        
        const spinner = document.getElementById('join-spinner');
        if (spinner) spinner.style.display = 'none';
        
        const actions = document.getElementById('join-actions');
        if (actions) actions.style.display = 'flex';
        return;
    }
    const usuarioToken = 'http-only-cookie';

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
            credentials: 'same-origin',
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