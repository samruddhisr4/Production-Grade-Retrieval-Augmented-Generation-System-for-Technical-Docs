const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

class QueryProcessor {
  constructor() {
    // Define query expansion terms for technical documentation
    this.queryExpansions = {
      install: ["setup", "configuration", "getting started"],
      error: ["issue", "problem", "troubleshoot", "fix"],
      config: ["configuration", "settings", "preferences", "options"],
      api: ["interface", "endpoint", "call", "integration"],
      auth: ["authentication", "authorization", "login", "security"],
      performance: ["speed", "optimization", "efficiency", "benchmark"],
      deploy: ["deployment", "release", "publish", "ship"],
      upgrade: ["update", "migration", "version", "change"],
      monitor: ["track", "observe", "watch", "metrics", "logging"],
      backup: ["restore", "recovery", "archive", "save"],
    };
  }

  /**
   * Rewrite and expand the user query for better retrieval
   * @param {string} query - Original user query
   * @returns {Object} Rewritten query and expansion terms
   */
  rewriteQuery(query) {
    const originalQuery = query.trim();
    let rewrittenQuery = originalQuery.toLowerCase();
    const expansions = [];

    // Expand query terms based on known mappings
    Object.keys(this.queryExpansions).forEach((term) => {
      if (rewrittenQuery.includes(term)) {
        const relatedTerms = this.queryExpansions[term];
        expansions.push(...relatedTerms);
      }
    });

    // Remove common stop words and add expansions
    const stopWords = [
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
    ];
    const words = rewrittenQuery
      .split(/\s+/)
      .filter((word) => !stopWords.includes(word));

    // Combine original words with expansions
    const allTerms = [...new Set([...words, ...expansions])];

    logger.debug(
      `Query rewritten: "${originalQuery}" -> "${allTerms.join(" ")}"`
    );

    return {
      original: originalQuery,
      expanded: allTerms.join(" "),
      terms: allTerms,
      expansions: expansions,
    };
  }

  /**
   * Apply query rewriting and return enhanced search parameters
   * @param {string} query - User query
   * @param {number} topK - Number of results to retrieve
   * @returns {Object} Enhanced query parameters
   */
  prepareSearchQuery(query, topK = 5) {
    const processed = this.rewriteQuery(query);

    return {
      originalQuery: processed.original,
      searchQuery: processed.expanded,
      topK: Math.min(topK + 2, 20), // Increase slightly to have buffer for filtering
      expansionTerms: processed.expansions,
      queryComplexity: this.analyzeQueryComplexity(processed.terms),
    };
  }

  /**
   * Analyze query complexity to determine search strategy
   * @param {Array} terms - Query terms
   * @returns {Object} Complexity analysis
   */
  analyzeQueryComplexity(terms) {
    return {
      termCount: terms.length,
      averageLength:
        terms.reduce((sum, term) => sum + term.length, 0) / terms.length,
      hasTechnicalTerms: terms.some((term) => this.isTechnicalTerm(term)),
      isComplex: terms.length > 3 || terms.some((term) => term.length > 15),
    };
  }

  /**
   * Check if a term is likely technical jargon
   * @param {string} term - Term to check
   * @returns {boolean} True if technical term
   */
  isTechnicalTerm(term) {
    const technicalPatterns = [
      /^[a-z]+[A-Z][a-zA-Z]*$/, // camelCase
      /^[A-Z_]+$/, // SCREAMING_SNAKE_CASE
      /[0-9]{2,}/, // Numbers
      /\.(com|org|net|io|js|py|java|html|css|sql)$/, // Extensions
      /^(api|sdk|cli|gui|ui|ux|http|https|url|uri|json|xml|yaml|toml|env|cfg)$/, // Acronyms
    ];

    return technicalPatterns.some((pattern) => pattern.test(term));
  }

  /**
   * Format results with proper citations and metadata
   * Applies post-retrieval optimizations including deduplication and document grouping
   * @param {Array} results - Raw search results
   * @param {string} originalQuery - Original query
   * @returns {Array} Formatted results with citations
   */
  formatResultsWithCitations(results, originalQuery) {
    if (!results || results.length === 0) {
      return [];
    }

    // Sort by similarity score descending
    const sortedResults = [...results].sort(
      (a, b) => b.similarity_score - a.similarity_score
    );

    // Post-retrieval optimization: deduplicate near-identical chunks
    const deduplicatedResults = this._deduplicateResults(sortedResults);

    // Post-retrieval optimization: group by document and limit chunks per document
    const groupedResults = this._groupResultsByDocument(deduplicatedResults);

    return groupedResults.map((result, index) => {
      // Extract relevant sentences that contain query terms
      const relevantSentences = this.extractRelevantSentences(
        result.content,
        originalQuery
      );

      return {
        id: result.chunk_id,
        rank: index + 1,
        score: result.similarity_score,
        content: result.content,
        relevant_extracts: relevantSentences,
        source: {
          document_id: result.document_id,
          source_file: result.metadata?.source || "unknown",
          page: result.metadata?.page || null,
          section: result.metadata?.section || "general",
          chunk_order: result.metadata?.chunk_order || 0,
        },
        citation: `[${index + 1}] Source: ${
          result.metadata?.source || "Unknown Document"
        }`,
        metadata: result.metadata || {},
      };
    });
  }

