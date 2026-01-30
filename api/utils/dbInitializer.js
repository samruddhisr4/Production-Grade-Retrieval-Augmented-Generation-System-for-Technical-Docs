const { pool, testConnection } = require("../config/database");
const fs = require("fs");
const path = require("path");

// Note: Redis has been removed from the system, skipping Redis initialization

class DBInitializer {
  /**
   * Initialize the database and Redis by running migrations
   */
  async initialize() {
    console.log("Initializing database...");

    try {
      // Redis has been removed from the system
      console.log("Skipping Redis initialization (Redis removed from system)");

      // Test database connection
      const isConnected = await testConnection();
      if (!isConnected) {
        throw new Error("Cannot connect to database");
      }

      // Check if tables exist by querying information schema
      const [existingTables] = await pool.execute(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        AND table_name IN ('documents', 'document_chunks', 'queries', 'ingestion_jobs')
      `);

      if (existingTables.length === 0) {
        console.log("No existing tables found. Creating schema...");
        await this.runSchemaMigration();
      } else {
        console.log(
          `Found ${existingTables.length} existing tables. Database already initialized.`
        );
      }

      console.log("✅ Database initialization completed!");
    } catch (error) {
      console.error("❌ Initialization failed:", error.message);
      throw error;
    }
  }

  /**
   * Run the schema migration
   */
  async runSchemaMigration() {
    try {
      // Read the schema SQL file
      const schemaPath = path.join(__dirname, "../config/db_schema.sql");
      const schemaSQL = fs.readFileSync(schemaPath, "utf8");

      // Execute the schema
      console.log("Creating database tables...");
      await pool.execute(schemaSQL);

      console.log("✅ Schema migration completed successfully!");
    } catch (error) {
      console.error("❌ Schema migration failed:", error.message);
      throw error;
    }
  }

  /**
   * Check if database is initialized
   */
  async isInitialized() {
    try {
      const [tables] = await pool.execute(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
        AND table_name = 'documents'
      `);

      return tables.length > 0;
    } catch (error) {
      console.error("Error checking database initialization:", error.message);
      return false;
    }
  }
}

module.exports = new DBInitializer();
