// grupos.js
document.addEventListener('DOMContentLoaded', async () => {
    // --- 0. Protección de Ruta ---
    const usuarioId = localStorage.getItem('usuarioId');
    if (!usuarioId) {
        window.location.href = 'login.html';
        return; 
    }
    const token = 'http-only-cookie'; // Mantiene compatibilidad

    // --- Función de Escape HTML para prevenir inyecciones XSS ---
    const escapeHTML = (str) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    };

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
            setTimeout(() => window.location.href = 'login.html', 2000);
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
            window.location.href = 'login.html';
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
            let acciones = `<button class="btn-ver-miembros btn-primary" data-id="${g.id_grupo}" data-nombre="${escapeHTML(g.nombre_grupo)}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; background-color: var(--primary-slate); width: auto; margin-right: 0.5rem;">👥 Miembros</button>`;
            if (g.rol === 'Administrador') {
                acciones += `<button class="btn-editar-grupo btn-primary" data-id="${g.id_grupo}" data-nombre="${escapeHTML(g.nombre_grupo)}" style="padding: 0.3rem 0.5rem; font-size: 0.8rem; background-color: var(--secondary-emerald); width: auto;">✏️ Editar</button>`;
                if (selectInvitar) selectInvitar.innerHTML += `<option value="${g.id_grupo}">${escapeHTML(g.nombre_grupo)}</option>`;
            }
            tr.innerHTML = `<td>${g.id_grupo}</td><td><strong>${escapeHTML(g.nombre_grupo)}</strong></td><td>${escapeHTML(g.rol)}</td><td>${acciones}</td>`;
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
                            let btnBanco = '';
                            let btnWhatsapp = '';
                            if (m.id_usuario != miId) {
                                btnBanco = `<button class="btn-ver-banco-modal btn-primary" data-usuario="${m.id_usuario}" style="background-color: var(--primary-slate); padding: 0.2rem 0.5rem; font-size: 0.75rem; width: auto; margin-left: 0.5rem;">🏦 Banco</button>`;
                                if (m.telefono) {
                                    const numeroLimpio = m.telefono.replace(/[^0-9+]/g, '');
                                    btnWhatsapp = `<a href="https://wa.me/${numeroLimpio}" target="_blank" title="Chatear por WhatsApp" style="text-decoration: none; font-size: 1.2rem;">💬</a>`;
                                }
                            }
                            if (miRol === 'Administrador' && m.id_usuario != miId) {
                                btnExpulsar = `<button class="btn-expulsar-miembro btn-primary" data-grupo="${idGrupo}" data-usuario="${m.id_usuario}" style="background-color: var(--danger-color); padding: 0.2rem 0.5rem; font-size: 0.75rem; width: auto; margin-left: 0.5rem;">Expulsar</button>`;
                            }
                            htmlMiembros += `<li style="display: flex; justify-content: space-between; align-items: center; padding: 0.8rem 0; border-bottom: 1px solid var(--border-color);">
                                <div style="display: flex; align-items: center;">
                                <span style="font-weight: 500;">${escapeHTML(m.nombre)} ${m.id_usuario == miId ? '<span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem;">(Tú)</span>' : ''}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 0.8rem;">
                                    ${btnWhatsapp}
                                    ${btnBanco}
                                    ${btnExpulsar}
                                </div>
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
                            <h3 style="margin: 0; border: none; padding: 0;">👥 Miembros de ${escapeHTML(nombreGrupo)}</h3>
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

                        modalBox.querySelectorAll('.btn-ver-banco-modal').forEach(btn => {
                            btn.addEventListener('click', async (ev) => {
                                const idUsuarioTarget = ev.target.getAttribute('data-usuario');
                                showSpinner();
                                try {
                                    const res = await fetch(`/api/usuarios/${idUsuarioTarget}/banco`);
                                    const datos = await res.json();
                                    
                                    if (res.ok) {
                                        const bancoOverlay = document.createElement('div');
                                        bancoOverlay.style = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 10005; padding: 1rem;";
                                        const bancoBox = document.createElement('div');
                                        bancoBox.className = "card";
                                        bancoBox.style = "max-width: 350px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.3); position: relative;";
                                        
                                        // --- Detectar Celular y Generar Deep Link de App Bancaria ---
                                        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                                        let btnAbrirApp = '';
                                        if (isMobile && datos.banco) {
                                            let appScheme = '';
                                            const bancoStr = datos.banco.toLowerCase();
                                            if (bancoStr.includes('estado')) appScheme = 'bancoestado://';
                                            else if (bancoStr.includes('santander')) appScheme = 'santander://';
                                            else if (bancoStr.includes('chile')) appScheme = 'bancochile://';
                                            else if (bancoStr.includes('mach')) appScheme = 'mach://';
                                            else if (bancoStr.includes('tenpo')) appScheme = 'tenpo://';
                                            else if (bancoStr.includes('mercado pago')) appScheme = 'mercadopago://';
                                            
                                            if (appScheme) {
                                                btnAbrirApp = `<a href="${appScheme}" class="btn-primary" style="display: block; text-align: center; text-decoration: none; margin-top: 1rem; background-color: var(--primary-slate); padding: 0.6rem;">📱 Abrir App de ${datos.banco}</a>`;
                                            }
                                        }

                                        bancoBox.innerHTML = `
                                            <button id="btn-cerrar-banco" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted); line-height: 1;">&times;</button>
                                            <h3 style="margin-top: 0; margin-bottom: 1rem; color: var(--primary-slate);">🏦 Datos para Transferir</h3>
                                            <p style="margin: 0; font-size: 0.9rem;"><strong>Banco:</strong> ${datos.banco || 'No especificado'}</p>
                                            <p style="margin: 0; font-size: 0.9rem;"><strong>Tipo:</strong> ${datos.tipo_cuenta || 'No especificado'}</p>
                                            <p style="margin: 0; font-size: 0.9rem;"><strong>Correo:</strong> ${datos.correo || 'No especificado'}</p>
                                            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center;">
                                                <input type="text" readonly value="${datos.rut || ''}" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; background: var(--bg-light);" placeholder="RUT no registrado">
                                                <button class="btn-copiar-dato btn-primary" data-valor="${datos.rut || ''}" style="width: auto; padding: 0.5rem; font-size: 0.8rem; background-color: var(--secondary-emerald);">Copiar RUT</button>
                                            </div>
                                            <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center;">
                                                <input type="text" readonly value="${datos.numero_cuenta || ''}" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.85rem; background: var(--bg-light);" placeholder="N° Cuenta no registrado">
                                                <button class="btn-copiar-dato btn-primary" data-valor="${datos.numero_cuenta || ''}" style="width: auto; padding: 0.5rem; font-size: 0.8rem; background-color: var(--secondary-emerald);">Copiar N°</button>
                                            </div>
                                            <button id="btn-copiar-todos-datos" class="btn-primary" style="display: block; margin-top: 1rem; width: 100%; background-color: var(--primary-slate); padding: 0.6rem;">📋 Copiar Todos los Datos</button>
                                            ${btnAbrirApp}
                                        `;
                                        bancoOverlay.appendChild(bancoBox);
                                        document.body.appendChild(bancoOverlay);

                                        document.getElementById('btn-cerrar-banco').addEventListener('click', () => document.body.removeChild(bancoOverlay));
                                        
                                        bancoBox.querySelectorAll('.btn-copiar-dato').forEach(btnCopiar => {
                                            btnCopiar.addEventListener('click', async (eCopiar) => {
                                                const btn = eCopiar.target;
                                                const val = btn.getAttribute('data-valor');
                                                if (val) {
                                                    await navigator.clipboard.writeText(val);
                                                    showToast('Copiado al portapapeles', 'success');
                                                    
                                                    const originalText = btn.textContent;
                                                    const originalBg = btn.style.backgroundColor;
                                                    btn.textContent = '✔️ Copiado';
                                                    btn.style.backgroundColor = '#27ae60';
                                                    setTimeout(() => {
                                                        btn.textContent = originalText;
                                                        btn.style.backgroundColor = originalBg;
                                                    }, 2000);
                                                } else {
                                                    showToast('El usuario no registró este dato.', 'error');
                                                }
                                            });
                                        });
                                        
                                        const btnCopiarTodos = document.getElementById('btn-copiar-todos-datos');
                                        if (btnCopiarTodos) {
                                            btnCopiarTodos.addEventListener('click', async (e) => {
                                                const btn = e.target;
                                                const textoCompleto = `🏦 *Datos de Transferencia*\n*Banco:* ${datos.banco || 'No especificado'}\n*Tipo:* ${datos.tipo_cuenta || 'No especificado'}\n*RUT:* ${datos.rut || 'No especificado'}\n*N° Cuenta:* ${datos.numero_cuenta || 'No especificado'}\n*Correo:* ${datos.correo || 'No especificado'}`;
                                                try {
                                                    await navigator.clipboard.writeText(textoCompleto);
                                                    showToast('Todos los datos copiados al portapapeles', 'success');
                                                    
                                                    const originalText = btn.textContent;
                                                    const originalBg = btn.style.backgroundColor;
                                                    btn.textContent = '✔️ ¡Copiados!';
                                                    btn.style.backgroundColor = 'var(--secondary-emerald)';
                                                    setTimeout(() => {
                                                        btn.textContent = originalText;
                                                        btn.style.backgroundColor = originalBg;
                                                    }, 2000);
                                                } catch (err) {
                                                    showToast('Error al copiar los datos', 'error');
                                                }
                                            });
                                        }
                                    } else showToast(datos.error || 'No se encontraron datos.', 'error');
                                } catch (error) { console.error(error); showToast('Error de conexión.', 'error'); } finally { hideSpinner(); }
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
        // Añadir dinámicamente campo de correo si no existe
        if (!document.getElementById('correo-invitar')) {
            const btnSubmit = formParticipante.querySelector('button[type="submit"]');
            if (btnSubmit) {
                const emailDiv = document.createElement('div');
                emailDiv.style.marginBottom = '1rem';
                emailDiv.innerHTML = `
                    <label style="font-weight: bold; margin-bottom: 0.5rem; display: block; color: var(--text-color);">Enviar invitación al correo (Opcional):</label>
                    <input type="email" id="correo-invitar" placeholder="ejemplo@correo.com" style="width: 100%; padding: 0.8rem; font-size: 1.05rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background-color: var(--bg-light);">
                `;
                btnSubmit.parentNode.insertBefore(emailDiv, btnSubmit);
            }
        }

        formParticipante.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!navigator.onLine) {
                showToast('Acción bloqueada: Verifica tu conexión a internet.', 'error');
                return;
            }

            const idGrupo = document.getElementById('grupo-invitar').value;
            const correo = document.getElementById('correo-invitar') ? document.getElementById('correo-invitar').value : '';
            if (!idGrupo) return;

            showSpinner();
            try {
                const response = await fetch(`/api/grupos/${idGrupo}/invitacion`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ correo })
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

                            const btnModalCopiar = document.getElementById('btn-modal-copiar');
                            btnModalCopiar.addEventListener('click', async () => {
                                try {
                                    const linkInput = document.getElementById('modal-invite-link');
                                    await navigator.clipboard.writeText(linkInput.value);
                                    linkInput.select();
                                    showToast('Enlace copiado al portapapeles.', 'success');
                                    
                                    const originalText = btnModalCopiar.textContent;
                                    btnModalCopiar.textContent = '✔️ Copiado';
                                    setTimeout(() => {
                                        btnModalCopiar.textContent = originalText;
                                    }, 2000);
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

    // --- 6. Onboarding Interactivo (Tour Guiado de Grupos) ---
    const iniciarOnboardingGrupos = () => {
        const onboardingKey = `onboarding_grupos_completed_${usuarioId}`;
        if (!localStorage.getItem(onboardingKey) && window.driver) {
            const driverObj = window.driver.js.driver({
                showProgress: true,
                doneBtnText: '¡Entendido!',
                closeBtnText: 'Saltar',
                nextBtnText: 'Siguiente',
                prevBtnText: 'Anterior',
                allowClose: false,
                steps: [
                    { popover: { title: 'Gestión de Grupos 👥', description: 'Aquí podrás crear y administrar todos tus grupos financieros y de viaje.', position: 'center' } },
                    { element: '#tour-crear-grupo', popover: { title: '1. Crear un Grupo', description: 'Asigna un nombre a tu grupo, como "Viaje al Sur" o "Departamento".', position: 'bottom' } },
                    { element: '#tour-invitar', popover: { title: '2. Invitar Amigos', description: 'Genera un enlace mágico o un código QR para que se unan al instante.', position: 'bottom' } },
                    { element: '#tour-escanear', popover: { title: '3. Escáner Rápido', description: 'Si estás junto a un amigo, usa la cámara para escanear su QR y unirte a su grupo en 2 segundos.', position: 'bottom' } },
                    { element: '#tour-lista-grupos', popover: { title: '4. Administrar', description: 'Revisa tus grupos actuales, cambia sus nombres, o expulsa miembros si eres el administrador.', position: 'top' } }
                ],
                onDestroyStarted: () => {
                    if (!driverObj.hasNextStep() || confirm('¿Seguro que quieres saltar el tutorial? No volverá a mostrarse.')) {
                        localStorage.setItem(onboardingKey, 'true');
                        driverObj.destroy();
                    }
                }
            });
            setTimeout(() => driverObj.drive(), 800); // Esperar que la tabla randerice
        }
    };

    cargarGrupos().then(() => {
        iniciarOnboardingGrupos();
    });
});