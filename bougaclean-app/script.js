const hostname = window.location.hostname || 'localhost';
const API_URL = `http://${hostname}:3000/api`;
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || 'null');

// ===================================================================
// MODAL & TOAST SYSTEM (reemplaza todos los alert/confirm)
// ===================================================================

function showModal(type, title, message, buttons = []) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-overlay');
        const iconEl = document.getElementById('modal-icon');
        const titleEl = document.getElementById('modal-title');
        const msgEl = document.getElementById('modal-message');
        const actionsEl = document.getElementById('modal-actions');

        const icons = {
            success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️', confirm: '🤔'
        };
        iconEl.textContent = icons[type] || '💬';
        titleEl.textContent = title;
        msgEl.textContent = message;

        actionsEl.innerHTML = '';
        if (buttons.length === 0) {
            buttons = [{ text: 'Aceptar', style: 'btn-primary', value: true }];
        }
        buttons.forEach(btn => {
            const b = document.createElement('button');
            b.textContent = btn.text;
            b.className = btn.style || 'btn-primary';
            b.onclick = () => { overlay.classList.add('hidden'); resolve(btn.value); };
            actionsEl.appendChild(b);
        });

        overlay.classList.remove('hidden');
    });
}

function showToast(type, message, duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✅', error: '❌', info: '💡' };
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || '💬'}</span>
        <span class="toast-text">${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

// ===================================================================
// OFFLINE DETECTION
// ===================================================================

window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.add('hidden');
    showToast('success', 'Conexión restaurada');
});
window.addEventListener('offline', () => {
    document.getElementById('offline-banner').classList.remove('hidden');
});

// ===================================================================
// INIT
// ===================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Generar horas para el select
    generateTimeSlots();

    const dateInput = document.getElementById('date');
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today; dateInput.value = today;

    // Splash screen timeout
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 1000);
        
        if (token && user) {
            document.getElementById('user-greeting').innerText = user.nombre;
            showView('dashboard');
            fetchVehicles();
            fetchCitas();
        } else {
            showView('welcome');
        }
    }, 2500);

    calculatePrice();
    loadOccupiedSlots();

    // Auto refresh appointments every 60s
    setInterval(fetchCitas, 60000);

    document.getElementById('login-form').addEventListener('submit', handleAuth);
    document.getElementById('booking-form').addEventListener('submit', createCita);
});

function generateTimeSlots() {
    const timeSelect = document.getElementById('time');
    timeSelect.innerHTML = '';
    for (let i = 8; i <= 18; i++) {
        let hour = i > 12 ? i - 12 : i;
        let ampm = i >= 12 ? 'PM' : 'AM';
        timeSelect.innerHTML += `<option value="${i}:00">${hour}:00 ${ampm}</option>`;
        if (i !== 18) timeSelect.innerHTML += `<option value="${i}:30">${hour}:30 ${ampm}</option>`;
    }
}

// ===================================================================
// NAVEGACIÓN SPA
// ===================================================================

