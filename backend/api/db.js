import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always load /api/.env regardless of PM2 cwd
dotenv.config({ path: path.join(__dirname, ".env") });

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

// Optional debug (safe-ish) - keep while diagnosing, remove later
console.log("[db] host=", process.env.DB_HOST);
console.log("[db] user=", process.env.DB_USER);
console.log("[db] database=", process.env.DB_NAME);