  /**
   * Deduplicate near-identical chunks based on content similarity
   * This post-retrieval optimization prevents redundancy from similar results
   * @param {Array} results - Sorted results by similarity score
   * @returns {Array} Deduplicated results
   */
  _deduplicateResults(results) {
    if (!results || results.length <= 1) {
      return results;
    }

    const uniqueResults = [];

    for (const result of results) {
      // Check if this result is too similar to any already included result
      const isDuplicate = uniqueResults.some((existing) => {
        // Compare content similarity - if content is nearly identical, consider it a duplicate
        return (
          this._calculateContentSimilarity(result.content, existing.content) >
          0.9
        );
      });

      if (!isDuplicate) {
        uniqueResults.push(result);
      }
    }

    // Log deduplication stats
    const originalCount = results.length;
    const deduplicatedCount = uniqueResults.length;
    if (originalCount !== deduplicatedCount) {
      console.log(
        `Deduplication: Reduced from ${originalCount} to ${deduplicatedCount} results`
      );
    }

    return uniqueResults;
  }

  /**
   * Group results by document and limit max chunks per document
   * This post-retrieval optimization ensures diverse document coverage
   * @param {Array} results - Results after deduplication
   * @returns {Array} Results grouped by document with limits applied
   */
  _groupResultsByDocument(results) {
    if (!results || results.length <= 1) {
      return results;
    }

    // Group results by document
    const documentGroups = {};

    for (const result of results) {
      const docId = result.document_id || result.metadata?.source || "unknown";

      if (!documentGroups[docId]) {
        documentGroups[docId] = [];
      }

      documentGroups[docId].push(result);
    }

    // Limit max chunks per document (e.g., max 2 chunks per document)
    const maxChunksPerDocument = 2;
    const limitedResults = [];

    for (const [docId, docResults] of Object.entries(documentGroups)) {
      // Take top results from each document (they're already sorted by similarity)
      const topResultsFromDoc = docResults.slice(0, maxChunksPerDocument);
      limitedResults.push(...topResultsFromDoc);
    }

    // Final sort by similarity score to maintain ranking order
    return limitedResults.sort(
      (a, b) => b.similarity_score - a.similarity_score
    );
  }

  /**
   * Calculate content similarity using simple Jaccard similarity
   * Used for deduplication to identify near-identical chunks
   * @param {string} content1 - First content to compare
   * @param {string} content2 - Second content to compare
   * @returns {number} Similarity score between 0 and 1
   */
  _calculateContentSimilarity(content1, content2) {
    // Simple Jaccard similarity based on words
    const words1 = new Set(content1.toLowerCase().match(/\b\w+\b/g) || []);
    const words2 = new Set(content2.toLowerCase().match(/\b\w+\b/g) || []);

    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Extract sentences that contain query terms
   * @param {string} content - Full content
   * @param {string} query - Original query
   * @returns {Array} Relevant sentences
   */
  extractRelevantSentences(content, query) {
    // Split content into sentences
    const sentences = content
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    // Find sentences that contain query terms
    const relevant = sentences.filter((sentence) => {
      const lowerSentence = sentence.toLowerCase();
      return queryTerms.some((term) => lowerSentence.includes(term));
    });

    return relevant.slice(0, 3); // Return top 3 relevant sentences
  }

  /**
   * Generate fallback response when retrieval fails
   * @param {string} query - User query
   * @returns {Object} Fallback response
   */
  generateFallbackResponse(query) {
    const fallbacks = [
      `I couldn't find specific information about "${query}" in the documentation. Please try rephrasing your question or check if the information exists in the documentation.`,
      `The query "${query}" didn't return any relevant results. Consider trying alternative terms or checking the documentation directly.`,
      `No relevant documentation was found for your query: "${query}". Try breaking down your question into simpler terms.`,
    ];

    const randomFallback =
      fallbacks[Math.floor(Math.random() * fallbacks.length)];

    return {
      query: query,
      results: [],
      retrieved_count: 0,
      generated_answer: randomFallback,
      sources: [],
      // Confidence score removed - using similarity score range instead
      similarity_score_range: "N/A",
      is_fallback: true,
      suggestions: this.generateSuggestions(query),
    };
  }

  /**
   * Generate query suggestions when retrieval fails
   * @param {string} query - Original query
   * @returns {Array} Suggested queries
   */
  generateSuggestions(query) {
    const terms = query.toLowerCase().split(/\s+/);
    const suggestions = [];

    // Generate variations by removing terms
    for (let i = 0; i < terms.length; i++) {
      const suggestion = terms.filter((_, idx) => idx !== i).join(" ");
      if (suggestion && suggestion !== query.toLowerCase()) {
        suggestions.push(suggestion);
      }
    }

    // Add common prefixes/suffixes
    suggestions.push(
      `how to ${query}`,
      `what is ${query}`,
      `configure ${query}`
    );

    return [...new Set(suggestions)].slice(0, 5); // Return unique suggestions, max 5
  }
}

module.exports = new QueryProcessor();
