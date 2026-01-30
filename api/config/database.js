const mysql = require("mysql2/promise");

// Database configuration
const dbConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT) || 3307, // Updated to 3307
  user: process.env.MYSQL_USER || "rag_user",
  password: process.env.MYSQL_PASSWORD || "Ramo@1602", // Updated password
  database: process.env.MYSQL_DATABASE || "rag_system",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+00:00",
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log("✅ MySQL database connected successfully");
    connection.release();
    return true;
  } catch (error) {
    console.error("❌ MySQL database connection failed:", error.message);
    return false;
  }
};

module.exports = {
  pool,
  testConnection,
};
