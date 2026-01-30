-- Create database if it doesn't exist
CREATE DATABASE IF NOT EXISTS rag_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Use the database
USE rag_system;

-- Create all tables (copied from our schema)
CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    source VARCHAR(500),
    author VARCHAR(255),
    file_path VARCHAR(1000),
    file_size INT,
    mime_type VARCHAR(100),
    checksum VARCHAR(64), -- SHA-256 hash
    version INT DEFAULT 1,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS document_chunks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chunk_id VARCHAR(255) UNIQUE NOT NULL,
    document_id VARCHAR(255) NOT NULL,
    chunk_order INT NOT NULL,
    content TEXT NOT NULL,
    embedding_vector_id VARCHAR(255), -- Reference to FAISS index position
    token_count INT,
    hash_value VARCHAR(64), -- SHA-256 hash of content
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    INDEX idx_document_id (document_id),
    INDEX idx_chunk_id (chunk_id),
    INDEX idx_embedding_vector_id (embedding_vector_id)
);

CREATE TABLE IF NOT EXISTS queries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    query_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255),
    query_text TEXT NOT NULL,
    query_embedding JSON, -- Store embedding as JSON for analysis
    results_count INT,
    response_time_ms INT,
    retrieved_chunks JSON, -- Store IDs of retrieved chunks
    generated_answer TEXT,
    -- confidence_score DECIMAL(3,2) removed - using similarity score ranges instead
    feedback_score TINYINT CHECK (feedback_score >= 1 AND feedback_score <= 5),
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(255) UNIQUE NOT NULL,
    document_id VARCHAR(255) NOT NULL,
    status ENUM('queued', 'in_progress', 'completed', 'failed', 'cancelled') DEFAULT 'queued',
    total_chunks INT DEFAULT 0,
    processed_chunks INT DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    INDEX idx_document_id (document_id),
    INDEX idx_status (status),
    INDEX idx_job_id (job_id)
);

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255),
    role ENUM('admin', 'user', 'viewer') DEFAULT 'user',
    permissions JSON,
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_email (email),
    INDEX idx_role (role)
);

CREATE TABLE IF NOT EXISTS document_tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tag_name VARCHAR(100) NOT NULL,
    tag_description TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_tag (tag_name),
    INDEX idx_tag_name (tag_name)
);

CREATE TABLE IF NOT EXISTS document_tag_relations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id VARCHAR(255) NOT NULL,
    tag_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES document_tags(id) ON DELETE CASCADE,
    UNIQUE KEY unique_doc_tag (document_id, tag_id)
);

CREATE TABLE IF NOT EXISTS query_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255),
    title VARCHAR(500),
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_session_id (session_id)
);

CREATE TABLE IF NOT EXISTS session_queries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_query_id VARCHAR(255) UNIQUE NOT NULL,
    session_id VARCHAR(255) NOT NULL,
    query_text TEXT NOT NULL,
    response_text TEXT,
    query_number INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES query_sessions(session_id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_query_number (query_number)
);

-- Create the rag_user if it doesn't exist
CREATE USER IF NOT EXISTS 'rag_user'@'%' IDENTIFIED BY 'Ramo@1602';

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON rag_system.* TO 'rag_user'@'%';

-- Refresh privileges
FLUSH PRIVILEGES;