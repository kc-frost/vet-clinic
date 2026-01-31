

// Import Express Router to create modular API routes
import { Router } from "express";

// Import the MySQL connection pool
import { pool } from "../db.js";

/**
 * Generic CRUD router for a single table:
 * GET    /        -> list rows
 * GET    /:id     -> get one row by primary key
 * POST   /        -> insert row (requires all required DB fields)
 * DELETE /:id     -> delete by primary key
 *
 * It reads table metadata from INFORMATION_SCHEMA
 */

const metaCache = new Map();

/**
 * Fetch metadata about a database table (columns, primary key, required fields)
 */
async function getTableMeta(tableName) {
    // Return cached metadata if it already exists
  if (metaCache.has(tableName)) return metaCache.get(tableName);

   const [cols] = await pool.query(
    `
    SELECT 
      COLUMN_NAME,
      IS_NULLABLE,
      COLUMN_DEFAULT,
      EXTRA
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
    `,
    [tableName]
  );

  if (!cols || cols.length === 0) {
    const [tables] = await pool.query(`SHOW TABLES`);
    throw new Error(
      `Table "${tableName}" not found. Available tables: ${tables
        .map((t) => Object.values(t)[0])
        .join(", ")}`
    );
  }


  // primary key column name
  const [pkRows] = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND CONSTRAINT_NAME = 'PRIMARY'
    LIMIT 1
    `,
    [tableName]
  );

  const pk = pkRows?.[0]?.COLUMN_NAME || null;

 // Determine required fields 
  const required = cols
  .filter((c) => c.IS_NULLABLE === "NO")
  .filter((c) => c.COLUMN_DEFAULT == null)
  .filter((c) => !String(c.EXTRA || "").includes("auto_increment"))
  .filter((c) => c.COLUMN_NAME !== pk);

 // List of all column names in the table
  const allColumns = cols.map((c) => c.COLUMN_NAME);
  // Store metadata in cache for future use
  const meta = { pk, required, allColumns };
  metaCache.set(tableName, meta);
  return meta;
}


 /**
   * Filter request body to only include valid table columns
  */
function pickInsertData(body, allColumns) {
  // Only take keys that are real columns
  const data = {};
  for (const key of Object.keys(body || {})) {
    if (allColumns.includes(key)) data[key] = body[key];
  }
  return data;
}

export function createCrudRouter({ routeName, tableName }) {
  const router = Router();

  // GET /api/<routeName>
  router.get("/", async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/<routeName>/:id
  router.get("/:id", async (req, res) => {
    try {
      const meta = await getTableMeta(tableName);
      if (!meta.pk) {
        return res.status(400).json({
          message: `Table "${tableName}" has no primary key. Can't GET by id.`,
        });
      }

      const [rows] = await pool.query(
        `SELECT * FROM \`${tableName}\` WHERE \`${meta.pk}\` = ? LIMIT 1`,
        [req.params.id]
      );

      if (!rows[0]) return res.status(404).json({ message: "Not found" });
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/<routeName>
  router.post("/", async (req, res) => {
    try {
      const meta = await getTableMeta(tableName);
      const data = pickInsertData(req.body, meta.allColumns);

      // enforce required fields
      const missing = meta.required.filter(
        (col) => data[col] === undefined || data[col] === null || data[col] === ""
      );

      if (missing.length > 0) {
        return res.status(400).json({
          message: `Missing required fields for table "${tableName}": ${missing.join(
            ", "
          )}`,
          required: meta.required,
        });
      }
       // Ensure at least one valid column was provided
      const cols = Object.keys(data);
      if (cols.length === 0) {
        return res.status(400).json({
          message: `No valid column fields provided for "${tableName}".`,
          columns: meta.allColumns,
        });
      }
       // Build dynamic INSERT query
      const placeholders = cols.map(() => "?").join(", ");
      const values = cols.map((c) => data[c]);
      const sql = `INSERT INTO \`${tableName}\` (${cols
        .map((c) => `\`${c}\``)
        .join(", ")}) VALUES (${placeholders})`;

      const [result] = await pool.execute(sql, values);

      res.status(201).json({
        message: "Created",
        insertId: result.insertId,
      });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/<routeName>/:id
  router.delete("/:id", async (req, res) => {
    try {
      const meta = await getTableMeta(tableName);
      if (!meta.pk) {
        return res.status(400).json({
          message: `Table "${tableName}" has no primary key. Can't DELETE by id.`,
        });
      }

      const [result] = await pool.execute(
        `DELETE FROM \`${tableName}\` WHERE \`${meta.pk}\` = ?`,
        [req.params.id]
      );

      if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });
      res.status(204).send();
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });

  return router;
}