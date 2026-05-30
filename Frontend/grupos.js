// grupos.js
document.addEventListener('DOMContentLoaded', async () => {
    // --- 0. Protección de Ruta ---
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'index.html';
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
            setTimeout(() => window.location.href = 'index.html', 2000);
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
            } catch (err) { console.error('Error cerrando sesión', err); }
            
            localStorage.removeItem('usuarioId');
            localStorage.removeItem('usuarioNombre');
            window.location.href = 'index.html';
        });
    }

    const listaGrupos = document.getElementById('lista-grupos');
    let gruposData = []; // Almacenará los grupos para la búsqueda local

    function showSkeletonLoader(tableBody, columns, rows = 5) {
        if (!tableBody) return;
        tableBody.innerHTML = '';
        for (let i = 0; i < rows; i++) {
            const tr = document.createElement('tr');
            tr.className = 'skeleton-row';
            let tds = '';
            for (let j = 0; j < columns; j++) {
                tds += `<td><div class="skeleton" style="width: ${Math.random() * 40 + 50}%"></div></td>`;
            }
            tr.innerHTML = tds;
            tableBody.appendChild(tr);
        }
    }

    // --- 1. Renderizar Grupos ---
    const cargarGrupos = async () => {
        showSkeletonLoader(listaGrupos, 4);
        try {
            const response = await fetch('/api/grupos', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Error al cargar grupos');
            
            gruposData = await response.json();
            renderizarTablaGrupos();
        } catch (error) { console.error(error); }
    };

    const renderizarTablaGrupos = () => {
        const query = document.getElementById('buscar-grupo')?.value.toLowerCase() || '';
        listaGrupos.innerHTML = '';
        
        const selectInvitar = document.getElementById('grupo-invitar');
        if (selectInvitar) selectInvitar.innerHTML = '<option value="" disabled selected>Selecciona un grupo</option>';

        const gruposFiltrados = gruposData.filter(g => 
            g.nombre_grupo.toLowerCase().includes(query) || 
            g.rol.toLowerCase().includes(query)
        );

        if (gruposFiltrados.length === 0) {
            listaGrupos.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No se encontraron grupos.</td></tr>';
            return;
        }
        
        gruposFiltrados.forEach(g => {
            const tr = document.createElement('tr');
            let acciones = `<button class="btn-ver-miembros btn-primary" data-id="${g.id_grupo}" data-nombre="${g.nombre_grupo}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; background-color: var(--primary-slate); width: auto; margin-right: 0.5rem;">👥 Miembros</button>`;
            if (g.rol === 'Administrador') {
                acciones += `<button class="btn-editar-grupo btn-primary" data-id="${g.id_grupo}" data-nombre="${g.nombre_grupo}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; background-color: var(--secondary-emerald); width: auto;">✏️ Editar</button>`;
                if (selectInvitar) selectInvitar.innerHTML += `<option value="${g.id_grupo}">${g.nombre_grupo}</option>`;
            }
            tr.innerHTML = `<td>${g.id_grupo}</td><td><strong>${g.nombre_grupo}</strong></td><td>${g.rol}</td><td>${acciones}</td>`;
            listaGrupos.appendChild(tr);
        });
    };

    const inputBuscarGrupo = document.getElementById('buscar-grupo');
    if (inputBuscarGrupo) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
        inputBuscarGrupo.placeholder = `Buscar grupo por nombre o rol... (${isMac ? 'Cmd+K' : 'Ctrl+K'})`;
        
        inputBuscarGrupo.addEventListener('input', renderizarTablaGrupos);
    }

    // --- Atajo de teclado (Ctrl + K / Cmd + K) para búsqueda rápida ---
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if (inputBuscarGrupo) {
                inputBuscarGrupo.focus();
                inputBuscarGrupo.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    // --- 2. Manejar Edición de Grupo ---
    if (listaGrupos) {
        listaGrupos.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-editar-grupo')) {
                const idGrupo = e.target.getAttribute('data-id');
                const nombreActual = e.target.getAttribute('data-nombre');
                
                const nuevoNombre = prompt('Editar nombre del grupo:', nombreActual);
                if (!nuevoNombre || nuevoNombre.trim() === '' || nuevoNombre === nombreActual) return;

                showSpinner();
                try {
                    const response = await fetch(`/api/grupos/${idGrupo}`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nombre_grupo: nuevoNombre.trim() })
                    });
                    if (response.ok) await cargarGrupos();
                    else showToast((await response.json()).error || 'Error al editar el grupo.', 'error');
                } catch (error) { console.error('Error:', error); showToast('Problema de conexión.', 'error'); } finally { hideSpinner(); }
            }

            if (e.target.classList.contains('btn-ver-miembros')) {
                const idGrupo = e.target.getAttribute('data-id');
                const nombreGrupo = e.target.getAttribute('data-nombre');
                
                showSpinner();
                try {
                    const reqMiembros = await fetch(`/api/grupos/${idGrupo}/miembros`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (reqMiembros.ok) {
                        const miembros = await reqMiembros.json();
                        const miGrupo = gruposData.find(g => g.id_grupo == idGrupo);
                        const miRol = miGrupo ? miGrupo.rol : 'Miembro';
                        const miId = usuarioId;

                        let htmlMiembros = '<ul style="list-style: none; padding: 0; margin: 0;">';
                        miembros.forEach(m => {
                            let btnExpulsar = '';
                            if (miRol === 'Administrador' && m.id_usuario != miId) {
                                btnExpulsar = `<button class="btn-expulsar-miembro btn-primary" data-grupo="${idGrupo}" data-usuario="${m.id_usuario}" style="background-color: var(--danger-color); padding: 0.2rem 0.5rem; font-size: 0.75rem; width: auto; margin-left: 1rem;">Expulsar</button>`;
                            }
                            htmlMiembros += `<li style="display: flex; justify-content: space-between; align-items: center; padding: 0.8rem 0; border-bottom: 1px solid var(--border-color);">
                                <span style="font-weight: 500;">${m.nombre} ${m.id_usuario == miId ? '<span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem;">(Tú)</span>' : ''}</span>
                                ${btnExpulsar}
                            </li>`;
                        });
                        htmlMiembros += '</ul>';

                        const modalOverlay = document.createElement('div');
                        modalOverlay.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000; padding: 1rem;";
                        const modalBox = document.createElement('div');
                        modalBox.className = "card";
                        modalBox.style = "max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.2); max-height: 80vh; overflow-y: auto;";
                        modalBox.innerHTML = `
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                                <h3 style="margin: 0; border: none; padding: 0;">👥 Miembros de ${nombreGrupo}</h3>
                                <button id="btn-cerrar-modal-miembros" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted); line-height: 1;">&times;</button>
                            </div>
                            ${htmlMiembros}
                        `;
                        modalOverlay.appendChild(modalBox);
                        document.body.appendChild(modalOverlay);

                        document.getElementById('btn-cerrar-modal-miembros').addEventListener('click', () => document.body.removeChild(modalOverlay));
                        modalOverlay.addEventListener('click', (ev) => { if (ev.target === modalOverlay) document.body.removeChild(modalOverlay); });

                        modalBox.querySelectorAll('.btn-expulsar-miembro').forEach(btn => {
                            btn.addEventListener('click', async (ev) => {
                                const idUsuarioExpulsar = ev.target.getAttribute('data-usuario');
                                const idGrupoExpulsar = ev.target.getAttribute('data-grupo');
                                
                                if (!confirm('¿Estás seguro de que deseas expulsar a este miembro? Se eliminará del grupo, aunque sus deudas históricas permanecerán.')) return;
                                
                                ev.target.disabled = true;
                                ev.target.textContent = '...';
                                
                                try {
                                    const res = await fetch(`/api/grupos/${idGrupoExpulsar}/miembros/${idUsuarioExpulsar}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                                    const dataRes = await res.json();
                                    if (res.ok) {
                                        showToast(dataRes.message, 'success');
                                        ev.target.closest('li').remove();
                                    } else { showToast(dataRes.error, 'error'); ev.target.disabled = false; ev.target.textContent = 'Expulsar'; }
                                } catch (err) { showToast('Error de conexión', 'error'); ev.target.disabled = false; ev.target.textContent = 'Expulsar'; }
                            });
                        });
                    }
                } catch (err) { showToast('Error al cargar miembros', 'error'); } finally { hideSpinner(); }
            }
        });
    }

    // --- 3. Crear Nuevo Grupo ---
    const formGrupo = document.getElementById('form-grupo');
    if (formGrupo) {
        formGrupo.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!navigator.onLine) {
                showToast('Acción bloqueada: Verifica tu conexión a internet e intenta nuevamente.', 'error');
                return;
            }

            const nombre_grupo = document.getElementById('nombre-grupo').value;

            showSpinner();
            try {
                const response = await fetch('/api/grupos', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify({ nombre_grupo })
                });
                
                const data = await response.json();
                if (!response.ok) {
                    showToast(data.error, 'error'); 
                } else {
                    showToast('Grupo creado exitosamente', 'success');
                    formGrupo.reset();
                    await cargarGrupos(); // Actualizar la tabla inmediatamente
                }
            } catch (error) { console.error(error); } finally { hideSpinner(); }
        });
    }

    // --- 4. Invitar Participante ---
    const formParticipante = document.getElementById('form-participante');

    if (formParticipante) {
        formParticipante.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!navigator.onLine) {
                showToast('Acción bloqueada: Verifica tu conexión a internet.', 'error');
                return;
            }

            const idGrupo = document.getElementById('grupo-invitar').value;
            if (!idGrupo) return;

            showSpinner();
            try {
                const response = await fetch(`/api/grupos/${idGrupo}/invitacion`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (response.ok) {
                    const mensaje = encodeURIComponent(`¡Hola! Únete a mi grupo de finanzas en GroupWallet aquí: ${data.enlace}`);
                    const waLink = `https://api.whatsapp.com/send?text=${mensaje}`;
                    const emailLink = `mailto:?subject=Invitación a GroupWallet&body=${mensaje}`;
                    
                    // Generar Código QR de forma local (en memoria)
                    const qrContainer = document.createElement('div');
                    new QRCode(qrContainer, {
                        text: data.enlace,
                        width: 300,
                        height: 300,
                        colorDark : "#000000",
                        colorLight : "#ffffff",
                        correctLevel : QRCode.CorrectLevel.M
                    });

                    // Mostrar todo en un modal enriquecido
                    setTimeout(() => {
                        const canvas = qrContainer.querySelector('canvas');
                        if(canvas) {
                            const dataUrl = canvas.toDataURL();
                            
                            const modalOverlay = document.createElement('div');
                            modalOverlay.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 10000; padding: 1rem;";
                            
                            const modalBox = document.createElement('div');
                            modalBox.style = "background: white; padding: 2rem; border-radius: 12px; text-align: center; max-width: 90%; width: 400px; position: relative; box-shadow: 0 10px 25px rgba(0,0,0,0.3);";
                            
                            modalBox.innerHTML = `
                                <button id="btn-cerrar-qr-modal" style="position: absolute; top: 10px; right: 10px; background: var(--danger-color); color: white; border: none; font-size: 1.5rem; width: 35px; height: 35px; border-radius: 50%; cursor: pointer; line-height: 1;">&times;</button>
                                <h2 style="color: var(--primary-slate); margin-bottom: 1rem; margin-top: 0;">Invitar a unirte</h2>
                                <img src="${dataUrl}" style="max-width: 250px; width: 100%; height: auto; border-radius: 8px; margin: 0 auto 1.5rem auto; display: block; border: 1px solid var(--border-color); padding: 0.5rem;" />
                                
                                <div style="margin-bottom: 1.5rem; text-align: left;">
                                    <label style="font-weight: bold; font-size: 0.9rem; color: var(--text-muted);">Enlace de Invitación:</label>
                                    <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                                        <input type="text" readonly value="${data.enlace}" id="modal-invite-link" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; background: var(--bg-light); color: var(--text-color);">
                                        <button id="btn-modal-copiar" style="background: var(--secondary-emerald); color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-weight: bold;">Copiar</button>
                                    </div>
                                </div>

                                <div style="display: flex; gap: 0.8rem; justify-content: center;">
                                    <a href="${waLink}" target="_blank" style="flex: 1; background-color: #25D366; color: white; padding: 0.6rem; border-radius: 4px; text-decoration: none; font-size: 0.9rem; font-weight: bold;">📱 WhatsApp</a>
                                    <a href="${emailLink}" target="_blank" style="flex: 1; background-color: var(--primary-slate); color: white; padding: 0.6rem; border-radius: 4px; text-decoration: none; font-size: 0.9rem; font-weight: bold;">✉️ Correo</a>
                                </div>
                                
                                <p style="color: var(--text-muted); font-size: 0.8rem; margin-top: 1.5rem; margin-bottom: 0;">El enlace es válido por 7 días</p>
                            `;
                            
                            modalOverlay.appendChild(modalBox);
                            document.body.appendChild(modalOverlay);

                            document.getElementById('btn-cerrar-qr-modal').addEventListener('click', () => {
                                document.body.removeChild(modalOverlay);
                                if (formParticipante) formParticipante.reset();
                            });

                            document.getElementById('btn-modal-copiar').addEventListener('click', async () => {
                                try {
                                    const linkInput = document.getElementById('modal-invite-link');
                                    await navigator.clipboard.writeText(linkInput.value);
                                    linkInput.select();
                                    showToast('Enlace copiado al portapapeles.', 'success');
                                } catch (err) {
                                    showToast('No se pudo copiar el enlace.', 'error');
                                }
                            });
                        }
                    }, 500);
                    
                    showToast('Invitación generada exitosamente.', 'success');
                } else showToast(data.error, 'error');
            } catch (error) { console.error(error); showToast('Error al generar enlace.', 'error'); } finally { hideSpinner(); }
        });
    }

    // --- 5. Escáner de Código QR (Cámara del Celular) ---
    const btnScanQr = document.getElementById('btn-scan-qr');
    const btnCloseScanner = document.getElementById('btn-close-scanner');
    const qrReaderContainer = document.getElementById('qr-reader-container');
    let html5QrcodeScanner = null;

    if (btnScanQr) {
        btnScanQr.addEventListener('click', () => {
            btnScanQr.style.display = 'none';
            qrReaderContainer.style.display = 'block';

            // Inicializar el lector pidiéndole permisos de cámara al usuario
            const scannerConfig = { 
                fps: 10, 
                qrbox: function(videoWidth, videoHeight) {
                    const minEdgeSize = Math.min(videoWidth, videoHeight);
                    return {
                        width: Math.floor(minEdgeSize * 0.8),
                        height: Math.floor(minEdgeSize * 0.8)
                    };
                }
            };
            if (typeof Html5QrcodeScanType !== 'undefined') {
                scannerConfig.supportedScanTypes = [Html5QrcodeScanType.SCAN_TYPE_CAMERA]; // Desactiva pestaña de subir imagen
            }
            
            html5QrcodeScanner = new Html5QrcodeScanner(
                "qr-reader",
                scannerConfig,
                false // No imprimir logs verbosos en consola
            );

            let hasRedirected = false;

            html5QrcodeScanner.render((decodedText, decodedResult) => {
                if (hasRedirected) return;

                // Validar que el QR sea de nuestra aplicación
                if (decodedText.includes('token=')) {
                    hasRedirected = true; // Evitar múltiples lecturas seguidas
                    
                    // Reproducir sonido de "Bip" de confirmación
                    try {
                        const AudioContext = window.AudioContext || window.webkitAudioContext;
                        if (AudioContext) {
                            const ctx = new AudioContext();
                            const osc = ctx.createOscillator();
                            const gainNode = ctx.createGain();
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(880, ctx.currentTime); // Tono alto y claro (880Hz)
                            gainNode.gain.setValueAtTime(0.1, ctx.currentTime); // Volumen suave al 10%
                            osc.connect(gainNode);
                            gainNode.connect(ctx.destination);
                            osc.start();
                            osc.stop(ctx.currentTime + 0.15); // Bip corto de 150 milisegundos
                        }
                    } catch (e) { console.log('El navegador no soporta el sonido de Bip'); }

                    // Disparar animación de confeti
                    if (typeof confetti === 'function') {
                        confetti({
                            particleCount: 150,
                            spread: 70,
                            origin: { y: 0.6 }
                        });
                    }
                    showToast('Código QR detectado. Uniendo al grupo...', 'success');
                    
                    // Navegar de inmediato, manejando la limpieza de forma segura
                    try {
                        html5QrcodeScanner.clear().catch(() => {});
                    } catch (err) {}
                    
                    qrReaderContainer.style.display = 'none';
                    btnScanQr.style.display = 'block';
                    
                    setTimeout(() => {
                        try {
                            const urlObj = new URL(decodedText);
                            window.location.href = urlObj.href;
                        } catch (e) {
                            window.location.href = decodedText;
                        }
                    }, 1500);

                } else {
                    hasRedirected = true;
                    showToast('Este código QR no es de GroupWallet.', 'error');
                    setTimeout(() => {
                        hasRedirected = false; // Permitir intentar de nuevo tras 3 segundos
                    }, 3000);
                }
            }, (errorMessage) => {
                // Se ejecuta cuadro por cuadro mientras no encuentre QR (Lo ignoramos silenciosamente)
            });
        });
    }

    if (btnCloseScanner) {
        btnCloseScanner.addEventListener('click', () => {
            if (html5QrcodeScanner) html5QrcodeScanner.clear();
            qrReaderContainer.style.display = 'none';
            btnScanQr.style.display = 'block';
        });
    }

    cargarGrupos();
});