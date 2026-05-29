// toast.js
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-fadeout');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    // Inyectar el botón de Modo Oscuro en la barra de navegación dinámicamente
    const navUl = document.querySelector('.main-nav ul');
    if (navUl && !document.getElementById('btn-dark-mode')) {
        const li = document.createElement('li');
        li.innerHTML = '<a href="#" id="btn-dark-mode" title="Alternar Modo Oscuro" style="font-size: 1.2rem;">🌙</a>';
        navUl.insertBefore(li, navUl.lastElementChild); // Insertar antes del botón "Salir"
    }

    const btnDarkMode = document.getElementById('btn-dark-mode');
    const prefersDark = localStorage.getItem('darkMode') === 'true';

    if (prefersDark) {
        document.body.classList.add('dark-mode');
        if (btnDarkMode) btnDarkMode.textContent = '☀️';
    }

    if (btnDarkMode) {
        btnDarkMode.addEventListener('click', (e) => {
            e.preventDefault();
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('darkMode', isDark);
            btnDarkMode.textContent = isDark ? '☀️' : '🌙';
        });
    }

    // --- PWA Offline Indicator ---
    let offlineBanner = document.getElementById('offline-banner');
    if (!offlineBanner) {
        offlineBanner = document.createElement('div');
        offlineBanner.id = 'offline-banner';
        offlineBanner.innerHTML = '⚠️ Estás navegando sin conexión a Internet. Varias acciones fallarán hasta que te reconectes.';
        document.body.appendChild(offlineBanner);
    }

    const updateOnlineStatus = () => {
        offlineBanner.style.display = navigator.onLine ? 'none' : 'block';
    };

    // Escuchar cambios de red en tiempo real
    window.addEventListener('online', async () => { 
        updateOnlineStatus(); 
        showToast('Conexión restablecida.', 'success'); 
        
        // --- Procesamiento de la Cola (Background Sync) ---
        const colaGastos = JSON.parse(localStorage.getItem('colaGastosOffline') || '[]');
        if (colaGastos.length > 0) {
            showToast(`Sincronizando ${colaGastos.length} gasto(s) pendiente(s)...`, 'info');
            const token = localStorage.getItem('usuarioToken');
            if (!token) return;
            
            let sincronizados = 0;
            for (const gasto of colaGastos) {
                try {
                    const response = await fetch('/api/gastos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(gasto)
                    });
                    if (response.ok) sincronizados++;
                } catch (err) { console.error('Error sincronizando offline:', err); }
            }
            
            localStorage.removeItem('colaGastosOffline');
            if (sincronizados > 0) {
                showToast(`✅ ${sincronizados} gasto(s) sincronizado(s) exitosamente.`, 'success');
                setTimeout(() => window.location.reload(), 2000);
            }
        }
    });
    window.addEventListener('offline', () => { updateOnlineStatus(); showToast('Has perdido la conexión a internet.', 'error'); });
    
    // Verificación inicial al cargar la página
    updateOnlineStatus();
});

function showSpinner() {
    let overlay = document.getElementById('global-spinner-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'global-spinner-overlay';
        const spinner = document.createElement('div');
        spinner.className = 'global-spinner';
        overlay.appendChild(spinner);
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function hideSpinner() {
    const overlay = document.getElementById('global-spinner-overlay');
    if (overlay) overlay.style.display = 'none';
}

// Modal global para visualizar comprobantes (Imágenes y PDFs)
function openReceiptModal(url) {
    let modal = document.getElementById('receipt-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'receipt-modal';
        modal.style = "display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10000; justify-content: center; align-items: center; padding: 1rem;";
        modal.innerHTML = `
            <div style="position: relative; max-width: 100%; max-height: 100%; display: flex; justify-content: center; align-items: center; width: 100%; height: 100%;">
                <button id="close-receipt-modal" style="position: absolute; top: 10px; right: 20px; background: var(--danger-color, #e74c3c); border: none; color: white; font-size: 1.5rem; cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: flex; justify-content: center; align-items: center; z-index: 10001; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">&times;</button>
                <img id="receipt-image" src="" alt="Comprobante" style="max-width: 90vw; max-height: 90vh; border-radius: 8px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); display: none; object-fit: contain;">
                <iframe id="receipt-pdf" src="" style="width: 90vw; height: 90vh; border: none; border-radius: 8px; background: white; display: none; box-shadow: 0 5px 15px rgba(0,0,0,0.3);"></iframe>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('close-receipt-modal').addEventListener('click', () => {
            modal.style.display = 'none';
            document.getElementById('receipt-image').src = '';
            document.getElementById('receipt-pdf').src = '';
        });

        // Cierra el modal si se hace clic afuera de la imagen/pdf
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.children[0] === e.target) {
                modal.style.display = 'none';
                document.getElementById('receipt-image').src = '';
                document.getElementById('receipt-pdf').src = '';
            }
        });
    }

    const img = document.getElementById('receipt-image');
    const pdf = document.getElementById('receipt-pdf');

    if (url.toLowerCase().includes('.pdf')) {
        img.style.display = 'none';
        pdf.style.display = 'block';
        pdf.src = url;
    } else {
        pdf.style.display = 'none';
        img.style.display = 'block';
        img.src = url;
    }

    modal.style.display = 'flex';
}
window.openReceiptModal = openReceiptModal;