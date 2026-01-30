"""Vector Store Integration for RAG Pipeline"""

import os
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import numpy as np
from pathlib import Path
import json
import logging

logger = logging.getLogger(__name__)

@dataclass
class VectorDocument:
    """Represents a document with its vector embedding"""
    id: str
    content: str
    embedding: List[float]
    metadata: Dict[str, Any]

class BaseVectorStore:
    """Base class for vector stores"""
    
    def add_documents(self, documents: List[VectorDocument]) -> None:
        raise NotImplementedError
    
    def similarity_search(self, query_embedding: List[float], k: int = 5) -> List[VectorDocument]:
        raise NotImplementedError
    
    def delete_document(self, doc_id: str) -> bool:
        raise NotImplementedError

class SimpleVectorStore(BaseVectorStore):
    """Simple in-memory vector store implementation"""
    
    def __init__(self):
        self.documents: Dict[str, VectorDocument] = {}
        self.embeddings: List[List[float]] = []
        self.doc_ids: List[str] = []
    
    def add_documents(self, documents: List[VectorDocument]) -> None:
        """Add documents to the vector store"""
        for doc in documents:
            if doc.id not in self.documents:
                self.documents[doc.id] = doc
                self.embeddings.append(doc.embedding)
                self.doc_ids.append(doc.id)
                logger.info(f"Added document {doc.id} to vector store")
    
    def similarity_search(self, query_embedding: List[float], k: int = 5) -> List[VectorDocument]:
        """Find similar documents using cosine similarity"""
        if not self.embeddings:
            return []
        
        # Convert to numpy arrays for computation
        query_vec = np.array(query_embedding)
        doc_embeddings = np.array(self.embeddings)
        
        # Compute cosine similarities
        similarities = []
        for i, doc_emb in enumerate(doc_embeddings):
            doc_vec = np.array(doc_emb)
            # Cosine similarity
            dot_product = np.dot(query_vec, doc_vec)
            query_norm = np.linalg.norm(query_vec)
            doc_norm = np.linalg.norm(doc_vec)
            
            if query_norm == 0 or doc_norm == 0:
                similarity = 0
            else:
                similarity = dot_product / (query_norm * doc_norm)
            
            similarities.append((similarity, i))
        
        # Sort by similarity (descending) and get top k
        similarities.sort(reverse=True)
        top_k = similarities[:k]
        
        # Return documents
        results = []
        for similarity, idx in top_k:
            doc_id = self.doc_ids[idx]
            doc = self.documents[doc_id]
            results.append(doc)
        
        logger.info(f"Found {len(results)} similar documents")
        return results
    
    def delete_document(self, doc_id: str) -> bool:
        """Delete a document from the store"""
        if doc_id in self.documents:
            # Remove from documents dict
            del self.documents[doc_id]
            
            # Remove from embeddings and doc_ids lists
            try:
                idx = self.doc_ids.index(doc_id)
                self.doc_ids.pop(idx)
                self.embeddings.pop(idx)
                logger.info(f"Deleted document {doc_id}")
                return True
            except ValueError:
                pass
        
        return False

class PersistentVectorStore(SimpleVectorStore):
    """Persistent vector store that saves to disk"""
    
    def __init__(self, storage_path: str = "data/vector_store"):
        super().__init__()
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.documents_file = self.storage_path / "documents.json"
        self.load()
    
    def add_documents(self, documents: List[VectorDocument]) -> None:
        """Add documents and save to disk"""
        super().add_documents(documents)
        self.save()
    
    def delete_document(self, doc_id: str) -> bool:
        """Delete document and save to disk"""
        result = super().delete_document(doc_id)
        if result:
            self.save()
        return result
    
    def save(self) -> None:
        """Save documents to disk"""
        data = {
            "documents": {
                doc_id: {
                    "id": doc.id,
                    "content": doc.content,
                    "embedding": doc.embedding,
                    "metadata": doc.metadata
                }
                for doc_id, doc in self.documents.items()
            }
        }
        
        with open(self.documents_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Saved {len(self.documents)} documents to {self.documents_file}")
    
    def load(self) -> None:
        """Load documents from disk"""
        if self.documents_file.exists():
            try:
                with open(self.documents_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                for doc_data in data.get("documents", {}).values():
                    doc = VectorDocument(
                        id=doc_data["id"],
                        content=doc_data["content"],
                        embedding=doc_data["embedding"],
                        metadata=doc_data["metadata"]
                    )
                    self.documents[doc.id] = doc
                    self.embeddings.append(doc.embedding)
                    self.doc_ids.append(doc.id)
                
                logger.info(f"Loaded {len(self.documents)} documents from {self.documents_file}")
            except Exception as e:
                logger.error(f"Error loading vector store: {e}")

def get_vector_store(store_type: str = "persistent") -> BaseVectorStore:
    """Factory function to get vector store instance"""
    if store_type == "simple":
        return SimpleVectorStore()
    elif store_type == "persistent":
        return PersistentVectorStore()
    else:
        raise ValueError(f"Unknown vector store type: {store_type}")