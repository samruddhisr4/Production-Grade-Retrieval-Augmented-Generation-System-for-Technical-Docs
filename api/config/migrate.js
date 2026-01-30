const fs = require("fs");
const path = require("path");
const { pool } = require("./database");

async function runMigration() {
  console.log("Starting database migration...");

  try {
    // Read the schema SQL file
    const schemaPath = path.join(__dirname, "db_schema.sql");
    const schemaSQL = fs.readFileSync(schemaPath, "utf8");

    // Execute the schema
    console.log("Creating database tables...");
    await pool.execute(schemaSQL);

    console.log("✅ Database migration completed successfully!");

    // Close the connection pool
    await pool.end();
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
