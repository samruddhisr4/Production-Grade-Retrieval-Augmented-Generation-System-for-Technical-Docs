const crypto = require("crypto");
const winston = require("winston");

// In-memory cache implementation instead of Redis
const memoryCache = new Map();
const cacheTimeouts = new Map(); // Track timeouts for cache expiration

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

class CacheService {
  /**
   * Generate a hash for caching purposes
   * @param {string} input - Input string to hash
   * @returns {string} SHA-256 hash
   */
  generateHash(input) {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  // Helper function to clear expired cache entries
  _clearExpired(key) {
    const timeoutId = cacheTimeouts.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      cacheTimeouts.delete(key);
    }
  }

  // Helper function to set cache with expiration
  _setCacheWithExpiration(key, value, ttl) {
    this._clearExpired(key);
    memoryCache.set(key, value);

    // Set timeout to remove the key after TTL
    const timeoutId = setTimeout(() => {
      memoryCache.delete(key);
      cacheTimeouts.delete(key);
    }, ttl * 1000);

    cacheTimeouts.set(key, timeoutId);
  }

  // Get value from cache
  _getCache(key) {
    return memoryCache.get(key) || null;
  }

  // Delete value from cache
  _deleteCache(key) {
    this._clearExpired(key);
    return memoryCache.delete(key);
  }

  /**
   * Cache query results
   * @param {string} query - Original query
   * @param {Object} results - Query results to cache
   * @param {Object} options - Caching options
   * @returns {Promise<boolean>} Success status
   */
  async cacheQueryResults(query, results, options = {}) {
    try {
      const queryHash = this.generateHash(query.toLowerCase().trim());
      const ttl = options.ttl || 600;

      // Store in memory cache
      this._setCacheWithExpiration(`query:${queryHash}`, results, ttl);

      logger.info(`Query results cached for: ${query.substring(0, 50)}...`);
      return true;
    } catch (error) {
      logger.error(`Error caching query results: ${error.message}`);
      return false;
    }
  }

  /**
   * Get cached query results
   * @param {string} query - Original query
   * @returns {Promise<Object|null>} Cached results or null
   */
  async getCachedQueryResults(query) {
    try {
      const queryHash = this.generateHash(query.toLowerCase().trim());
      const cachedResults = this._getCache(`query:${queryHash}`);

      if (cachedResults) {
        logger.info(`Cache hit for query: ${query.substring(0, 50)}...`);
        return cachedResults;
      }

      logger.info(`Cache miss for query: ${query.substring(0, 50)}...`);
      return null;
    } catch (error) {
      logger.error(`Error retrieving cached query results: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache document embeddings
   * @param {string} documentId - Document ID
   * @param {string} content - Document content
   * @param {Array} embedding - Embedding vector
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async cacheDocumentEmbedding(documentId, content, embedding, ttl = 3600) {
    try {
      const contentHash = this.generateHash(content);

      // Store in memory cache
      this._setCacheWithExpiration(`embedding:${contentHash}`, embedding, ttl);

      logger.info(`Embedding cached for document: ${documentId}`);
      return true;
    } catch (error) {
      logger.error(`Error caching document embedding: ${error.message}`);
      return false;
    }
  }

  /**
   * Get cached document embedding
   * @param {string} content - Document content
   * @returns {Promise<Array|null>} Cached embedding or null
   */
  async getCachedDocumentEmbedding(content) {
    try {
      const contentHash = this.generateHash(content);
      return this._getCache(`embedding:${contentHash}`);
    } catch (error) {
      logger.error(
        `Error retrieving cached document embedding: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Cache document chunks
   * @param {string} documentId - Document ID
   * @param {Array} chunks - Document chunks to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async cacheDocumentChunks(documentId, chunks, ttl = 1800) {
    try {
      const cacheKey = `doc_chunks:${documentId}`;

      // Store in memory cache
      this._setCacheWithExpiration(cacheKey, chunks, ttl);

      logger.info(`Document chunks cached for: ${documentId}`);
      return true;
    } catch (error) {
      logger.error(`Error caching document chunks: ${error.message}`);
      return false;
    }
  }

  /**
   * Get cached document chunks
   * @param {string} documentId - Document ID
   * @returns {Promise<Array|null>} Cached chunks or null
   */
  async getCachedDocumentChunks(documentId) {
    try {
      const cacheKey = `doc_chunks:${documentId}`;
      return this._getCache(cacheKey);
    } catch (error) {
      logger.error(`Error retrieving cached document chunks: ${error.message}`);
      return null;
    }
  }

  /**
   * Cache general results by key
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>} Success status
   */
  async cacheResult(key, value, ttl) {
    try {
      // Store in memory cache
      this._setCacheWithExpiration(key, value, ttl || 600);

      logger.info(`Cached result with key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error caching result: ${error.message}`);
      return false;
    }
  }

  /**
   * Get cached result by key
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} Cached value or null
   */
  async getCachedResult(key) {
    try {
      const cachedValue = this._getCache(key);

      if (cachedValue) {
        logger.info(`Cache hit for key: ${key}`);
        return cachedValue;
      }

      logger.info(`Cache miss for key: ${key}`);
      return null;
    } catch (error) {
      logger.error(`Error retrieving cached result: ${error.message}`);
      return null;
    }
  }

  /**
   * Invalidate document cache
   * @param {string} documentId - Document ID to invalidate
   * @returns {Promise<boolean>} Success status
   */
  async invalidateDocumentCache(documentId) {
    try {
      const cacheKey = `doc_chunks:${documentId}`;
      const deleted = this._deleteCache(cacheKey);

      logger.info(`Document cache invalidated for: ${documentId}`);
      return deleted;
    } catch (error) {
      logger.error(`Error invalidating document cache: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if Redis is available
   * @returns {boolean} Redis availability status
   */
  isRedisAvailable() {
    return false; // Redis is no longer used
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  async getCacheStats() {
    return {
      enabled: true,
      provider: "memory",
      size: memoryCache.size,
    };
  }

  /**
   * Cache health check results
   * @param {string} service - Service name
   * @param {boolean} status - Health status
   * @param {number} ttl - TTL in seconds
   * @returns {Promise<boolean>} Success status
   */
  async cacheHealthStatus(service, status, ttl = 30) {
    try {
      // Store health status in memory cache
      this._setCacheWithExpiration(
        `health:${service}`,
        { status, checkedAt: new Date().toISOString() },
        ttl
      );
      return true;
    } catch (error) {
      logger.error(`Error caching health status: ${error.message}`);
      return false;
    }
  }

  /**
   * Get cached health status
   * @param {string} service - Service name
   * @returns {Promise<Object|null>} Health status or null
   */
  async getCachedHealthStatus(service) {
    try {
      return this._getCache(`health:${service}`);
    } catch (error) {
      logger.error(`Error retrieving cached health status: ${error.message}`);
      return null;
    }
  }
}

module.exports = new CacheService();
