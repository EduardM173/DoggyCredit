import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const client = await pool.connect();
  const res = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Evaluation';
  `);
  console.log("Evaluation indexes:", res.rows);
  client.release();
}

check().then(() => pool.end());
