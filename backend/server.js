require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

// Servir las apps frontend como archivos estáticos
app.use('/', express.static(path.join(__dirname, '..', 'bougaclean-app', 'www')));
app.use('/colaborador', express.static(path.join(__dirname, '..', 'colaborador-app')));

const JWT_SECRET = process.env.JWT_SECRET || 'bougaclean_dev_secret';
const SALT_ROUNDS = 10;

// --- Configuración de Nodemailer (Ethereal Email para desarrollo) ---
let transporter;
nodemailer.createTestAccount((err, account) => {
    if (err) return console.error('Error creando cuenta Ethereal: ' + err.message);
    transporter = nodemailer.createTransport({
        host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass }
    });
    console.log('✅ Nodemailer listo (Ethereal).');
});

function enviarEmail(to, subject, text) {
    if(!transporter) return;
    transporter.sendMail({ from: '"BougaClean" <no-reply@bougaclean.com>', to, subject, text }, (err, info) => {
        if(err) return console.log(err);
        console.log('--- EMAIL ENVIADO ---');
        console.log(`Para: ${to} | Asunto: ${subject}`);
        console.log('Ver el correo aquí: %s', nodemailer.getTestMessageUrl(info));
        console.log('---------------------');
    });
}

// --- Middleware de Autenticación ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// ===================================================================
// --- RUTAS DE AUTENTICACIÓN ---
// ===================================================================

// Registro (con bcrypt)
app.post('/api/auth/register', async (req, res) => {
    const { email, password, nombre } = req.body;
    const id = crypto.randomUUID();

    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        db.run(`INSERT INTO USUARIOS (id, email, password, nombre) VALUES (?, ?, ?, ?)`, 
        [id, email, hashedPassword, nombre], function(err) {
            if (err) {
                return res.status(400).json({ error: 'El email ya está registrado' });
            }
            
            const token = jwt.sign({ id, email, nombre }, JWT_SECRET, { expiresIn: '24h' });
            
            // Enviar Email de Bienvenida
            enviarEmail(email, '¡Bienvenido a BougaClean!', `Hola ${nombre},\n\nGracias por registrarte en BougaClean. Tu cuenta ha sido creada exitosamente. ¡Estamos listos para darle el mejor cuidado a tus vehículos!\n\nSaludos,\nEl Equipo de BougaClean`);
            
            res.json({ token, user: { id, email, nombre } });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Login (con bcrypt)
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    db.get(`SELECT * FROM USUARIOS WHERE email = ?`, [email], async (err, row) => {
        if (err || !row) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        
        try {
            // Intentar bcrypt primero, si falla, comparar texto plano (migración gradual)
            let passwordMatch = false;
            try {
                passwordMatch = await bcrypt.compare(password, row.password);
            } catch(e) {
                // Si la contraseña no es un hash bcrypt, comparar directamente (usuarios viejos)
                passwordMatch = (password === row.password);
                if (passwordMatch) {
                    // Migrar la contraseña a bcrypt
                    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
                    db.run(`UPDATE USUARIOS SET password = ? WHERE id = ?`, [hashed, row.id]);
                    console.log(`🔄 Contraseña migrada a bcrypt para: ${email}`);
                }
            }
            
            if (!passwordMatch) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }
            
            const token = jwt.sign({ id: row.id, email: row.email, nombre: row.nombre }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token, user: { id: row.id, email: row.email, nombre: row.nombre } });
        } catch (error) {
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });
});

// ===================================================================
// --- RUTAS DE PERFIL DE USUARIO ---
// ===================================================================

// Ver perfil
app.get('/api/perfil', authenticateToken, (req, res) => {
    db.get(`SELECT id, email, nombre FROM USUARIOS WHERE id = ?`, [req.user.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(row);
    });
});

// Actualizar perfil (nombre)
app.put('/api/perfil', authenticateToken, (req, res) => {
    const { nombre } = req.body;
    db.run(`UPDATE USUARIOS SET nombre = ? WHERE id = ?`, [nombre, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Generar nuevo token con nombre actualizado
        const newToken = jwt.sign({ id: req.user.id, email: req.user.email, nombre }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Perfil actualizado', token: newToken, user: { id: req.user.id, email: req.user.email, nombre } });
    });
});

// Cambiar contraseña
app.put('/api/perfil/password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    db.get(`SELECT password FROM USUARIOS WHERE id = ?`, [req.user.id], async (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Usuario no encontrado' });
        
        try {
            let passwordMatch = false;
            try {
                passwordMatch = await bcrypt.compare(currentPassword, row.password);
            } catch(e) {
                passwordMatch = (currentPassword === row.password);
            }
            
            if (!passwordMatch) {
                return res.status(401).json({ error: 'Contraseña actual incorrecta' });
            }
            
            const hashedNew = await bcrypt.hash(newPassword, SALT_ROUNDS);
            db.run(`UPDATE USUARIOS SET password = ? WHERE id = ?`, [hashedNew, req.user.id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Contraseña actualizada exitosamente' });
            });
        } catch (error) {
            res.status(500).json({ error: 'Error interno' });
        }
    });
});

