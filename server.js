const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// Habilitar CORS para permitir llamadas desde archivos locales y cualquier dominio
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicialización simplificada
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historial_gestiones_y_eventos (
        id SERIAL PRIMARY KEY,
        sucursal_id INT,
        cliente_id INT,
        canal VARCHAR(50),
        estado_gestion VARCHAR(50),
        fecha_promesa_pago DATE,
        notas_observaciones TEXT,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Base de datos conectada y tabla verificada.');
  } catch (err) {
    console.error('❌ Error de conexión DB:', err.message);
  }
}

app.get('/', (req, res) => {
  res.json({ estado: 'OK', servicio: 'Cobranzas Campo Backend' });
});

app.get('/api/historial', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM historial_gestiones_y_eventos ORDER BY fecha_registro DESC');
    res.json(resultado.rows);
  } catch (err) {
    console.error('Error en /api/historial:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gestiones', async (req, res) => {
  const { sucursal_id, cliente_id, canal, estado_gestion, fecha_promesa_pago, notas_observaciones } = req.body;
  try {
    const promesa = fecha_promesa_pago || null;
    const resultado = await pool.query(
      `INSERT INTO historial_gestiones_y_eventos 
       (sucursal_id, cliente_id, canal, estado_gestion, fecha_promesa_pago, notas_observaciones) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sucursal_id || 1, cliente_id || 1, canal, estado_gestion, promesa, notas_observaciones]
    );
    res.status(201).json({ exito: true, gestion: resultado.rows[0] });
  } catch (err) {
    console.error('Error en /api/gestiones:', err);
    res.status(500).json({ exito: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
  initDB();
});
