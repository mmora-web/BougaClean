const hostname = '10.16.16.225';
const API_URL = `http://${hostname}:3000/api`;

// ===================================================================
// TOAST & LOADING
// ===================================================================

function showToast(type, message, duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: '💡' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || '💬'}</span><span class="toast-text">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, duration);
}

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

// ===================================================================
// NOTES MODAL
// ===================================================================

function openNotesModal(citaId, currentNotes) {
    document.getElementById('notes-cita-id').value = citaId;
    document.getElementById('notes-input').value = currentNotes || '';
    document.getElementById('notes-modal').classList.remove('hidden');
}

function closeNotesModal() {
    document.getElementById('notes-modal').classList.add('hidden');
}

async function saveNotes() {
    const id = document.getElementById('notes-cita-id').value;
    const notas = document.getElementById('notes-input').value;
    
    showLoading();
    try {
        await fetch(`${API_URL}/admin/citas/${id}/notas`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notas })
        });
        hideLoading();
        closeNotesModal();
        showToast('success', 'Notas guardadas');
        fetchCitas();
    } catch(e) {
        hideLoading();
        showToast('error', 'Error al guardar notas');
    }
}

// ===================================================================
// DEBOUNCE FOR SEARCH
// ===================================================================

let searchTimeout;
function debouncedSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(fetchCitas, 400);
}

// ===================================================================
// INIT
// ===================================================================

document.addEventListener('DOMContentLoaded', () => {
    refreshAll();
    // Auto refresh every 30 seconds
    setInterval(refreshAll, 30000);
});

function refreshAll() {
    fetchStats();
    fetchCitas();
    showToast('info', 'Datos actualizados');
}

// ===================================================================
// STATISTICS
// ===================================================================

async function fetchStats() {
    try {
        const res = await fetch(`${API_URL}/admin/estadisticas`);
        if (res.ok) {
            const stats = await res.json();
            renderStats(stats);
        }
    } catch (e) { console.error("Error fetching stats", e); }
}

function renderStats(stats) {
    document.getElementById('stat-pendientes').textContent = stats.pendientes;
    document.getElementById('stat-proceso').textContent = stats.enProceso;
    document.getElementById('stat-completadas').textContent = stats.completadas;
    document.getElementById('stat-ingresos').textContent = `$${stats.ingresosTotal.toFixed(2)}`;

    // Render service pills
    const list = document.getElementById('services-list');
    list.innerHTML = '';
    if (stats.serviciosPopulares.length === 0) {
        list.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Sin datos aún</span>';
    } else {
        stats.serviciosPopulares.forEach(s => {
            list.innerHTML += `
                <div class="service-pill">
                    <span>${s.tipo_servicio}</span>
                    <span class="pill-count">${s.cantidad}</span>
                </div>
            `;
        });
    }
}

// ===================================================================
// CITAS (with filters)
// ===================================================================

async function fetchCitas() {
    try {
        const fecha = document.getElementById('filter-fecha').value;
        const estado = document.getElementById('filter-estado').value;
        const busqueda = document.getElementById('filter-busqueda').value;
        
        let url = `${API_URL}/admin/citas?`;
        if (fecha) url += `fecha=${fecha}&`;
        if (estado) url += `estado=${estado}&`;
        if (busqueda) url += `busqueda=${encodeURIComponent(busqueda)}&`;
        
        const res = await fetch(url);
        if (res.ok) {
            const citas = await res.json();
            renderKanban(citas);
        }
    } catch (e) {
        console.error("Error fetching citas", e);
    }
}

function renderKanban(citas) {
    const colPendiente = document.querySelector('#col-pendiente .task-list');
    const colProceso = document.querySelector('#col-proceso .task-list');
    const colCompletada = document.querySelector('#col-completada .task-list');

    colPendiente.innerHTML = '';
    colProceso.innerHTML = '';
    colCompletada.innerHTML = '';

    let counts = { pendiente: 0, proceso: 0, completada: 0 };

    citas.forEach(c => {
        if (c.estado === 'Cancelada') return;

        let btnHTML = '';
        if (c.estado === 'Pendiente') {
            btnHTML = `
                <button class="btn-small btn-primary" onclick="cambiarEstado('${c.id_cita}', 'En Proceso')">▶ Iniciar</button>
                <button class="btn-small btn-notes" onclick="openNotesModal('${c.id_cita}', '${(c.notas || '').replace(/'/g, "\\'")}')">📝</button>
            `;
        } else if (c.estado === 'En Proceso') {
            btnHTML = `
                <button class="btn-small btn-primary" onclick="cambiarEstado('${c.id_cita}', 'Completada')">✓ Completar</button>
                <button class="btn-small btn-notes" onclick="openNotesModal('${c.id_cita}', '${(c.notas || '').replace(/'/g, "\\'")}')">📝</button>
            `;
        } else if (c.estado === 'Completada') {
            btnHTML = `
                <div class="task-complete-badge">✔ Finalizada</div>
                <button class="btn-small btn-notes" onclick="openNotesModal('${c.id_cita}', '${(c.notas || '').replace(/'/g, "\\'")}')">📝</button>
            `;
        }

        const notesHTML = c.notas ? `<div class="task-notes">📝 ${c.notas}</div>` : '';

        const card = `
            <div class="task-card">
                <div class="task-header">
                    <span class="task-time">📅 ${c.fecha_hora}</span>
                    <span class="task-service">${c.tipo_servicio}</span>
                </div>
                <div class="task-details">
                    <p><strong>Cliente:</strong> ${c.cliente_nombre}</p>
                    <p><strong>Email:</strong> ${c.cliente_email}</p>
                    <p><strong>Ubicación:</strong> ${c.direccion}</p>
                    <p><strong>Vehículo:</strong> ${c.marca} ${c.modelo} - ${c.color}</p>
                    <p><strong>Placa:</strong> ${c.placa}</p>
                    <p class="task-price">Total: $${c.precio_final.toFixed(2)}</p>
                </div>
                ${notesHTML}
                <div class="btn-group">
                    ${btnHTML}
                </div>
            </div>
        `;

        if (c.estado === 'Pendiente' || c.estado === 'Confirmada') {
            colPendiente.innerHTML += card;
            counts.pendiente++;
        } else if (c.estado === 'En Proceso') {
            colProceso.innerHTML += card;
            counts.proceso++;
        } else if (c.estado === 'Completada') {
            colCompletada.innerHTML += card;
            counts.completada++;
        }
    });

    // Update counts
    document.getElementById('count-pendiente').textContent = counts.pendiente;
    document.getElementById('count-proceso').textContent = counts.proceso;
    document.getElementById('count-completada').textContent = counts.completada;

    // Empty states
    if (counts.pendiente === 0) colPendiente.innerHTML = '<div class="empty-state">Sin citas pendientes</div>';
    if (counts.proceso === 0) colProceso.innerHTML = '<div class="empty-state">Sin trabajos activos</div>';
    if (counts.completada === 0) colCompletada.innerHTML = '<div class="empty-state">Sin completadas</div>';
}

async function cambiarEstado(id, nuevoEstado) {
    showLoading();
    try {
        await fetch(`${API_URL}/admin/citas/${id}/estado`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        hideLoading();
        
        const msgs = {
            'En Proceso': '🔧 Trabajo iniciado',
            'Completada': '✅ Servicio completado'
        };
        showToast('success', msgs[nuevoEstado] || 'Estado actualizado');
        
        refreshAll();
    } catch(e) { 
        hideLoading();
        showToast('error', 'Error al actualizar estado');
        console.error(e); 
    }
}
