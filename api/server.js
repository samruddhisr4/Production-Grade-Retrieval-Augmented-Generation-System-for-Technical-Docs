const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const winston = require("winston");
const path = require("path");

// Import our services
const ragController = require("./controllers/ragController");
const documentService = require("./services/documentService");

// Import middleware
const {
  validateQuery,
  validateDocumentIngestion,
} = require("./middleware/validation");

// Import database utilities
const { testConnection } = require("./config/database");
const dbInitializer = require("./utils/dbInitializer");

require("dotenv").config();

// Initialize logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
  ],
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests",
    message: "Rate limit exceeded. Please try again later.",
  },
});

// More permissive rate limit for document ingestion
const documentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 document uploads per hour
  message: {
    error: "Too many document upload requests",
    message: "Document upload limit exceeded. Please try again later.",
  },
});

app.use(cors());
app.use((req, res, next) => {
  // Apply general rate limit to all routes except document ingestion
  if (req.path === "/api/v1/documents" && req.method === "POST") {
    return next(); // Skip general rate limit for document uploads
  }
  return generalRateLimit(req, res, next);
});
app.use("/api/v1/documents", documentRateLimit);

// Parse JSON bodies
app.use(express.json({ limit: "10mb" }));

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, "frontend-react", "build")));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// API Routes
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the RAG API",
    version: "1.0.0",
    endpoints: {
      "GET /health": "Health check endpoint",
      "POST /api/v1/query": "Search documents with query",
      "POST /api/v1/query-llm": "Query documents with LLM-generated answer",
      "POST /api/v1/documents": "Ingest documents",
    },
  });
});

app.get("/health", ragController.healthCheck);

// Document search endpoint with validation
app.post("/api/v1/query", validateQuery, ragController.searchDocuments);

// Document query with LLM-generated answer
app.post(
  "/api/v1/query-llm",
  validateQuery,
  ragController.queryDocumentsWithLLM
);

// Document ingestion status update endpoint
app.post("/api/v1/documents/status", async (req, res) => {
  try {
    const { document_id, status, details } = req.body;

    if (!document_id || !status) {
      return res
        .status(400)
        .json({ error: "document_id and status are required" });
    }

    // Validate status values
    const validStatuses = ["PENDING", "PROCESSING", "INDEXED", "FAILED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    await documentService.updateDocumentStatus(
      document_id,
      status,
      details || {}
    );

    res.status(200).json({
      message: `Document ${document_id} status updated to ${status}`,
      document_id,
      status,
      details: details || {},
    });
  } catch (error) {
    console.error("Error updating document status:", error);
    res.status(500).json({ error: "Failed to update document status" });
  }
});

// Document ingestion endpoint with validation
app.post(
  "/api/v1/documents",
  validateDocumentIngestion,
  ragController.ingestDocument
);

// File upload endpoint
const upload = require("multer")(); // Simple multer setup for file uploads
app.post(
  "/api/v1/upload-file",
  upload.single("file"), // Expect a single file upload with field name 'file'
  ragController.uploadFile
);

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend-react", "build", "index.html"));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.stack}`);

  // Joi validation errors
  if (err.isJoi) {
    return res.status(400).json({
      error: "Validation error",
      details: err.details,
    });
  }

  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Start server
const startServer = async () => {
  try {
    // Initialize database
    logger.info("Initializing database...");
    await dbInitializer.initialize();

    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.warn("Database connection failed, but starting API anyway...");
    }

    app.listen(PORT, () => {
      logger.info(`🚀 RAG API server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info("Available endpoints:");
      logger.info("  GET  /health");
      logger.info("  POST /api/v1/query");
      logger.info("  POST /api/v1/query-llm");
      logger.info("  POST /api/v1/documents");
      logger.info("Frontend served at http://localhost:3000");
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();

module.exports = app;