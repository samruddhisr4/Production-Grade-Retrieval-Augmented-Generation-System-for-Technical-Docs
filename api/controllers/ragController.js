const winston = require("winston");
const retrievalService = require("../services/retrievalService");
const queryService = require("../services/queryService");
const documentService = require("../services/documentService");
const cacheService = require("../services/cacheService");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

class RAGController {
  constructor() {
    // Bind methods to ensure proper 'this' context
    this.searchDocuments = this.searchDocuments.bind(this);
    this.queryDocumentsWithLLM = this.queryDocumentsWithLLM.bind(this);
    this.ingestDocument = this.ingestDocument.bind(this);
    this.uploadFile = this.uploadFile.bind(this);
    this.healthCheck = this.healthCheck.bind(this);
  }

  /**
   * Search for relevant documents based on user query
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchDocuments(req, res) {
    try {
      const { query, user_id, top_k = 5 } = req.body;

      // Validate input
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({
          error: "Query is required and must be a non-empty string",
        });
      }

      logger.info(`Received search query: ${query.substring(0, 50)}...`);

      // Check cache first
      const cacheKey = `search:${query}:${top_k}`;
      const cachedResult = await cacheService.getCachedResult(cacheKey);

      if (cachedResult) {
        logger.info("Returning cached search results");
        // Record the cache hit
        await this._recordQueryAsync({
          query,
          user_id,
          response_time: 0,
          cache_hit: true,
          results_count: cachedResult.results.length,
        });

        return res.json(cachedResult);
      }

      // Start timing
      const startTime = Date.now();

      // Call retrieval service
      const rawResults = await retrievalService.searchDocuments(
        query,
        user_id,
        top_k
      );

      // Process and format results
      const formattedResults = rawResults.results.map((result) => ({
        id: result.chunk_id,
        content: result.content,
        score: result.similarity_score,
        source: result.metadata,
        source_file:
          result.metadata?.source_file || result.metadata?.document_name,
      }));

      // Validate retrieval quality
      const validation = this._validateRetrievalQuality(
        rawResults.results,
        formattedResults
      );

      const response = {
        query: rawResults.query,
        results: formattedResults,
        total_results: formattedResults.length,
        retrieval_gated: !validation.isValid,
        gating_reason: validation.isValid ? null : validation.reason,
        // Similarity score range replaces confidence metric
        similarity_score_range:
          this._calculateSimilarityRange(formattedResults),
        query_embedding: rawResults.query_embedding,
        retrieval_quality: validation,
        processing_time: Date.now() - startTime,
      };

      // Cache the result if it meets quality criteria
      if (validation.isValid) {
        const ttl = this._getCacheTTL(query);
        await cacheService.cacheResult(cacheKey, response, ttl);
      }

      // Record query statistics asynchronously
      await this._recordQueryAsync({
        query,
        user_id,
        response_time: Date.now() - startTime,
        cache_hit: false,
        results_count: formattedResults.length,
        max_similarity_score: Math.max(...formattedResults.map((r) => r.score)),
        retrieval_quality: validation,
      });

      res.json(response);
    } catch (error) {
      logger.error(`Search documents failed: ${error.message}`);
      res.status(500).json({
        error: "Search failed",
        message: error.message,
      });
    }
  }

  /**
   * Query documents with LLM-generated answer
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async queryDocumentsWithLLM(req, res) {
    try {
      const { query, user_id, top_k = 5 } = req.body;

      // Validate input
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({
          error: "Query is required and must be a non-empty string",
        });
      }

      logger.info(`Received LLM query: ${query.substring(0, 50)}...`);

      // Check cache first
      const cacheKey = `llm:${query}:${top_k}`;
      const cachedResult = await cacheService.getCachedResult(cacheKey);

      if (cachedResult) {
        logger.info("Returning cached LLM query results");
        // Record the cache hit
        await this._recordQueryAsync({
          query,
          user_id,
          response_time: 0,
          cache_hit: true,
          results_count: cachedResult.sources.length,
          is_llm: true,
        });

        return res.json(cachedResult);
      }

      // Start timing
      const startTime = Date.now();

      // Call retrieval service for LLM query
      const rawResults = await retrievalService.queryDocumentsWithLLM(
        query,
        user_id,
        top_k
      );

      // Process and format results
      const formattedResults = rawResults.sources.map((result) => ({
        id: result.chunk_id,
        content: result.content,
        score: result.similarity_score,
        source: result.metadata,
        source_file:
          result.metadata?.source_file || result.metadata?.document_name,
      }));

      // Validate retrieval quality
      const validation = this._validateRetrievalQuality(
        rawResults.sources,
        formattedResults
      );

      const response = {
        query: rawResults.query,
        answer: validation.isValid
          ? rawResults.answer
          : "Unable to generate answer due to low-quality retrieval results. The retrieved documents do not meet the minimum quality thresholds.",
        sources: validation.isValid ? formattedResults : [],
        total_sources: validation.isValid ? formattedResults.length : 0,
        retrieval_gated: !validation.isValid,
        gating_reason: validation.isValid ? null : validation.reason,
        // Similarity score range replaces confidence metric
        similarity_score_range: validation.isValid
          ? this._calculateSimilarityRange(formattedResults)
          : "N/A",
        query_embedding: rawResults.query_embedding,
        retrieval_quality: validation,
        processing_time: Date.now() - startTime,
      };

      // Cache the result if it meets quality criteria
      if (validation.isValid) {
        const ttl = this._getCacheTTL(query);
        await cacheService.cacheResult(cacheKey, response, ttl);
      }

      // Record query statistics asynchronously
      await this._recordQueryAsync({
        query,
        user_id,
        response_time: Date.now() - startTime,
        cache_hit: false,
        results_count: validation.isValid ? formattedResults.length : 0,
        max_similarity_score: validation.isValid
          ? Math.max(...formattedResults.map((r) => r.score))
          : 0,
        is_llm: true,
        retrieval_quality: validation,
      });

      res.json(response);
    } catch (error) {
      logger.error(`LLM query failed: ${error.message}`);
      res.status(500).json({
        error: "LLM query failed",
        message: error.message,
      });
    }
  }

  /**
   * Ingest a document into the system
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async ingestDocument(req, res) {
    try {
      const { content, metadata } = req.body;

      // Validate input
      if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        return res.status(400).json({
          error: "Content is required and must be a non-empty string",
        });
      }

      if (!metadata || typeof metadata !== "object") {
        return res.status(400).json({
          error: "Metadata is required and must be an object",
        });
      }

      // Ensure title is provided
      if (!metadata.title) {
        return res.status(400).json({
          error: "Title is required in metadata",
        });
      }

      logger.info(`Ingesting document: ${metadata.title}`);

      // Call retrieval service to ingest document
      const result = await retrievalService.ingestDocument(content, metadata);

      // Create document record in database
      const docRecord = await documentService.createDocument({
        title: metadata.title,
        author: metadata.author || "",
        source: metadata.source || "",
        source_file: metadata.source_file || "manual_ingestion",
        file_size: content.length,
        file_type: metadata.file_type || "text",
        status: "completed",
      });

      // Update document status to completed
      await documentService.updateDocumentStatus(
        docRecord.document_id,
        "completed"
      );

      // Invalidate any related caches
      await cacheService.invalidateDocumentCache(docRecord.document_id);

      const response = {
        message: "Document successfully ingested",
        document_id: result.document_id,
        chunks_processed: result.chunks_processed,
        status: result.status,
        document_record_id: docRecord.document_id,
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error(`Document ingestion failed: ${error.message}`);
      res.status(500).json({
        error: "Document ingestion failed",
        message: error.message,
      });
    }
  }

  /**
   * Handle file upload and ingestion requests
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadFile(req, res) {
    try {
      // Check if file exists in the request
      if (!req.file) {
        return res.status(400).json({
          error: "File is required",
        });
      }

      // Extract title, author, and source from the request body
      const { title, author = "", source = "" } = req.body;

      if (!title) {
        return res.status(400).json({
          error: "Title is required",
        });
      }

      logger.info(
        `Uploading file: ${req.file.originalname} with title: ${title}`
      );

      // Call the Python retrieval service for file upload
      const uploadResult = await retrievalService.uploadFile(
        req.file.buffer,
        req.file.originalname,
        title,
        author,
        source
      );

      // Create document record in database
      const docRecord = await documentService.createDocument({
        title,
        author,
        source,
        source_file: req.file.originalname,
        file_size: req.file.buffer.length,
        file_type: req.file.mimetype,
        status: "completed",
      });

      // Update document status to completed
      await documentService.updateDocumentStatus(
        docRecord.document_id,
        "completed"
      );

      // Invalidate any related caches
      await cacheService.invalidateDocumentCache(docRecord.document_id);

      const finalResponse = {
        message: "File successfully uploaded and ingested",
        document_id: uploadResult.document_id,
        chunks_processed: uploadResult.chunks_processed,
        status: uploadResult.status,
        original_filename: req.file.originalname,
        file_size: req.file.buffer.length,
      };

      res.status(201).json(finalResponse);
    } catch (error) {
      logger.error(`Error uploading file: ${error.message}`);

      // Try to update document status to failed if possible
      if (req.body.title) {
        // Create a temporary document ID to update status if needed
        const tempDocId = `temp_${Date.now()}`;
        try {
          await documentService.updateDocumentStatus(tempDocId, "failed");
        } catch (statusErr) {
          logger.error(
            `Failed to update document status: ${statusErr.message}`
          );
        }
      }

      if (error.message.includes("unavailable")) {
        return res.status(503).json({
          error: "Upload service temporarily unavailable",
          message: "Please try again in a few moments",
        });
      }

      res.status(500).json({
        error: "Failed to upload file",
        message: error.message,
      });
    }
  }

  /**
   * Simple health check endpoint
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async healthCheck(req, res) {
    try {
      // Check retrieval service health
      const retrievalHealthy = await retrievalService.healthCheck();
      
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          api_gateway: "healthy",
          retrieval_service: retrievalHealthy ? "healthy" : "unhealthy",
          cache: "memory"
        },
        system_stats: {
          total_queries: 0,
          avg_response_time: 0,
          similarity_score_ranges: null,
          total_feedbacks: 0,
          indexed_documents: 0,
          indexed_chunks: 0,
          faiss_vectors: 0,
          document_status: {
            processing: 0,
            completed: 0
          }
        },
        cache_info: {
          enabled: true,
          provider: "memory",
          size: 0
        }
      });
    } catch (error) {
      logger.error(`Health check failed: ${error.message}`);
      res.status(500).json({
        status: "unhealthy",
        error: error.message
      });
    }
  }

  /**
   * Health check endpoint with caching and additional diagnostics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async healthCheckDetailed(req, res) {
    try {
      // Check if we have cached health status
      const cachedHealth = await cacheService.getCachedHealthStatus(
        "retrieval_service"
      );
      let retrievalHealthy = false;

      if (cachedHealth) {
        retrievalHealthy = cachedHealth.status;
        logger.info("Using cached health status for retrieval service");
      } else {
        retrievalHealthy = await retrievalService.healthCheck();
        // Cache the health status for 30 seconds
        await cacheService.cacheHealthStatus(
          "retrieval_service",
          retrievalHealthy,
          30
        );
      }

      // Get basic system stats
      const queryStats = await queryService.getQueryStats().catch(() => null);
      const documentStats = await documentService
        .getDocumentStats()
        .catch(() => null);

      // Get FAISS index count from retrieval service if healthy
      let faissVectorCount = 0;
      if (retrievalHealthy) {
        try {
          const retrievalHealth = await retrievalService.getHealthInfo();
          faissVectorCount = retrievalHealth.indexed_documents || 0;
        } catch (error) {
          logger.warn("Could not get FAISS vector count:", error.message);
        }
      }

      const healthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          api_gateway: "healthy",
          retrieval_service: retrievalHealthy ? "healthy" : "unhealthy",
          cache: "memory", // Using in-memory cache instead of Redis
        },
        system_stats: {
          total_queries: queryStats?.total_queries || 0,
          avg_response_time: queryStats?.avg_response_time
            ? Math.round(queryStats.avg_response_time)
            : null,
          // Confidence metric removed - using similarity score ranges instead
          similarity_score_ranges: queryStats?.similarity_score_ranges || null,
          total_feedbacks: queryStats?.total_feedbacks || 0,
          // Document-level statistics
          indexed_documents: documentStats?.document_count || 0,
          indexed_chunks: documentStats?.chunk_count || 0,
          // Vector-level statistics from FAISS
          faiss_vectors: faissVectorCount,
          document_status: documentStats?.status_distribution || {},
        },
        cache_info: await cacheService.getCacheStats(),
      };

      const statusCode = retrievalHealthy ? 200 : 503;
      res.status(statusCode).json(healthStatus);
    } catch (error) {
      logger.error(`Health check failed: ${error.message}`);
      res.status(500).json({
        status: "unhealthy",
        error: error.message,
      });
    }
  }

  /**
   * Record query asynchronously (non-blocking)
   * @param {Object} queryData - Query data to record
   * @private
   */
  async _recordQueryAsync(queryData) {
    try {
      await queryService.recordQuery(queryData);
    } catch (error) {
      logger.error(`Failed to record query: ${error.message}`);
    }
  }

