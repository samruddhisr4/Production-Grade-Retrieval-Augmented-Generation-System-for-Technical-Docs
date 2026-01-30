# RAG Pipeline Project

A complete Retrieval-Augmented Generation (RAG) pipeline implementation with document processing, embedding generation, vector storage, and LLM integration.

## Features

- **Document Processing**: Extract and chunk documents from various formats
- **Embedding Generation**: Create vector representations of text
- **Vector Storage**: Efficient similarity search with persistent storage
- **LLM Integration**: Generate contextual answers using language models
- **Web API**: RESTful API for easy integration
- **Modular Architecture**: Extensible components for customization
- **Retrieval Validation**: Quality gates to prevent hallucination
- **Deduplication**: Intelligent removal of near-identical results
- **Source Transparency**: Clear citation of document sources

## RAG Pipeline Architecture - Clear Separation of Concerns

The system follows a well-defined 6-stage pipeline with clear separation of responsibilities:

### 1. Query Analysis

- **Purpose**: Process and expand user queries for better retrieval
- **Location**: [queryProcessor.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/services/queryProcessor.js) - query expansion, [ragController.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/controllers/ragController.js) - preprocessing
- **Function**: Rewrites and expands queries to improve semantic matching

### 2. Semantic Retrieval (FAISS)

- **Purpose**: Fetch relevant document chunks using vector similarity search
- **Location**: Python retrieval service (`retrieval-service/main.py`, `faiss_index_manager.py`)
- **Function**: Performs efficient similarity search against vector database

### 3. Retrieval Validation (Gating)

- **Purpose**: Ensure quality of retrieved results before answer generation
- **Location**: [ragController.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/controllers/ragController.js) - `_validateRetrievalQuality` method
- **Function**: Enforces minimum similarity threshold and document diversity

### 4. Result Quality Optimization

- **Purpose**: Improve result quality through deduplication and grouping
- **Location**: [queryProcessor.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/services/queryProcessor.js) - `_deduplicateResults` and `_groupResultsByDocument`
- **Function**: Removes near-identical chunks and limits per-document representation

### 5. Answer Generation

- **Purpose**: Create responses from retrieved context using LLM
- **Location**: [ragController.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/controllers/ragController.js) - LLM integration
- **Function**: Generates grounded answers based on retrieved context

### 6. Source Citation

- **Purpose**: Show original document sources for transparency
- **Location**: [queryProcessor.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/services/queryProcessor.js) - citation formatting, [SourcesPanel.js](file:///c:/Users/samru/OneDrive/Desktop/RAG%20Project/api/frontend-react/src/components/SourcesPanel.js) - frontend display
- **Function**: Provides transparent source attribution

## Installation

```bash
pip install -r requirements.txt
```

## Quick Start

### 1. Run Tests

```bash
python tests/test_components.py
```

### 2. Run Demo

```bash
python demos/demo_rag_pipeline.py
```

### 3. Start API Server

```bash
cd api
python main.py
```

Or using uvicorn directly:

```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /` - Health check
- `POST /query` - Query the RAG pipeline
- `POST /index` - Index a new document
- `GET /documents/count` - Get document count
- `DELETE /documents/clear` - Clear all documents

## Example Usage

### Using the API

```bash
# Index a document
curl -X POST "http://localhost:8000/index" \
     -H "accept: application/json" \
     -H "Content-Type: multipart/form-data" \
     -F "file=@path/to/document.txt"

# Query the pipeline
curl -X POST "http://localhost:8000/query" \
     -H "accept: application/json" \
     -H "Content-Type: application/json" \
     -d '{"question": "What is artificial intelligence?", "k": 5}'
```

### Using Python

```python
from app.core.rag_pipeline import rag_pipeline
import asyncio

# Index a document
await rag_pipeline.index_document("path/to/document.txt")

# Query
response = await rag_pipeline.query("What is machine learning?")
print(f"Answer: {response.answer}")
print(f"Confidence: {response.confidence}")
```

## Project Structure

```
app/
├── core/
│   ├── document_processor.py    # Document chunking and processing
│   ├── embedding_service.py     # Text embedding generation
│   ├── llm_service.py           # Language model integration
│   ├── vector_store.py          # Vector storage and search
│   └── rag_pipeline.py          # Main RAG orchestrator
├── api/
│   └── main.py                  # FastAPI web interface
tests/
├── test_components.py           # Component tests
demos/
├── demo_rag_pipeline.py         # Interactive demonstrations
requirements.txt                 # Python dependencies
```

## Architecture Overview

1. **Document Processor**: Splits documents into manageable chunks
2. **Embedding Service**: Converts text chunks into vector embeddings
3. **Vector Store**: Stores embeddings and performs similarity search
4. **LLM Service**: Generates natural language responses
5. **RAG Pipeline**: Orchestrates the entire process

## Customization

The pipeline is designed to be modular and extensible:

- Swap different embedding models
- Integrate various vector databases (Pinecone, Weaviate, Chroma)
- Connect to different LLM providers (OpenAI, Anthropic, Hugging Face)
- Add support for additional document formats
- Configure quality gates and validation thresholds

## License

MIT License
