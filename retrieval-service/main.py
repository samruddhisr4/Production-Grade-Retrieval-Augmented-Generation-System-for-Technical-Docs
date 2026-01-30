"""
Python Retrieval Service for RAG Pipeline

This service handles the semantic retrieval component of the RAG pipeline using FAISS
for efficient vector similarity search.

The FAISS index follows a persistence model:
- Index is saved to disk in binary format (.bin file)
- Index is loaded on service startup if exists
- Index is NOT rebuilt on every query (maintains performance)
- This serves as the primary vector database for the system
"""

import os
import sys
import logging
from typing import List, Dict, Any, Optional
import uuid
from datetime import datetime

# Load environment variables first
from dotenv import load_dotenv
load_dotenv()

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
import uvicorn

# Import the additional modules needed
import tempfile

# Import utilities directly from utils directory
from utils.document_processor import DocumentProcessor
from utils.embedding_generator import EmbeddingGenerator
from utils.faiss_index_manager import FaissIndexManager

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize our services
# The FaissIndexManager automatically loads existing index from disk if available
# This ensures the vector database persists between service restarts
processor = DocumentProcessor(chunk_size=512, overlap=50)
embedding_gen = EmbeddingGenerator()
index_manager = FaissIndexManager(
    dimension=embedding_gen.get_embedding_dimension(),
    index_path="./data/faiss_index.bin",
    metadata_path="./data/chunk_metadata.pkl"
)
# Note: FAISS index is persisted to disk, loaded on startup, and NOT rebuilt on every query
# This serves as the primary vector database for the system

# Import and initialize LLM service
try:
    # Try importing from the project root structure
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
    from app.core.llm_service import LLMService
    llm_service = LLMService()
except ImportError:
    logger.warning("LLM service not available, using mock responses")
    # Create a mock LLM service
    class MockLLMService:
        async def generate_response(self, prompt: str) -> str:
            return f"This is a mock response based on your query: {prompt[:50]}..."
    llm_service = MockLLMService()

# Pydantic models for request/response
class SearchRequest(BaseModel):
    query: str
    user_id: Optional[str] = None
    top_k: int = 5  # Number of results to return

class SearchResult(BaseModel):
    chunk_id: str
    document_id: str
    content: str
    similarity_score: float
    metadata: Dict[str, Any]

class SearchResponse(BaseModel):
    query: str
    results: List[SearchResult]
    query_embedding: Optional[List[float]] = []

class IngestRequest(BaseModel):
    content: str
    metadata: Dict[str, Any]

class IngestResponse(BaseModel):
    document_id: str
    chunks_processed: int
    status: str

class QueryRequest(BaseModel):
    query: str
    user_id: Optional[str] = None
    top_k: int = 5

class QueryResponse(BaseModel):
    query: str
    answer: str
    sources: List[SearchResult]
    query_embedding: Optional[List[float]] = []

app = FastAPI(title="RAG Retrieval Service", version="1.0.0")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": __import__('datetime').datetime.utcnow().isoformat(),
        "service": "Python Retrieval Service",
        "indexed_documents": index_manager.get_total_vectors()
    }