  /**
   * Calculate similarity score range from results
   * @param {Array} results - Search results
   * @returns {string} Formatted range
   * @private
   */
  _calculateSimilarityRange(results) {
    if (!results || results.length === 0) {
      return "N/A";
    }

    const scores = results.map((result) => result.score || 0);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    return `${minScore.toFixed(3)} – ${maxScore.toFixed(3)}`;
  }

  /**
   * Validate retrieval quality against minimum thresholds
   * @param {Array} rawResults - Raw search results
   * @param {Array} formattedResults - Formatted search results
   * @returns {Object} Validation result with isValid flag and details
   * @private
   */
  _validateRetrievalQuality(rawResults, formattedResults) {
    // Configuration constants for retrieval gating
    const MIN_SIMILARITY_THRESHOLD = 0.1; // Lowered threshold to allow more results through (0-1)
    const MIN_UNIQUE_DOCUMENTS = 1; // Minimum number of unique documents

    // Check if we have any results at all
    if (!rawResults || rawResults.length === 0) {
      return {
        isValid: false,
        reason: "No relevant documents found",
        details: "Retrieved 0 results from vector store",
      };
    }

    // Check minimum similarity threshold
    const scores = formattedResults.map((result) => result.score);
    const maxScore = Math.max(...scores);
    if (maxScore < MIN_SIMILARITY_THRESHOLD) {
      return {
        isValid: false,
        reason: `Maximum similarity score (${maxScore.toFixed(
          3
        )}) below minimum threshold (${MIN_SIMILARITY_THRESHOLD})`,
        details: `Best match score: ${maxScore.toFixed(
          3
        )}, threshold: ${MIN_SIMILARITY_THRESHOLD}`,
      };
    }

    // Check minimum number of unique documents
    const uniqueDocuments = new Set(
      formattedResults.map(
        (result) => result.source?.source_file || result.source?.document_id
      )
    );
    if (uniqueDocuments.size < MIN_UNIQUE_DOCUMENTS) {
      return {
        isValid: false,
        reason: `Number of unique documents (${uniqueDocuments.size}) below minimum requirement (${MIN_UNIQUE_DOCUMENTS})`,
        details: `Found ${uniqueDocuments.size} unique documents, required at least ${MIN_UNIQUE_DOCUMENTS}`,
      };
    }

    // All validations passed
    return {
      isValid: true,
      reason: "All quality checks passed",
      details: `Max similarity: ${maxScore.toFixed(3)}, Unique docs: ${
        uniqueDocuments.size
      }`,
    };
  }

  /**
   * Get cache TTL based on query characteristics
   * @param {string} query - User query
   * @returns {number} Cache TTL in seconds
   * @private
   */
  _getCacheTTL(query) {
    // Shorter TTL for complex queries, longer for simple ones
    const wordCount = query.split(/\s+/).length;
    if (wordCount > 10) return 300; // 5 minutes for complex queries
    return 600; // 10 minutes for simpler queries
  }
}

module.exports = new RAGController();