function showView(viewId, actionPanel = null) {
    document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
    
    if (viewId === 'action') {
        document.querySelectorAll('.action-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById(`panel-${actionPanel}`).classList.remove('hidden');
        
        const titles = {
            'booking': 'Agendar Cita',
            'citas': 'Historial de Citas',
            'garage': 'Mi Garage'
        };
        document.getElementById('action-title').innerText = titles[actionPanel];

        // Cargar horarios ocupados cuando se abre booking
        if (actionPanel === 'booking') loadOccupiedSlots();
    }

    if (viewId === 'profile') {
        loadProfile();
    }
    
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    setTimeout(() => {
        document.getElementById(`view-${viewId}`).classList.add('active');
    }, 50);
}

// ===================================================================
// AUTENTICACIÓN
// ===================================================================

async function handleAuth(e) {
    e.preventDefault();
    const nombre = document.getElementById('auth-nombre').value || '';
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    showLoading();
    try {
        // Intenta Login
        let res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        let data = await res.json();
        
        // Si no existe, intenta Registro
        if (!res.ok && data.error === 'Credenciales inválidas' && nombre !== '') {
            res = await fetch(`${API_URL}/auth/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, nombre })
            });
            data = await res.json();
        } else if (!res.ok && data.error === 'Credenciales inválidas' && nombre === '') {
            hideLoading();
            showModal('info', 'Registro Necesario', 'Si eres nuevo, ingresa tu Nombre Completo para crear tu cuenta.');
            return;
        }

        if (data.token) {
            token = data.token;
            user = data.user;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            
            document.getElementById('user-greeting').innerText = user.nombre;
            fetchVehicles();
            fetchCitas();
            
            hideLoading();
            showView('dashboard');
            showToast('success', `¡Bienvenido, ${user.nombre}!`);
        } else {
            hideLoading();
            showModal('error', 'Error', data.error || 'Error de autenticación');
        }
    } catch (error) {
        hideLoading();
        console.error("Auth error", error);
        showModal('error', 'Sin Conexión', 'No se pudo conectar al servidor. Verifica que el backend esté corriendo.');
    }
}

function logout() {
    token = null;
    user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showView('welcome');
    showToast('info', 'Sesión cerrada');
}

// ===================================================================
// PERFIL DE USUARIO
// ===================================================================

function loadProfile() {
    if (!user) return;
    document.getElementById('profile-nombre').value = user.nombre;
    document.getElementById('profile-email').value = user.email;
}

async function updateProfile() {
    const nombre = document.getElementById('profile-nombre').value;
    showLoading();
    try {
        const res = await fetch(`${API_URL}/perfil`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ nombre })
        });
        const data = await res.json();
        hideLoading();
        
        if (res.ok) {
            token = data.token;
            user = data.user;
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            document.getElementById('user-greeting').innerText = user.nombre;
            showToast('success', 'Perfil actualizado correctamente');
        } else {
            showModal('error', 'Error', data.error);
        }
    } catch (e) {
        hideLoading();
        showToast('error', 'Error al actualizar perfil');
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    
    showLoading();
    try {
        const res = await fetch(`${API_URL}/perfil/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        hideLoading();
        
        if (res.ok) {
            showModal('success', 'Contraseña Actualizada', 'Tu contraseña ha sido cambiada exitosamente.');
            document.getElementById('password-form').reset();
        } else {
            showModal('error', 'Error', data.error || 'No se pudo cambiar la contraseña');
        }
    } catch (e) {
        hideLoading();
        showToast('error', 'Error de conexión');
    }
}

// ===================================================================
// VEHICULOS (GARAGE)
// ===================================================================

let vehicles = [];

async function fetchVehicles() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/vehiculos`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            vehicles = await res.json();
            renderVehicles(vehicles);
            populateVehicleSelect(vehicles);
        }
    } catch (error) { console.error("Error fetching vehicles", error); }
}

function renderVehicles(list) {
    const container = document.getElementById('vehicle-list');
    container.innerHTML = '';
    
    if(list.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No hay vehículos registrados. Agrega uno.</p>';
        return;
    }

    list.forEach((v, i) => {
        const el = document.createElement('div');
        el.className = 'vehicle-item';
        el.style.animationDelay = `${i * 0.1}s`;
        el.innerHTML = `
            <div class="vehicle-info">
                <h4>${v.marca} ${v.modelo}</h4>
                <p>${v.año} • ${v.color} • Placa: ${v.placa}</p>
            </div>
            <button class="btn-danger" onclick="removeVehicle('${v.id}')">✕</button>
        `;
        container.appendChild(el);
    });
}

function populateVehicleSelect(list) {
    let selectContainer = document.getElementById('vehicle-select-container');
    if (!selectContainer) {
        const formGroup = document.createElement('div');
        formGroup.className = 'form-group mt-4';
        formGroup.id = 'vehicle-select-container';
        
        const label = document.createElement('label');
        label.innerText = 'Vehículo a lavar';
        
        const select = document.createElement('select');
        select.id = 'vehicle-select';
        select.className = 'styled-select w-full';
        select.required = true;
        
        formGroup.appendChild(label);
        formGroup.appendChild(select);
        
        const serviceGroup = document.getElementById('service').parentElement;
        serviceGroup.after(formGroup);
    }
    
    const select = document.getElementById('vehicle-select');
    select.innerHTML = '<option value="">Selecciona tu vehículo</option>';
    list.forEach(v => {
        select.innerHTML += `<option value="${v.id}">${v.marca} ${v.modelo} (${v.placa})</option>`;
    });
}

async function addVehicle() {
    const v = {
        marca: document.getElementById('v-marca').value,
        modelo: document.getElementById('v-modelo').value,
        año: document.getElementById('v-año').value,
        color: document.getElementById('v-color').value,
        placa: document.getElementById('v-placa').value
    };

    showLoading();
    try {
        const res = await fetch(`${API_URL}/vehiculos`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(v)
        });
        hideLoading();
        if (res.ok) {
            fetchVehicles();
            document.getElementById('add-vehicle-form').reset();
            document.getElementById('add-vehicle-form').style.display = 'none';
            showToast('success', `${v.marca} ${v.modelo} agregado al garage`);
        } else {
            const data = await res.json();
            showModal('error', 'Error', data.error);
        }
    } catch (e) { hideLoading(); console.error(e); }
}

async function removeVehicle(id) {
    const confirmed = await showModal('confirm', '¿Eliminar Vehículo?', 'Esta acción no se puede deshacer.', [
        { text: 'Cancelar', style: 'btn-secondary', value: false },
        { text: 'Eliminar', style: 'btn-primary', value: true }
    ]);
    
    if (confirmed) {
        showLoading();
        await fetch(`${API_URL}/vehiculos/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        hideLoading();
        fetchVehicles();
        showToast('info', 'Vehículo eliminado');
    }
}

// ===================================================================
// BLOQUEO DE HORARIOS OCUPADOS
// ===================================================================

async function loadOccupiedSlots() {
    const fecha = document.getElementById('date').value;
    if (!fecha || !token) return;
    
    try {
        const res = await fetch(`${API_URL}/citas/horarios-ocupados?fecha=${fecha}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const horasOcupadas = await res.json();
            markOccupiedSlots(horasOcupadas);
        }
    } catch (e) { console.error('Error loading slots', e); }
}

function markOccupiedSlots(horasOcupadas) {
    const timeSelect = document.getElementById('time');
    // Regenerar opciones primero
    generateTimeSlots();
    
    // Marcar las ocupadas
    Array.from(timeSelect.options).forEach(option => {
        if (horasOcupadas.includes(option.value)) {
            option.disabled = true;
            option.textContent += ' — Ocupado';
        }
    });

    // Si la selección actual está ocupada, seleccionar la primera libre
    if (timeSelect.selectedOptions[0] && timeSelect.selectedOptions[0].disabled) {
        const firstFree = Array.from(timeSelect.options).find(o => !o.disabled);
        if (firstFree) firstFree.selected = true;
    }
}

// ===================================================================
// CITAS Y RESERVAS
// ===================================================================

const serviceData = {
    'basico': { price: 15.00, time: '45 min' },
    'premium': { price: 35.00, time: '1h 30m' },
    'detallado': { price: 80.00, time: '3h 00m' },
    'pulido': { price: 120.00, time: '4h 00m' }
};

function calculatePrice() {
    const service = document.getElementById('service').value;
    const data = serviceData[service];
    document.getElementById('est-price').innerText = `$${data.price.toFixed(2)}`;
    document.getElementById('est-time').innerText = data.time;
    return data.price;
}

async function createCita(e) {
    e.preventDefault();

    const select = document.getElementById('vehicle-select');
    if(!select || !select.value) {
        showModal('warning', 'Vehículo Requerido', 'Selecciona un vehículo. Si no tienes uno, ve a "Mi Garage" a registrarlo primero.');
        return;
    }

    const cita = {
        id_vehiculo: select.value,
        fecha_hora: document.getElementById('date').value + " " + document.getElementById('time').value,
        tipo_servicio: document.getElementById('service').options[document.getElementById('service').selectedIndex].text,
        direccion: document.getElementById('direccion').value,
        precio_final: calculatePrice()
    };

    showLoading();
    try {
        const res = await fetch(`${API_URL}/citas`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(cita)
        });
        hideLoading();
        
        if (res.ok) {
            await showModal('success', '¡Cita Reservada!', 'Tu cita ha sido confirmada exitosamente. Revisa tu correo electrónico para la confirmación.');
            fetchCitas();
            showView('dashboard');
        } else {
            const data = await res.json();
            showModal('error', 'Horario No Disponible', data.error || 'Error al reservar');
        }
    } catch (error) { hideLoading(); console.error(error); }
}

async function fetchCitas() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/citas`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const citas = await res.json();
            renderCitas(citas);
        }
    } catch (error) { console.error("Error fetching citas", error); }
}

function renderCitas(list) {
    const container = document.getElementById('citas-list');
    container.innerHTML = '';
    
    if(list.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No tienes citas programadas.</p>';
        return;
    }

    list.forEach((c, i) => {
        const statusClass = {
            'Pendiente': 'status-pendiente',
            'Confirmada': 'status-pendiente',
            'En Proceso': 'status-proceso',
            'Completada': 'status-completada',
            'Cancelada': 'status-cancelada'
        }[c.estado] || 'status-pendiente';

        let cancelBtn = c.estado === 'Pendiente' ? 
            `<button class="btn-danger" style="margin-top: 10px; width:100%;" onclick="cancelarCita('${c.id_cita}')">Cancelar Cita</button>` : '';
        
        let notasHTML = c.notas ? `<div class="cita-notas">📝 ${c.notas}</div>` : '';

        const el = document.createElement('div');
        el.className = 'vehicle-item';
        el.style.cssText = 'flex-direction: column; align-items: flex-start;';
        el.style.animationDelay = `${i * 0.1}s`;
        el.innerHTML = `
            <div style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 5px;">
                <h4 style="color: var(--text-main)">${c.tipo_servicio}</h4>
                <span class="status-badge ${statusClass}">${c.estado}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); width: 100%;">
                <p>📅 ${c.fecha_hora}</p>
                <p>📍 ${c.direccion}</p>
                <p>🚗 ${c.marca} ${c.modelo} (${c.placa})</p>
                <p style="color:var(--accent); font-weight:bold;">Total: $${c.precio_final.toFixed(2)}</p>
            </div>
            ${notasHTML}
            ${cancelBtn}
        `;
        container.appendChild(el);
    });
}

async function cancelarCita(id) {
    const confirmed = await showModal('confirm', '¿Cancelar Cita?', '¿Estás seguro de que deseas cancelar esta cita?', [
        { text: 'No, mantener', style: 'btn-secondary', value: false },
        { text: 'Sí, cancelar', style: 'btn-primary', value: true }
    ]);
    
    if (confirmed) {
        showLoading();
        try {
            await fetch(`${API_URL}/citas/${id}/estado`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ estado: 'Cancelada' })
            });
            hideLoading();
            fetchCitas();
            showToast('info', 'Cita cancelada');
        } catch (e) { hideLoading(); console.error(e); }
    }
}
