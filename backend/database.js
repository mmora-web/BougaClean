require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');

let db;

// Si existe una URL de base de datos en las variables de entorno, usamos PostgreSQL (Producción)
// Si no, usamos SQLite (Desarrollo local)
if (process.env.DATABASE_URL) {
    console.log('🚀 Conectando a PostgreSQL (Producción)...');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Requerido por la mayoría de servicios de hosting
    });

    // Adaptador corregido para PostgreSQL: usa un contador incremental para $1, $2, $3...
    db = {
        run: (sql, params, cb) => {
            let count = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++count}`);
            pool.query(pgSql, params, cb);
        },
        get: (sql, params, cb) => {
            let count = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++count}`);
            pool.query(pgSql, params).then(res => cb(null, res.rows[0])).catch(err => cb(err));
        },
        all: (sql, params, cb) => {
            let count = 0;
            const pgSql = sql.replace(/\?/g, () => `$${++count}`);
            pool.query(pgSql, params).then(res => cb(null, res.rows)).catch(err => cb(err));
        },
        serialize: (fn) => fn()
    };
    initializeDB();
} else {
    try {
        const sqlite3 = require('sqlite3').verbose();
        console.log('💻 Conectando a SQLite (Desarrollo)...');
        const dbPath = path.resolve(__dirname, 'database.sqlite');
        const sqliteDb = new sqlite3.Database(dbPath, (err) => {
            if (err) console.error('Error connecting to SQLite:', err.message);
            else initializeDB();
        });
        db = sqliteDb;
    } catch (e) {
        console.error('❌ No se pudo cargar SQLite. Asegúrate de que esté instalado para desarrollo local.');
    }
}

function initializeDB() {
    db.serialize(() => {
        // Tablas base
        db.run(`CREATE TABLE IF NOT EXISTS USUARIOS (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nombre TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS VEHICULOS (
            id TEXT PRIMARY KEY,
            id_usuario TEXT NOT NULL,
            marca TEXT NOT NULL,
            modelo TEXT NOT NULL,
            año TEXT NOT NULL,
            color TEXT NOT NULL,
            placa TEXT NOT NULL UNIQUE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS CITAS (
            id_cita TEXT PRIMARY KEY,
            id_usuario TEXT NOT NULL,
            id_vehiculo TEXT NOT NULL,
            fecha_hora TEXT NOT NULL,
            tipo_servicio TEXT NOT NULL,
            direccion TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'Pendiente',
            precio_final REAL NOT NULL,
            notas TEXT DEFAULT ''
        )`);

        // Migración: Columna notas
        db.run(`ALTER TABLE CITAS ADD COLUMN notas TEXT DEFAULT ''`, (err) => {});
        
        console.log('✅ Base de datos inicializada correctamente.');
    });
}

module.exports = db;
