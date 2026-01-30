const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

// In-memory storage as fallback for when MySQL is not available
class MemoryDocumentService {
  constructor() {
    this.documents = new Map(); // document_id -> document_data
    this.chunks = new Map(); // chunk_id -> chunk_data
    this.jobs = new Map(); // job_id -> job_data
  }

  /**
   * Create a new document record in memory
   */
  async createDocument(documentData) {
    try {
      // Calculate checksum for the document content
      const checksum = crypto
        .createHash("sha256")
        .update(documentData.content || "")
        .digest("hex");

      // Prepare document record
      const documentRecord = {
        id: this.documents.size + 1,
        document_id: documentData.document_id || `doc_${uuidv4()}`,
        title: documentData.title,
        source: documentData.source,
        author: documentData.author,
        file_path: documentData.file_path,
        file_size: documentData.file_size,
        mime_type: documentData.mime_type,
        checksum: checksum,
        version: documentData.version || 1,
        status: documentData.status || "pending",
        metadata: documentData.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Store document
      this.documents.set(documentRecord.document_id, documentRecord);

      // Create ingestion job record
      const jobId = `job_${uuidv4()}`;
      const jobRecord = {
        id: this.jobs.size + 1,
        job_id: jobId,
        document_id: documentRecord.document_id,
        status: "queued",
        total_chunks: 0,
        processed_chunks: 0,
        error_message: null,
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      this.jobs.set(jobId, jobRecord);

      console.log(`✅ Created document: ${documentRecord.document_id}`);

      return {
        document_id: documentRecord.document_id,
        job_id: jobId,
        message: "Document created successfully in memory",
      };
    } catch (error) {
      console.error("❌ Error creating document:", error);
      throw error;
    }
  }

  /**
   * Update document status
   */
  async updateDocumentStatus(documentId, status) {
    const document = this.documents.get(documentId);
    if (document) {
      document.status = status;
      document.updated_at = new Date().toISOString();
      this.documents.set(documentId, document);

      // Also update related job
      for (const [jobId, job] of this.jobs.entries()) {
        if (job.document_id === documentId) {
          job.status = status;
          job.updated_at = new Date().toISOString();
          if (status === "processing") {
            job.started_at = new Date().toISOString();
          } else if (status === "completed") {
            job.completed_at = new Date().toISOString();
          }
          this.jobs.set(jobId, job);
          break;
        }
      }

      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  /**
   * Create document chunks in memory
   */
  async createDocumentChunks(documentId, chunks) {
    if (!chunks || chunks.length === 0) {
      return 0;
    }

    let totalCreated = 0;

    for (const chunk of chunks) {
      const chunkId = chunk.chunk_id || `chunk_${uuidv4()}`;
      const contentHash = crypto
        .createHash("sha256")
        .update(chunk.content)
        .digest("hex");

      const chunkRecord = {
        id: this.chunks.size + 1,
        chunk_id: chunkId,
        document_id: documentId,
        chunk_order: chunk.chunk_order || 0,
        content: chunk.content,
        embedding_vector_id: chunk.embedding_vector_id || null,
        token_count: chunk.token_count || this._countTokens(chunk.content),
        hash_value: contentHash,
        metadata: chunk.metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      this.chunks.set(chunkId, chunkRecord);
      totalCreated++;
    }

    // Update the ingestion job
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.document_id === documentId) {
        job.status = "completed";
        job.total_chunks = totalCreated;
        job.processed_chunks = totalCreated;
        job.completed_at = new Date().toISOString();
        job.updated_at = new Date().toISOString();
        this.jobs.set(jobId, job);
        break;
      }
    }

    console.log(`✅ Created ${totalCreated} chunks for document ${documentId}`);
    return totalCreated;
  }

  /**
   * Get document by ID
   */
  async getDocumentById(documentId) {
    return this.documents.get(documentId) || null;
  }

  /**
   * Get document chunks by document ID
   */
  async getDocumentChunksByDocumentId(documentId, limit = 100) {
    const chunks = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.document_id === documentId) {
        chunks.push(chunk);
      }
    }
    return chunks.slice(0, limit).sort((a, b) => a.chunk_order - b.chunk_order);
  }

  /**
   * Count tokens in text (simple estimation)
   */
  _countTokens(text) {
    if (!text) return 0;
    // Simple approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Get all documents
   */
  async getAllDocuments(offset = 0, limit = 20) {
    const allDocs = Array.from(this.documents.values());
    const total = allDocs.length;
    const documents = allDocs.slice(offset, offset + limit);

    return {
      documents: documents,
      total,
      offset,
      limit,
      hasMore: offset + documents.length < total,
    };
  }

  /**
   * Delete document and its chunks
   */
  async deleteDocument(documentId) {
    // Delete chunks first
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.document_id === documentId) {
        this.chunks.delete(chunkId);
      }
    }

    // Delete jobs
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.document_id === documentId) {
        this.jobs.delete(jobId);
      }
    }

    // Delete document
    const existed = this.documents.delete(documentId);

    return { affectedRows: existed ? 1 : 0 };
  }

  /**
   * Get statistics
   */
  async getStats() {
    return {
      document_count: this.documents.size,
      chunk_count: this.chunks.size,
      job_count: this.jobs.size,
      pending_jobs: Array.from(this.jobs.values()).filter(
        (j) => j.status === "queued"
      ).length,
      completed_jobs: Array.from(this.jobs.values()).filter(
        (j) => j.status === "completed"
      ).length,
    };
  }
}

module.exports = new MemoryDocumentService();
