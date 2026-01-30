const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

// Try to import MySQL pool, fall back to memory service if not available
let pool;
let useMemoryService = false;

try {
  const dbConfig = require("../config/database");
  pool = dbConfig.pool;

  // Test the connection immediately
  pool
    .getConnection()
    .then((connection) => {
      console.log("✅ MySQL database connection available and working");
      connection.release();
    })
    .catch((error) => {
      console.warn(
        "⚠️  MySQL connection test failed, using memory-based storage:",
        error.message
      );
      useMemoryService = true;
    });
} catch (error) {
  console.warn(
    "⚠️  MySQL not available, using memory-based storage:",
    error.message
  );
  useMemoryService = true;
}

// Import memory service as fallback
const memoryService = require("./documentService.memory");

class DocumentService {
  /**
   * Create a new document record in the database
   * @param {Object} documentData - Document metadata
   * @returns {Promise<Object>} Created document record
   */
  async createDocument(documentData) {
    if (useMemoryService) {
      return memoryService.createDocument(documentData);
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Calculate checksum for the document content
      const checksum = crypto
        .createHash("sha256")
        .update(documentData.content || "")
        .digest("hex");

      // Prepare document record
      const documentRecord = {
        document_id: documentData.document_id || `doc_${uuidv4()}`,
        title: documentData.title || null,
        source: documentData.source || null,
        author: documentData.author || null,
        file_path: documentData.file_path || null,
        file_size: documentData.file_size || null,
        mime_type: documentData.mime_type || null,
        checksum: checksum,
        version: documentData.version || 1,
        status: documentData.status || "pending",
        metadata: JSON.stringify(documentData.metadata || {}),
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Insert document record
      const insertDocQuery = `
        INSERT INTO documents (
          document_id, title, source, author, file_path, file_size, 
          mime_type, checksum, version, status, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const docResult = await connection.execute(insertDocQuery, [
        documentRecord.document_id,
        documentRecord.title,
        documentRecord.source,
        documentRecord.author,
        documentRecord.file_path,
        documentRecord.file_size,
        documentRecord.mime_type,
        documentRecord.checksum,
        documentRecord.version,
        documentRecord.status,
        documentRecord.metadata,
        documentRecord.created_at,
        documentRecord.updated_at,
      ]);

      // Create ingestion job record
      const jobId = `job_${uuidv4()}`;
      const insertJobQuery = `
        INSERT INTO ingestion_jobs (
          job_id, document_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `;

      await connection.execute(insertJobQuery, [
        jobId,
        documentRecord.document_id,
        "queued",
        new Date(),
        new Date(),
      ]);

      await connection.commit();

      return {
        document_id: documentRecord.document_id,
        job_id: jobId,
        message: "Document created successfully",
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Update document status with detailed tracking
   * @param {string} documentId - Document ID
   * @param {string} status - New status (PENDING, PROCESSING, INDEXED, FAILED)
   * @param {Object} details - Additional status details
   * @returns {Promise<Object>} Update result
   */
  async updateDocumentStatus(documentId, status, details = {}) {
    if (useMemoryService) {
      return memoryService.updateDocumentStatus(documentId, status, details);
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const updateQuery = `
        UPDATE documents 
        SET status = ?, updated_at = NOW(), metadata = JSON_SET(COALESCE(metadata, '{}'), '$.status_details', JSON_EXTRACT(?, '$'))
        WHERE document_id = ?
      `;

      await connection.execute(updateQuery, [
        status,
        JSON.stringify({
          status: status,
          timestamp: new Date().toISOString(),
          details: details,
        }),
        documentId,
      ]);

      // Update or create job record if processing
      if (
        status === "PROCESSING" ||
        status === "INDEXED" ||
        status === "FAILED"
      ) {
        const [jobResult] = await connection.execute(
          "SELECT * FROM ingestion_jobs WHERE document_id = ?",
          [documentId]
        );

        if (jobResult.length > 0) {
          await connection.execute(
            "UPDATE ingestion_jobs SET status = ?, updated_at = NOW() WHERE document_id = ?",
            [status, documentId]
          );
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return { message: `Status updated to ${status}` };
  }

  /**
   * Create document chunks in the database
   * @param {string} documentId - Parent document ID
   * @param {Array} chunks - Array of chunk objects
   * @returns {Promise<number>} Number of chunks created
   */
  async createDocumentChunks(documentId, chunks) {
    if (useMemoryService) {
      return memoryService.createDocumentChunks(documentId, chunks);
    }

    if (!chunks || chunks.length === 0) {
      return 0;
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      let totalCreated = 0;

      for (const chunk of chunks) {
        const chunkId = chunk.chunk_id || `chunk_${uuidv4()}`;
        const contentHash = crypto
          .createHash("sha256")
          .update(chunk.content)
          .digest("hex");

        const insertChunkQuery = `
          INSERT INTO document_chunks (
            chunk_id, document_id, chunk_order, content, 
            embedding_vector_id, token_count, hash_value, metadata, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        await connection.execute(insertChunkQuery, [
          chunkId,
          documentId,
          chunk.chunk_order || 0,
          chunk.content,
          chunk.embedding_vector_id || null,
          chunk.token_count || this._countTokens(chunk.content),
          contentHash,
          JSON.stringify(chunk.metadata || {}),
        ]);

        totalCreated++;
      }

      // Update the ingestion job
      const updateJobQuery = `
        UPDATE ingestion_jobs 
        SET status = 'completed', 
            total_chunks = ?, 
            processed_chunks = ?,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE document_id = ?
      `;

      await connection.execute(updateJobQuery, [
        totalCreated,
        totalCreated,
        documentId,
      ]);

      await connection.commit();
      return totalCreated;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get document by ID
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} Document record
   */
  async getDocumentById(documentId) {
    if (useMemoryService) {
      return memoryService.getDocumentById(documentId);
    }

    const query = "SELECT * FROM documents WHERE document_id = ?";
    const [rows] = await pool.execute(query, [documentId]);
    return rows[0] || null;
  }

  /**
   * Get document chunks by document ID
   * @param {string} documentId - Document ID
   * @param {number} limit - Maximum number of chunks to return
   * @returns {Promise<Array>} Array of document chunks
   */
  async getDocumentChunksByDocumentId(documentId, limit = 100) {
    if (useMemoryService) {
      return memoryService.getDocumentChunksByDocumentId(documentId, limit);
    }

    const query = `
      SELECT * FROM document_chunks 
      WHERE document_id = ? 
      ORDER BY chunk_order ASC 
      LIMIT ?
    `;
    const [rows] = await pool.execute(query, [documentId, limit]);
    return rows;
  }

  /**
   * Count tokens in text (simple estimation)
   * @param {string} text - Text to count tokens for
   * @returns {number} Estimated token count
   */
  _countTokens(text) {
    if (!text) return 0;
    // Simple approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Search documents by title or content
   * @param {string} searchTerm - Term to search for
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array>} Array of matching documents
   */
  async searchDocuments(searchTerm, limit = 20) {
    if (useMemoryService) {
      return memoryService.searchDocuments(searchTerm, limit);
    }

    const query = `
      SELECT d.*, COUNT(dc.id) as chunk_count
      FROM documents d
      LEFT JOIN document_chunks dc ON d.document_id = dc.document_id
      WHERE d.title LIKE ? OR d.source LIKE ?
      GROUP BY d.id
      ORDER BY d.created_at DESC
      LIMIT ?
    `;

    const searchTermPattern = `%${searchTerm}%`;
    const [rows] = await pool.execute(query, [
      searchTermPattern,
      searchTermPattern,
      limit,
    ]);
    return rows;
  }

  /**
   * Get all documents with pagination
   * @param {number} offset - Offset for pagination
   * @param {number} limit - Limit for pagination
   * @returns {Promise<Object>} Paginated results
   */
  async getAllDocuments(offset = 0, limit = 20) {
    if (useMemoryService) {
      return memoryService.getAllDocuments(offset, limit);
    }

    const countQuery = "SELECT COUNT(*) as total FROM documents";
    const [countRows] = await pool.execute(countQuery);
    const total = countRows[0].total;

    const query = `
      SELECT *, 
        (SELECT COUNT(*) FROM document_chunks WHERE document_id = d.document_id) as chunk_count
      FROM documents d
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.execute(query, [limit, offset]);

    return {
      documents: rows,
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    };
  }

  /**
   * Get document statistics including counts
   * @returns {Promise<Object>} Document statistics
   */
  async getDocumentStats() {
    if (useMemoryService) {
      return memoryService.getStats();
    }

    try {
      // Get document count
      const [docCountRows] = await pool.execute(
        "SELECT COUNT(*) as document_count FROM documents"
      );
      const documentCount = docCountRows[0].document_count;

      // Get chunk count
      const [chunkCountRows] = await pool.execute(
        "SELECT COUNT(*) as chunk_count FROM document_chunks"
      );
      const chunkCount = chunkCountRows[0].chunk_count;

      // Get status distribution
      const [statusRows] = await pool.execute(`
        SELECT status, COUNT(*) as count 
        FROM documents 
        GROUP BY status
      `);

      const statusDistribution = {};
      statusRows.forEach((row) => {
        statusDistribution[row.status] = row.count;
      });

      return {
        document_count: documentCount,
        chunk_count: chunkCount,
        status_distribution: statusDistribution,
      };
    } catch (error) {
      console.error("Error getting document stats:", error);
      return {
        document_count: 0,
        chunk_count: 0,
        status_distribution: {},
      };
    }
  }

  /**
   * Delete document and its chunks
   * @param {string} documentId - Document ID to delete
   * @returns {Promise<Object>} Deletion result
   */
  async deleteDocument(documentId) {
    if (useMemoryService) {
      return memoryService.deleteDocument(documentId);
    }

    const query = "DELETE FROM documents WHERE document_id = ?";
    const [result] = await pool.execute(query, [documentId]);
    return result;
  }
}

module.exports = new DocumentService();
