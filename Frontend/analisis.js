document.addEventListener('DOMContentLoaded', async () => {
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
        return; 
    }

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        let [resource, config] = args;
        if (!config) config = {};
        config.credentials = 'same-origin';
        const response = await originalFetch(resource, config);
        if (response.status === 401) {
            localStorage.removeItem('usuarioId');
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
            await fetch('/api/usuarios/logout', { method: 'POST' });
            localStorage.removeItem('usuarioId');
            window.location.href = 'login.html';
        });
    }

    const btnShowPayment = document.getElementById('btn-show-payment');
    if (btnShowPayment) {
        btnShowPayment.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/suscripciones/checkout', { method: 'POST' });
                const data = await response.json();
                if (response.ok && data.url) window.location.href = data.url;
                else showToast(data.error || 'Error conectando a MercadoPago.', 'error');
            } catch (error) { showToast('Problema de conexión.', 'error'); }
        });
    }

    const moneda = localStorage.getItem(`moneda_${usuarioId}`) || '$';
    let premiumChartInstance = null;

    const cargarAnalisis = async () => {
        try {
            const reqAnalisis = await fetch('/api/finanzas/analisis');
            if (reqAnalisis.ok) {
                const datosAnalisis = await reqAnalisis.json();
                document.getElementById('blur-premium-cta').style.display = 'none';
                document.getElementById('analisis-content').classList.remove('locked-content');

                document.getElementById('cat-frecuente').textContent = datosAnalisis.categoria_frecuente;
                document.getElementById('ahorro-proyectado').textContent = `${moneda}${datosAnalisis.ahorro_proyectado.toFixed(2)}`;
                document.getElementById('gasto-mayor').textContent = `${moneda}${datosAnalisis.mayor_gasto.toFixed(2)}`;
                document.getElementById('gasto-promedio').textContent = `${moneda}${datosAnalisis.gasto_promedio.toFixed(2)}`;
                document.getElementById('total-gastado').textContent = `${moneda}${datosAnalisis.total_gastado.toFixed(2)}`;

                const chartContainer = document.getElementById('chart-container');
                const canvas = document.getElementById('premiumChart');
                if (chartContainer && canvas && datosAnalisis.distribucion_gastos) {
                    chartContainer.style.background = 'none';
                    chartContainer.style.height = 'auto';
                    canvas.style.display = 'block';

                    if (premiumChartInstance) premiumChartInstance.destroy();
                    premiumChartInstance = new Chart(canvas, {
                        type: document.getElementById('tipo-grafico').value || 'doughnut',
                        data: {
                            labels: datosAnalisis.distribucion_gastos.etiquetas,
                            datasets: [{
                                data: datosAnalisis.distribucion_gastos.valores,
                                backgroundColor: ['#2ecc71', '#3498db', '#f1c40f', '#e74c3c'],
                            }]
                        },
                        options: { responsive: true, maintainAspectRatio: false }
                    });

                    document.getElementById('tipo-grafico').addEventListener('change', (e) => {
                        premiumChartInstance.config.type = e.target.value;
                        premiumChartInstance.update();
                    });
                }
            }
        } catch (e) { console.error('Error actualizando gráficos:', e); }
    };

    const cargarHistorial = async () => {
        try {
            const response = await fetch(`/api/historial?limit=20`);
            if (!response.ok) throw new Error('Error al cargar historial');
            const result = await response.json();
            
            const listaHistorial = document.getElementById('lista-historial');
            listaHistorial.innerHTML = '';
            result.data.forEach(h => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${h.fecha_gasto}</td><td>${h.fecha_archivado}</td><td><span style="font-weight: 500;">${h.nombre_grupo}</span></td><td>${h.descripcion}</td><td>${h.pagador_nombre}</td><td>${moneda}${h.monto.toFixed(2)}</td>`;
                listaHistorial.appendChild(tr);
            });
        } catch (error) { console.error(error); }
    };

    cargarAnalisis();
    cargarHistorial();
});