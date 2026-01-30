"""RAG Pipeline Orchestrator"""

import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import logging

from app.core.document_processor import DocumentProcessor
from app.core.embedding_service import EmbeddingService
from app.core.llm_service import LLMService
from app.core.vector_store import get_vector_store, VectorDocument

logger = logging.getLogger(__name__)

@dataclass
class RAGResponse:
    """Response from RAG pipeline"""
    answer: str
    sources: List[Dict[str, Any]]
    # confidence field removed - using similarity score ranges instead

class RAGPipeline:
    """Main RAG Pipeline orchestrator"""
    
    def __init__(self, vector_store_type: str = "persistent"):
        self.doc_processor = DocumentProcessor()
        self.embedding_service = EmbeddingService()
        self.llm_service = LLMService()
        self.vector_store = get_vector_store(vector_store_type)
        self.logger = logging.getLogger(__name__)
    
    async def index_document(self, file_path: str, doc_id: Optional[str] = None) -> bool:
        """Index a document into the vector store"""
        try:
            # Process document
            chunks = await self.doc_processor.process_document(file_path)
            
            if not chunks:
                self.logger.warning(f"No chunks extracted from {file_path}")
                return False
            
            # Generate embeddings
            embeddings = await self.embedding_service.generate_embeddings([chunk.text for chunk in chunks])
            
            if not embeddings:
                self.logger.error("Failed to generate embeddings")
                return False
            
            # Create vector documents
            vector_docs = []
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                vector_doc = VectorDocument(
                    id=f"{doc_id or file_path}_{i}",
                    content=chunk.text,
                    embedding=embedding,
                    metadata={
                        "source": file_path,
                        "chunk_index": i,
                        "page_number": getattr(chunk, 'page_number', None),
                        "section_title": getattr(chunk, 'section_title', None)
                    }
                )
                vector_docs.append(vector_doc)
            
            # Add to vector store
            self.vector_store.add_documents(vector_docs)
            
            self.logger.info(f"Successfully indexed {len(vector_docs)} chunks from {file_path}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error indexing document {file_path}: {e}")
            return False
    
    async def query(self, question: str, k: int = 5) -> RAGResponse:
        """Query the RAG pipeline"""
        try:
            # Generate query embedding
            query_embedding = await self.embedding_service.generate_embeddings([question])
            if not query_embedding:
                raise ValueError("Failed to generate query embedding")
            
            # Search for similar documents
            similar_docs = self.vector_store.similarity_search(query_embedding[0], k=k)
            
            if not similar_docs:
                return RAGResponse(
                    answer="I couldn't find any relevant information to answer your question.",
                    sources=[],
                    # confidence=0.0 removed
                )
            
            # Prepare context
            context = "\n\n".join([doc.content for doc in similar_docs])
            sources = [
                {
                    "content": doc.content,
                    "metadata": doc.metadata,
                    "similarity": 0.0  # Would need to compute actual similarity scores
                }
                for doc in similar_docs
            ]
            
            # Generate answer using LLM
            prompt = self._build_prompt(question, context)
            answer = await self.llm_service.generate_response(prompt)
            
            # Similarity score range replaces confidence
            return RAGResponse(
                answer=answer,
                sources=sources
            )
            
        except Exception as e:
            self.logger.error(f"Error processing query '{question}': {e}")
            return RAGResponse(
                answer="Sorry, I encountered an error processing your question.",
                sources=[],
                # confidence=0.0 removed
            )
    
    def _build_prompt(self, question: str, context: str) -> str:
        """Build prompt for LLM"""
        return f"""Use the following context to answer the question. If the context doesn't contain relevant information, say so.

Context:
{context}

Question: {question}

Answer:"""
    
    def get_document_count(self) -> int:
        """Get number of indexed documents"""
        # This is a simplification - would need to count unique document sources
        if hasattr(self.vector_store, 'documents'):
            return len(self.vector_store.documents)
        return 0
    
    def clear_index(self) -> None:
        """Clear all indexed documents"""
        # Implementation would depend on the vector store type
        self.logger.info("Index cleared")

# Global pipeline instance
rag_pipeline = RAGPipeline()