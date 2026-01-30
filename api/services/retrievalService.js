const axios = require("axios");
const FormData = require("form-data"); // Add form data support for file uploads
const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

class RetrievalService {
  constructor() {
    this.baseUrl = process.env.RETRIEVAL_SERVICE_URL || "http://localhost:8000";
    this.timeout = 15000; // 15 seconds timeout
  }

  /**
   * Search for relevant documents using the Python retrieval service
   * @param {string} query - User's search query
   * @param {string} userId - Optional user identifier
   * @param {number} topK - Number of results to return (default: 5)
   * @returns {Promise<Object>} Search results with relevant document chunks
   */
  async searchDocuments(query, userId = null, topK = 5) {
    try {
      logger.info(
        `Searching documents for query: ${query.substring(0, 50)}...`
      );

      const response = await axios.post(
        `${this.baseUrl}/api/v1/search`,
        {
          query,
          user_id: userId,
          top_k: topK,
        },
        {
          timeout: this.timeout,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(
        `Search completed. Found ${response.data.results.length} results`
      );
      return response.data;
    } catch (error) {
      logger.error(`Search failed: ${error.message}`);

      if (error.code === "ECONNREFUSED") {
        throw new Error("Retrieval service is unavailable");
      }

      if (error.response) {
        throw new Error(
          `Retrieval service error: ${error.response.status} - ${
            error.response.data.detail || "Unknown error"
          }`
        );
      }

      throw new Error(`Search request failed: ${error.message}`);
    }
  }

  /**
   * Query documents with LLM-generated answer
   * @param {string} query - User's query
   * @param {string} userId - Optional user identifier
   * @param {number} topK - Number of results to return (default: 5)
   * @returns {Promise<Object>} Query results with LLM-generated answer
   */
  async queryDocumentsWithLLM(query, userId = null, topK = 5) {
    try {
      logger.info(
        `Querying documents with LLM for query: ${query.substring(0, 50)}...`
      );

      const response = await axios.post(
        `${this.baseUrl}/api/v1/query`,
        {
          query,
          user_id: userId,
          top_k: topK,
        },
        {
          timeout: this.timeout,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(
        `LLM query completed. Answer generated with ${response.data.sources.length} sources`
      );
      return response.data;
    } catch (error) {
      logger.error(`LLM query failed: ${error.message}`);

      if (error.code === "ECONNREFUSED") {
        throw new Error("Retrieval service is unavailable");
      }

      if (error.response) {
        throw new Error(
          `LLM query service error: ${error.response.status} - ${
            error.response.data.detail || "Unknown error"
          }`
        );
      }

      throw new Error(`LLM query request failed: ${error.message}`);
    }
  }

  /**
   * Ingest a document into the retrieval system
   * @param {string} content - Document content to ingest
   * @param {Object} metadata - Document metadata
   * @returns {Promise<Object>} Ingestion result
   */
  async ingestDocument(content, metadata) {
    try {
      logger.info(`Ingesting document: ${metadata.title || "Untitled"}`);

      const response = await axios.post(
        `${this.baseUrl}/api/v1/ingest`,
        {
          content,
          metadata,
        },
        {
          timeout: 30000, // 30 seconds for ingestion
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      logger.info(
        `Document ingestion successful: ${response.data.document_id}`
      );
      return response.data;
    } catch (error) {
      logger.error(`Document ingestion failed: ${error.message}`);

      if (error.code === "ECONNREFUSED") {
        throw new Error("Retrieval service is unavailable");
      }

      if (error.response) {
        throw new Error(
          `Ingestion service error: ${error.response.status} - ${
            error.response.data.detail || "Unknown error"
          }`
        );
      }

      throw new Error(`Ingestion request failed: ${error.message}`);
    }
  }

  /**
   * Upload and ingest a file into the retrieval system
   * @param {Buffer} fileContent - File content as buffer
   * @param {string} fileName - Original file name
   * @param {string} title - Document title
   * @param {string} author - Document author (optional)
   * @param {string} source - Document source (optional)
   * @returns {Promise<Object>} Ingestion result
   */
  async uploadFile(fileContent, fileName, title, author = "", source = "") {
    try {
      logger.info(`Uploading file: ${fileName} with title: ${title}`);

      // Create form data for file upload
      const formData = new FormData();
      formData.append("file", fileContent, { filename: fileName });
      formData.append("title", title);
      if (author) formData.append("author", author);
      if (source) formData.append("source", source);

      const response = await axios.post(
        `${this.baseUrl}/api/v1/upload-file`,
        formData,
        {
          timeout: 60000, // 60 seconds for file upload
          headers: {
            ...formData.getHeaders(), // This sets the correct Content-Type with boundary
          },
        }
      );

      logger.info(`File upload successful: ${response.data.document_id}`);
      return response.data;
    } catch (error) {
      logger.error(`File upload failed: ${error.message}`);

      if (error.code === "ECONNREFUSED") {
        throw new Error("Retrieval service is unavailable");
      }

      if (error.response) {
        throw new Error(
          `File upload service error: ${error.response.status} - ${
            error.response.data.detail || "Unknown error"
          }`
        );
      }

      throw new Error(`File upload request failed: ${error.message}`);
    }
  }

  /**
   * Check if the retrieval service is healthy
   * @returns {Promise<boolean>} Service health status
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch (error) {
      logger.warn(`Retrieval service health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get detailed health information from retrieval service
   * @returns {Promise<Object>} Health information including vector count
   */
  async getHealthInfo() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      logger.warn(
        `Failed to get retrieval service health info: ${error.message}`
      );
      return { indexed_documents: 0 };
    }
  }
}

module.exports = new RetrievalService();
