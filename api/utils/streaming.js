class StreamingUtils {
  /**
   * Send a streaming response to the client
   * @param {Object} res - Express response object
   * @param {AsyncIterable} dataStream - Stream of data chunks
   */
  async sendStreamingResponse(res, dataStream) {
    // Set streaming headers
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Cache-Control", "no-cache");

    try {
      for await (const chunk of dataStream) {
        // Write chunk to response
        res.write(JSON.stringify(chunk) + "\n");
        // Flush the response buffer
        res.flush();
      }
    } catch (error) {
      console.error("Streaming error:", error);
      res.write(
        JSON.stringify({ error: "Streaming failed", message: error.message }) +
          "\n"
      );
    } finally {
      res.end();
    }
  }

  /**
   * Create a readable stream for RAG responses
   * @param {Object} searchResults - Results from search
   * @param {string} query - Original query
   * @returns {AsyncGenerator} Async generator for streaming
   */
  async *createRagStream(searchResults, query) {
    // Send initial status
    yield {
      type: "status",
      message: "Processing query...",
      timestamp: new Date().toISOString(),
    };

    // Send intermediate results as they come in
    if (searchResults && searchResults.results) {
      yield {
        type: "retrieval_results",
        count: searchResults.results.length,
        timestamp: new Date().toISOString(),
      };

      // Stream individual results
      for (const [index, result] of searchResults.results.entries()) {
        yield {
          type: "retrieval_chunk",
          index: index,
          total: searchResults.results.length,
          chunk: result,
          timestamp: new Date().toISOString(),
        };

        // Small delay to simulate processing time
        await this.delay(100);
      }
    }

    // Send final response
    yield {
      type: "final_response",
      query: query,
      results: searchResults?.results || [],
      retrieved_count: searchResults?.results?.length || 0,
      generated_answer: searchResults?.generated_answer || "No results found",
      sources: searchResults?.sources || [],
      // Confidence score removed - using similarity score range instead
      similarity_score_range: searchResults?.similarity_score_range || "N/A",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a stream for document ingestion
   * @param {Object} ingestionResult - Ingestion result
   * @returns {AsyncGenerator} Async generator for streaming
   */
  async *createIngestionStream(ingestionResult) {
    yield {
      type: "status",
      message: "Starting document ingestion...",
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "progress",
      stage: "validation",
      message: "Validating document...",
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "progress",
      stage: "chunking",
      message: "Splitting document into chunks...",
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "progress",
      stage: "embedding",
      message: "Generating embeddings...",
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "progress",
      stage: "indexing",
      message: "Adding to vector index...",
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "progress",
      stage: "metadata",
      message: "Storing metadata...",
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "completion",
      message: "Document ingestion completed successfully",
      result: ingestionResult,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Delay helper function
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new StreamingUtils();