// ===================================================================
// --- RUTAS DE VEHÍCULOS (Requieren Auth) ---
// ===================================================================

app.get('/api/vehiculos', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM VEHICULOS WHERE id_usuario = ?`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/vehiculos', authenticateToken, (req, res) => {
    const { marca, modelo, año, color, placa } = req.body;
    const id = crypto.randomUUID();

    db.run(`INSERT INTO VEHICULOS (id, id_usuario, marca, modelo, año, color, placa) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.id, marca, modelo, año, color, placa], function(err) {
        if (err) return res.status(400).json({ error: 'Error al agregar vehículo (¿Placa duplicada?)' });
        res.json({ message: 'Vehículo agregado', id });
    });
});

app.delete('/api/vehiculos/:id', authenticateToken, (req, res) => {
    db.run(`DELETE FROM VEHICULOS WHERE id = ? AND id_usuario = ?`, [req.params.id, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Vehículo eliminado' });
    });
});

// ===================================================================
// --- RUTAS DE CITAS / RESERVAS (Requieren Auth) ---
// ===================================================================

// Obtener horarios ocupados para una fecha específica
app.get('/api/citas/horarios-ocupados', authenticateToken, (req, res) => {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
    
    db.all(`SELECT fecha_hora, tipo_servicio FROM CITAS WHERE fecha_hora LIKE ? AND estado NOT IN ('Cancelada')`, 
    [`${fecha}%`], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Extraer las horas ocupadas
        const horasOcupadas = rows.map(r => {
            const parts = r.fecha_hora.split(' ');
            return parts.length > 1 ? parts[1] : '';
        });
        res.json(horasOcupadas);
    });
});

