const { pool } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

class QueryService {
  /**
   * Record a query in the database
   * @param {Object} queryData - Query information
   * @returns {Promise<string>} Query ID
   */
  async recordQuery(queryData) {
    const queryId = `qry_${uuidv4()}`;

    const insertQuery = `
      INSERT INTO queries (
        query_id, user_id, query_text, query_embedding, 
        results_count, response_time_ms, retrieved_chunks, 
        generated_answer, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const [result] = await pool.execute(insertQuery, [
      queryId,
      queryData.user_id || null,
      queryData.query_text,
      JSON.stringify(queryData.query_embedding) || null,
      queryData.results_count || 0,
      queryData.response_time_ms || null,
      JSON.stringify(queryData.retrieved_chunks) || null,
      queryData.generated_answer || null,
      JSON.stringify(queryData.metadata || {}),
    ]);

    return queryId;
  }

  /**
   * Get query history for a user
   * @param {string} userId - User ID
   * @param {number} limit - Number of records to return
   * @returns {Promise<Array>} Query history
   */
  async getUserQueryHistory(userId, limit = 50) {
    const query = `
      SELECT * FROM queries 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `;

    const [rows] = await pool.execute(query, [userId, limit]);
    return rows;
  }

  /**
   * Update query feedback
   * @param {string} queryId - Query ID
   * @param {number} feedbackScore - Feedback score (1-5)
   * @returns {Promise<Object>} Update result
   */
  async updateQueryFeedback(queryId, feedbackScore) {
    const updateQuery = `
      UPDATE queries 
      SET feedback_score = ?, updated_at = NOW() 
      WHERE query_id = ?
    `;

    const [result] = await pool.execute(updateQuery, [feedbackScore, queryId]);
    return result;
  }

  /**
   * Get query statistics
   * @returns {Promise<Object>} Query statistics
   */
  async getQueryStats() {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_queries,
        AVG(response_time_ms) as avg_response_time,
        -- Confidence score removed - using similarity score ranges instead
        NULL as avg_confidence,
        COUNT(CASE WHEN feedback_score IS NOT NULL THEN 1 END) as total_feedbacks
      FROM queries
    `;

    const [statsRows] = await pool.execute(statsQuery);
    const stats = statsRows[0];

    // Ensure numeric values are properly handled
    return {
      total_queries: stats.total_queries || 0,
      avg_response_time: stats.avg_response_time
        ? parseFloat(stats.avg_response_time)
        : null,
      // Confidence metric removed - using similarity score ranges instead
      avg_confidence: null,
      total_feedbacks: stats.total_feedbacks || 0,
    };
  }

  /**
   * Get popular queries
   * @param {number} limit - Number of records to return
   * @returns {Promise<Array>} Popular queries
   */
  async getPopularQueries(limit = 10) {
    const query = `
      SELECT 
        query_text,
        COUNT(*) as frequency
        -- Confidence score removed - using similarity score ranges instead
        -- AVG(confidence_score) as avg_confidence
      FROM queries 
      GROUP BY query_text
      ORDER BY frequency DESC
      LIMIT ?
    `;

    const [rows] = await pool.execute(query, [limit]);
    return rows;
  }
}

module.exports = new QueryService();
