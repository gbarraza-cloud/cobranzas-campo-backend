const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// Configuración de Middlewares (Cruciales para procesar JSON y permitir solicitudes del Frontend)
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Conexión a la base de datos PostgreSQL en Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicialización de la estructura de tablas
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
        sucursal_id INT,
        nombre_cliente VARCHAR(200) NOT NULL,
        cuit VARCHAR(20),
        email VARCHAR(150),
        telefono VARCHAR(50),
        fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS facturas_y_deudas (
        id SERIAL PRIMARY KEY,
        cliente_id INT,
        empresa VARCHAR(100),
        comprobante VARCHAR(100) NOT NULL,
        fecha_emision DATE,
        fecha_vencimiento DATE,
        moneda VARCHAR(10) DEFAULT 'ARS',
        monto NUMERIC(15, 2) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS historial_gestiones_y_eventos (
        id SERIAL PRIMARY KEY,
        sucursal_id INT,
        cliente_id INT,
        canal VARCHAR(20) NOT NULL,
        estado_gestion VARCHAR(50) NOT NULL,
        fecha_promesa_pago DATE,
        notas_observaciones TEXT,
        ruta_comprobante VARCHAR(255),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tablas verificadas y listas en PostgreSQL.');
  } catch (err) {
    console.error('❌ Error al inicializar tablas:', err);
  }
}

// Ruta principal de salud del servidor
app.get('/', (req, res) => {
  res.json({ status: 'OK', mensaje: 'API de Cobranzas Campo y Asociados Operativa 🚀' });
});

// Ruta para recibir y guardar las gestiones
app.post('/api/gestiones', async (req, res) => {
  const { sucursal_id, cliente_id, canal, estado_gestion, fecha_promesa_pago, notas_observaciones } = req.body;
  try {
    const promesaPagoValida = fecha_promesa_pago ? fecha_promesa_pago : null;
    
    const resultado = await pool.query(
      `INSERT INTO historial_gestiones_y_eventos 
       (sucursal_id, cliente_id, canal, estado_gestion, fecha_promesa_pago, notas_observaciones) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sucursal_id || 1, cliente_id || 1, canal, estado_gestion, promesaPagoValida, notas_observaciones]
    );
    res.status(201).json({ exito: true, gestion: resultado.rows[0] });
  } catch (err) {
    console.error('Error al insertar gestión:', err);
    res.status(500).json({ exito: false, error: err.message });
  }
});

// Ruta para obtener el historial
app.get('/api/historial', async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT h.*, c.nombre_cliente, s.nombre_sucursal 
      FROM historial_gestiones_y_eventos h
      LEFT JOIN clientes c ON h.cliente_id = c.id
      LEFT JOIN sucursales_y_usuarios s ON h.sucursal_id = s.id
      ORDER BY h.fecha_registro DESC
    `);
    res.json(resultado.rows);
  } catch (err) {
    console.error('Error al consultar historial:', err);
    res.status(500).json({ error: 'Error al consultar historial' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
  initDB();
});