app.get('/api/citas', authenticateToken, (req, res) => {
    // Joins with VEHICULOS to get vehicle details
    db.all(`
        SELECT CITAS.*, VEHICULOS.marca, VEHICULOS.modelo, VEHICULOS.placa 
        FROM CITAS 
        JOIN VEHICULOS ON CITAS.id_vehiculo = VEHICULOS.id 
        WHERE CITAS.id_usuario = ? 
        ORDER BY fecha_hora DESC`, 
    [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/citas', authenticateToken, (req, res) => {
    const { id_vehiculo, fecha_hora, tipo_servicio, direccion, precio_final } = req.body;
    const id_cita = crypto.randomUUID();

    // Validar bloqueo de horario
    db.get(`SELECT id_cita FROM CITAS WHERE fecha_hora = ? AND estado NOT IN ('Cancelada')`, [fecha_hora], (err, existing) => {
        if (existing) {
            return res.status(409).json({ error: 'Este horario ya está reservado. Por favor selecciona otro.' });
        }

        db.run(`INSERT INTO CITAS (id_cita, id_usuario, id_vehiculo, fecha_hora, tipo_servicio, direccion, precio_final) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id_cita, req.user.id, id_vehiculo, fecha_hora, tipo_servicio, direccion, precio_final], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Enviar Email de Confirmación
            enviarEmail(req.user.email, 'Confirmación de tu cita - BougaClean', `Hola ${req.user.nombre},\n\nTu cita para un ${tipo_servicio} ha sido confirmada.\n\nFecha y Hora: ${fecha_hora}\nDirección: ${direccion}\nTotal Estimado: $${precio_final.toFixed(2)}\n\nNuestros especialistas llegarán a tiempo.\n\nSaludos,\nEl Equipo de BougaClean`);
            
            res.json({ message: 'Cita reservada con éxito', id_cita });
        });
    });
});

app.put('/api/citas/:id/estado', authenticateToken, (req, res) => {
    const { estado } = req.body; // Pendiente, Confirmada, En Proceso, Completada, Cancelada
    db.run(`UPDATE CITAS SET estado = ? WHERE id_cita = ?`, [estado, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Estado actualizado' });
    });
});

// ===================================================================
// --- RUTAS DE ADMINISTRADOR / COLABORADOR ---
// ===================================================================

app.get('/api/admin/citas', (req, res) => {
    const { fecha, estado, busqueda } = req.query;
    
    let query = `
        SELECT CITAS.*, USUARIOS.nombre as cliente_nombre, USUARIOS.email as cliente_email,
               VEHICULOS.marca, VEHICULOS.modelo, VEHICULOS.color, VEHICULOS.placa
        FROM CITAS 
        JOIN USUARIOS ON CITAS.id_usuario = USUARIOS.id
        JOIN VEHICULOS ON CITAS.id_vehiculo = VEHICULOS.id
    `;
    
    const conditions = [];
    const params = [];
    
    if (fecha) {
        conditions.push(`CITAS.fecha_hora LIKE ?`);
        params.push(`${fecha}%`);
    }
    if (estado && estado !== 'Todas') {
        conditions.push(`CITAS.estado = ?`);
        params.push(estado);
    }
    if (busqueda) {
        conditions.push(`(USUARIOS.nombre LIKE ? OR VEHICULOS.placa LIKE ? OR VEHICULOS.marca LIKE ?)`);
        params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
    }
    
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY CITAS.fecha_hora ASC';
    
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Estadísticas del día
app.get('/api/admin/estadisticas', (req, res) => {
    const hoy = new Date().toISOString().split('T')[0];
    
    const stats = {};
    
    db.get(`SELECT COUNT(*) as total FROM CITAS WHERE fecha_hora LIKE ?`, [`${hoy}%`], (err, row) => {
        stats.citasHoy = row ? row.total : 0;
        
        db.get(`SELECT COUNT(*) as total FROM CITAS WHERE estado = 'Pendiente'`, [], (err, row) => {
            stats.pendientes = row ? row.total : 0;
            
            db.get(`SELECT COUNT(*) as total FROM CITAS WHERE estado = 'En Proceso'`, [], (err, row) => {
                stats.enProceso = row ? row.total : 0;
                
                db.get(`SELECT COUNT(*) as total FROM CITAS WHERE estado = 'Completada'`, [], (err, row) => {
                    stats.completadas = row ? row.total : 0;
                    
                    db.get(`SELECT COALESCE(SUM(precio_final), 0) as total FROM CITAS WHERE estado = 'Completada'`, [], (err, row) => {
                        stats.ingresosTotal = row ? row.total : 0;
                        
                        db.get(`SELECT COALESCE(SUM(precio_final), 0) as total FROM CITAS WHERE estado = 'Completada' AND fecha_hora LIKE ?`, [`${hoy}%`], (err, row) => {
                            stats.ingresosHoy = row ? row.total : 0;
                            
                            // Servicios más populares
                            db.all(`SELECT tipo_servicio, COUNT(*) as cantidad FROM CITAS GROUP BY tipo_servicio ORDER BY cantidad DESC LIMIT 5`, [], (err, rows) => {
                                stats.serviciosPopulares = rows || [];
                                
                                db.get(`SELECT COUNT(*) as total FROM CITAS WHERE estado = 'Cancelada'`, [], (err, row) => {
                                    stats.canceladas = row ? row.total : 0;
                                    res.json(stats);
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.put('/api/admin/citas/:id/estado', (req, res) => {
    const { estado } = req.body;
    console.log(`[ADMIN] Actualizando cita ${req.params.id} a estado: ${estado}`);
    db.run(`UPDATE CITAS SET estado = ? WHERE id_cita = ?`, [estado, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Estado actualizado por admin' });
    });
});

// Agregar/actualizar notas del colaborador
app.put('/api/admin/citas/:id/notas', (req, res) => {
    const { notas } = req.body;
    db.run(`UPDATE CITAS SET notas = ? WHERE id_cita = ?`, [notas, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Notas actualizadas' });
    });
});

// ===================================================================
// Inicializar Servidor
// ===================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Server running on http://localhost:${PORT}`);
    console.log(`📱 Accede desde tu celular: http://10.16.16.225:${PORT}`);
    console.log(`👷 Panel colaborador: http://10.16.16.225:${PORT}/colaborador`);
});