@app.post("/api/v1/search", response_model=SearchResponse)
async def search_documents(request: SearchRequest):
    """
    Search for relevant document chunks based on the query
    Uses FAISS for efficient similarity search
    
    Pipeline follows clear separation of concerns:
    1. Query analysis - process the incoming query
    2. Semantic retrieval (FAISS) - fetch relevant document chunks
    3. Result formatting - prepare results for response
    """
    logger.info(f"Search query received: {request.query[:50]}...")
    
    try:
        # Generate embedding for the query
        query_embedding = embedding_gen.generate_embedding(request.query)
        
        # Convert to numpy array for FAISS
        query_array = __import__('numpy').array(query_embedding).astype('float32')
        
        # Perform similarity search using FAISS
        similarities, indices, metadata_list = index_manager.search(
            query_array, k=request.top_k
        )
        
        # Format results
        results = []
        for i in range(len(similarities)):
            if similarities[i] != 0:  # Skip zero similarity results
                result = SearchResult(
                    chunk_id=metadata_list[i].get('chunk_id', f'unknown_{i}'),
                    document_id=metadata_list[i].get('document_id', 'unknown'),
                    content=metadata_list[i].get('content', ''),
                    similarity_score=float(similarities[i]),
                    metadata={k: v for k, v in metadata_list[i].items() 
                             if k not in ['chunk_id', 'document_id', 'content']}
                )
                results.append(result)
        
        logger.info(f"Found {len(results)} relevant results for query")
        
        return SearchResponse(
            query=request.query,
            results=results,
            query_embedding=query_embedding
        )
        
    except Exception as e:
        logger.error(f"Error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.post("/api/v1/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """
    Query the RAG system and generate an answer using LLM
    
    Pipeline follows clear separation of concerns:
    1. Query analysis - process the incoming query
    2. Semantic retrieval (FAISS) - fetch relevant document chunks
    3. Context preparation - format retrieved chunks for LLM
    4. Answer generation - create response using LLM
    5. Result formatting - prepare results for response
    """
    logger.info(f"Query received: {request.query[:50]}...")
    
    try:
        # First, get the relevant documents using search
        query_embedding = embedding_gen.generate_embedding(request.query)
        query_array = __import__('numpy').array(query_embedding).astype('float32')
        
        # Perform similarity search using FAISS
        similarities, indices, metadata_list = index_manager.search(
            query_array, k=request.top_k
        )
        
        # Format search results
        search_results = []
        context_parts = []
        for i in range(len(similarities)):
            if similarities[i] != 0:  # Skip zero similarity results
                result = SearchResult(
                    chunk_id=metadata_list[i].get('chunk_id', f'unknown_{i}'),
                    document_id=metadata_list[i].get('document_id', 'unknown'),
                    content=metadata_list[i].get('content', ''),
                    similarity_score=float(similarities[i]),
                    metadata={k: v for k, v in metadata_list[i].items() 
                             if k not in ['chunk_id', 'document_id', 'content']}
                )
                search_results.append(result)
                context_parts.append(f"Context {i+1}: {result.content}")

        # Build the prompt for the LLM
        context = "\n\n".join(context_parts)
        prompt = f"""Please answer the following question based on the provided context. If the context doesn't contain relevant information, please say so.

Context:
{context}

Question: {request.query}

Answer:"""
        
        # Generate response using LLM
        answer = await llm_service.generate_response(prompt)
        
        logger.info(f"Generated answer for query")
        
        return QueryResponse(
            query=request.query,
            answer=answer,
            sources=search_results,
            query_embedding=query_embedding
        )
        
    except Exception as e:
        logger.error(f"Error during query processing: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Query processing failed: {str(e)}")


@app.post("/api/v1/ingest", response_model=IngestResponse)
async def ingest_document(request: IngestRequest):
    """
    Ingest a new document into the system
    
    Pipeline follows clear separation of concerns:
    1. Document validation - check incoming content and metadata
    2. Document processing - chunk the document with enhanced metadata
    3. Embedding generation - convert chunks to vector representations
    4. Vector indexing - add to FAISS vector database with metadata
    5. Status reporting - provide ingestion feedback
    """
    logger.info(f"Ingesting document: {request.metadata.get('title', 'Unknown')}")
    
    # Generate document ID early to ensure it's available in error handling
    document_id = f"doc_{uuid.uuid4().hex[:8]}"
    
    try:
        document_name = request.metadata.get('title', request.metadata.get('source_file', 'Unknown Document'))
        
        # Update status to PROCESSING
        await update_document_status(document_id, 'PROCESSING', {
            'step': 'chunking',
            'timestamp': datetime.utcnow().isoformat()
        })
        
        # Process the document into chunks with enhanced metadata
        chunks = processor.process_document(request.content, document_id, document_name)
        
        # Generate embeddings for each chunk
        embeddings = []
        chunk_metadatas = []
        
        for i, chunk in enumerate(chunks):
            # Update status periodically during processing
            if i % 10 == 0:  # Every 10 chunks
                await update_document_status(document_id, 'PROCESSING', {
                    'step': 'embedding',
                    'chunks_processed': i,
                    'total_chunks': len(chunks),
                    'timestamp': datetime.utcnow().isoformat()
                })
            
            # Generate embedding for the chunk
            embedding = embedding_gen.generate_embedding(chunk['content'])
            embeddings.append(embedding)
            
            # Prepare metadata for this chunk
            chunk_metadata = {
                'document_id': document_id,
                'document_name': document_name,
                'chunk_id': f"{document_id}_chunk_{i}",
                'chunk_index': i,
                'total_chunks': len(chunks),
                'section': chunk.get('section', 'general'),
                'offset_start': chunk.get('offset_start', 0),
                'offset_end': chunk.get('offset_end', 0),
                'processing_timestamp': datetime.utcnow().isoformat(),
                'content': chunk['content']
            }
            # Add any additional metadata from the original request
            chunk_metadata.update(request.metadata)
            chunk_metadatas.append(chunk_metadata)
        
        # Convert embeddings to numpy array
        import numpy as np
        embeddings_array = np.array(embeddings).astype('float32')
        
        # Update status to INDEXING
        await update_document_status(document_id, 'INDEXING', {
            'step': 'indexing',
            'timestamp': datetime.utcnow().isoformat()
        })
        
        # Add vectors and metadata to the FAISS index
        index_manager.add_vectors(embeddings_array, chunk_metadatas)
        
        # Update status to COMPLETED
        await update_document_status(document_id, 'COMPLETED', {
            'step': 'completed',
            'chunks_processed': len(chunks),
            'timestamp': datetime.utcnow().isoformat()
        })
        
        logger.info(f"Successfully ingested document '{document_name}' with {len(chunks)} chunks")
        
        return IngestResponse(
            document_id=document_id,
            chunks_processed=len(chunks),
            status="success"
        )
        
    except Exception as e:
        logger.error(f"Error during document ingestion: {str(e)}")
        # Update status to FAILED
        await update_document_status(document_id, 'FAILED', {
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        })
        raise HTTPException(status_code=500, detail=f"Document ingestion failed: {str(e)}")


@app.post("/api/v1/upload-file", response_model=IngestResponse)
async def upload_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    author: str = Form(None),
    source: str = Form(None)
):
    """
    Upload and ingest a file (PDF, DOCX, TXT, MD) into the system
    
    Supports multiple file formats:
    - PDF (.pdf)
    - Word documents (.docx, .doc)
    - Text files (.txt)
    - Markdown files (.md)
    
    Pipeline follows clear separation of concerns:
    1. File validation - check file type and content
    2. Text extraction - extract text from the uploaded file
    3. Document processing - chunk the extracted text with enhanced metadata
    4. Embedding generation - convert chunks to vector representations
    5. Vector indexing - add to FAISS vector database with metadata
    6. Status reporting - provide ingestion feedback
    """
    # Get file extension
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    # Validate file type
    supported_types = ['.pdf', '.docx', '.doc', '.txt', '.md', '.markdown']
    if file_ext not in supported_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Supported types: {', '.join(supported_types)}"
        )
    
    logger.info(f"Uploading file: {file.filename} (type: {file_ext})")
    
    # Read file content
    file_content = await file.read()
    
    # Extract text from the file based on its type
    try:
        extracted_text = processor.extract_text_from_file(file_content, file_ext)
    except Exception as e:
        logger.error(f"Error extracting text from file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text from file: {str(e)}")
    
    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail="File is empty or could not be read properly")
    
    # Generate document ID
    document_id = f"doc_{uuid.uuid4().hex[:8]}"
    
    try:
        # Create metadata
        metadata = {
            'title': title,
            'author': author or '',
            'source': source or '',
            'source_file': file.filename,
            'file_type': file_ext,
            'file_size': len(file_content)
        }
        
        document_name = title
        
        # Update status to PROCESSING
        await update_document_status(document_id, 'PROCESSING', {
            'step': 'chunking',
            'timestamp': datetime.utcnow().isoformat()
        })
        
        # Process the extracted text into chunks with enhanced metadata
        chunks = processor.process_document(extracted_text, document_id, document_name, file_ext)
        
        # Generate embeddings for each chunk
        embeddings = []
        chunk_metadatas = []
        
        for i, chunk in enumerate(chunks):
            # Update status periodically during processing
            if i % 10 == 0:  # Every 10 chunks
                await update_document_status(document_id, 'PROCESSING', {
                    'step': 'embedding',
                    'chunks_processed': i,
                    'total_chunks': len(chunks),
                    'timestamp': datetime.utcnow().isoformat()
                })
            
            # Generate embedding for the chunk
            embedding = embedding_gen.generate_embedding(chunk['content'])
            embeddings.append(embedding)
            
            # Prepare metadata for this chunk
            chunk_metadata = {
                'document_id': document_id,
                'document_name': document_name,
                'chunk_id': f"{document_id}_chunk_{i}",
                'chunk_index': i,
                'total_chunks': len(chunks),
                'section': chunk.get('section', 'general'),
                'offset_start': chunk.get('offset_start', 0),
                'offset_end': chunk.get('offset_end', 0),
                'processing_timestamp': datetime.utcnow().isoformat(),
                'content': chunk['content'],
                'source_file': file.filename,
                'file_type': file_ext
            }
            # Add any additional metadata
            chunk_metadata.update(metadata)
            chunk_metadatas.append(chunk_metadata)
        
        # Convert embeddings to numpy array
        import numpy as np
        embeddings_array = np.array(embeddings).astype('float32')
        
        # Update status to INDEXING
        await update_document_status(document_id, 'INDEXING', {
            'step': 'indexing',
            'timestamp': datetime.utcnow().isoformat()
        })
        
        # Add vectors and metadata to the FAISS index
        index_manager.add_vectors(embeddings_array, chunk_metadatas)
        
        # Update status to COMPLETED
        await update_document_status(document_id, 'COMPLETED', {
            'step': 'completed',
            'chunks_processed': len(chunks),
            'timestamp': datetime.utcnow().isoformat()
        })
        
        logger.info(f"Successfully ingested file '{file.filename}' with {len(chunks)} chunks")
        
        return IngestResponse(
            document_id=document_id,
            chunks_processed=len(chunks),
            status="success"
        )
        
    except Exception as e:
        logger.error(f"Error during file upload ingestion: {str(e)}")
        # Update status to FAILED
        await update_document_status(document_id, 'FAILED', {
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        })
        raise HTTPException(status_code=500, detail=f"File upload ingestion failed: {str(e)}")


# Placeholder for document status updates - in a real implementation, this would connect to a database
async def update_document_status(document_id: str, status: str, details: Dict[str, Any]):
    """Update the status of a document ingestion process"""
    # In a real implementation, this would update a database record
    logger.info(f"Document {document_id} status: {status}, details: {details}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)