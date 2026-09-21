const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicialización automática de tablas al arrancar el servidor
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sucursales_y_usuarios (
        id SERIAL PRIMARY KEY,
        nombre_sucursal VARCHAR(100) NOT NULL,
        email_usuario VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(50) DEFAULT 'OPERADOR',
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        sucursal_id INT REFERENCES sucursales_y_usuarios(id) ON DELETE CASCADE,
        nombre_cliente VARCHAR(200) NOT NULL,
        cuit VARCHAR(20),
        email VARCHAR(150),
        telefono VARCHAR(50),
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS facturas_y_deudas (
        id SERIAL PRIMARY KEY,
        cliente_id INT REFERENCES clientes(id) ON DELETE CASCADE,
        empresa VARCHAR(100),
        comprobante VARCHAR(100) NOT NULL,
        fecha_emision DATE,
        fecha_vencimiento DATE,
        moneda VARCHAR(10) DEFAULT 'ARS',
        monto NUMERIC(15, 2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS historial_gestiones_y_eventos (
        id SERIAL PRIMARY KEY,
        sucursal_id INT REFERENCES sucursales_y_usuarios(id),
        cliente_id INT REFERENCES clientes(id) ON DELETE CASCADE,
        canal VARCHAR(20) NOT NULL,
        estado_gestion VARCHAR(50) NOT NULL,
        fecha_promesa_pago DATE,
        notas_observaciones TEXT,
        ruta_comprobante VARCHAR(255),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tablas verificadas/creadas correctamente en PostgreSQL.');
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err);
  }
}

app.get('/', (req, res) => {
  res.send('API de Cobranzas Campo y Asociados Operativa 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  initDB();
});
