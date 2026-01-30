import numpy as np
import pickle
import os
import logging
from typing import List, Dict, Any, Tuple
import uuid

# Try to import faiss, fall back to simple numpy-based similarity search if not available
try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    logging.warning("FAISS not available, using simple numpy-based similarity search")

logger = logging.getLogger(__name__)

class FaissIndexManager:
    """
    Manages FAISS index for vector similarity search
    Uses IndexFlatIP (Inner Product) which is equivalent to cosine similarity when vectors are normalized
    
    FAISS index lifecycle (vector database persistence):
    - Index is persisted to disk in binary format (.bin file)
    - Index is loaded on service startup (if exists)
    - Index is NOT rebuilt on every query (maintains performance)
    - This serves as the primary vector database for the system
    """
    
    def __init__(self, dimension: int, index_path: str = "./data/faiss_index.bin", 
                 metadata_path: str = "./data/chunk_metadata.pkl"):
        self.dimension = dimension
        self.index_path = index_path
        self.metadata_path = metadata_path
        self.index = None  # Will be initialized in create_index/load_index
        self.chunk_metadata = {}  # Maps index position to chunk metadata
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(index_path), exist_ok=True)
        
        # Initialize or load the index
        if os.path.exists(index_path):
            self.load_index()
        else:
            self.create_index()
    
    def create_index(self):
        """
        Create a new index for vector similarity search
        """
        logger.info(f"Creating new index with dimension {self.dimension}")
        if FAISS_AVAILABLE:
            # IndexFlatIP computes inner product, which equals cosine similarity for normalized vectors
            self.index = faiss.IndexFlatIP(self.dimension)
        else:
            # Simple numpy-based approach as fallback
            self.index = []  # Will store vectors directly
        
        # Load metadata if it exists, otherwise initialize empty dict
        if os.path.exists(self.metadata_path):
            with open(self.metadata_path, 'rb') as f:
                self.chunk_metadata = pickle.load(f)
        else:
            self.chunk_metadata = {}
    
    def load_index(self):
        """
        Load an existing index and metadata
        """
        logger.info(f"Loading existing index from {self.index_path}")
        if FAISS_AVAILABLE and os.path.exists(self.index_path):
            self.index = faiss.read_index(self.index_path)
        else:
            # Load from pickle file for fallback approach
            if os.path.exists(self.index_path.replace('.bin', '_fallback.pkl')):
                with open(self.index_path.replace('.bin', '_fallback.pkl'), 'rb') as f:
                    self.index = pickle.load(f)
            else:
                self.index = []
        
        # Load associated metadata
        if os.path.exists(self.metadata_path):
            with open(self.metadata_path, 'rb') as f:
                self.chunk_metadata = pickle.load(f)
        else:
            self.chunk_metadata = {}
        
        logger.info(f"Loaded index with {self.index.ntotal} vectors")
    
    def save_index(self):
        """
        Save the index and metadata to disk
        """
        logger.info(f"Saving index to {self.index_path}")
        if FAISS_AVAILABLE:
            faiss.write_index(self.index, self.index_path)
        else:
            # Save as pickle file for fallback approach
            fallback_path = self.index_path.replace('.bin', '_fallback.pkl')
            with open(fallback_path, 'wb') as f:
                pickle.dump(self.index, f)
        
        # Save metadata separately
        with open(self.metadata_path, 'wb') as f:
            pickle.dump(self.chunk_metadata, f)
        
        logger.info("Index and metadata saved successfully")
    
    def add_vectors(self, vectors: np.ndarray, chunk_metadatas: List[Dict[str, Any]]):
        """
        Add vectors and their corresponding metadata to the index
        """
        logger.info(f"Adding {len(vectors)} vectors to index")
        
        if FAISS_AVAILABLE:
            # Normalize vectors for cosine similarity
            faiss.normalize_L2(vectors)
            
            # Add vectors to index
            start_id = self.index.ntotal
            self.index.add(vectors)
        else:
            # Simple approach: store vectors and metadata together
            start_id = len(self.index)
            for i, (vector, metadata) in enumerate(zip(vectors, chunk_metadatas)):
                # Normalize vector for cosine similarity
                norm = np.linalg.norm(vector)
                if norm > 0:
                    normalized_vector = vector / norm
                else:
                    normalized_vector = vector
                
                entry = {
                    'vector': normalized_vector,
                    'metadata': metadata.copy(),
                    'id': start_id + i
                }
                
                # Add unique ID if not present
                if 'chunk_id' not in entry['metadata']:
                    entry['metadata']['chunk_id'] = f"chunk_{entry['id']}_{str(uuid.uuid4())[:8]}"
                
                self.index.append(entry)
        
        # Store metadata with index positions
        for i, metadata in enumerate(chunk_metadatas):
            idx = start_id + i
            # Add unique ID if not present
            if 'chunk_id' not in metadata:
                metadata['chunk_id'] = f"chunk_{idx}_{str(uuid.uuid4())[:8]}"
            self.chunk_metadata[idx] = metadata
        
        logger.info(f"Successfully added {len(vectors)} vectors. Total vectors: {self.index.ntotal}")
    
    def search(self, query_vector: np.ndarray, k: int = 5) -> Tuple[np.ndarray, np.ndarray, List[Dict[str, Any]]]:
        """
        Search for the k most similar vectors to the query
        Returns similarities, indices, and metadata for the top-k results
        """
        if FAISS_AVAILABLE:
            if self.index.ntotal == 0:
                logger.warning("Index is empty, returning empty results")
                return np.array([]), np.array([]), []
            
            # Normalize query vector
            faiss.normalize_L2(query_vector.reshape(1, -1))
            
            # Perform search
            similarities, indices = self.index.search(query_vector.reshape(1, -1), k)
        else:
            if len(self.index) == 0:
                logger.warning("Index is empty, returning empty results")
                return np.array([]), np.array([]), []
            
            # Normalize query vector
            query_norm = np.linalg.norm(query_vector)
            if query_norm > 0:
                normalized_query = query_vector / query_norm
            else:
                normalized_query = query_vector
            
            # Calculate cosine similarities
            similarities_list = []
            for entry in self.index:
                # Cosine similarity = dot product of normalized vectors
                similarity = np.dot(normalized_query, entry['vector'])
                similarities_list.append((similarity, entry['id'], entry['metadata']))
            
            # Sort by similarity (descending) and get top k
            similarities_list.sort(reverse=True)
            top_k = similarities_list[:k]
            
            # Extract results
            similarities = np.array([item[0] for item in top_k])
            indices = np.array([item[1] for item in top_k])
            result_metadata = [item[2] for item in top_k]
        
            return similarities, indices, result_metadata
        
        # FAISS-specific metadata retrieval
        result_metadata = []
        for idx in indices[0]:
            if idx != -1 and idx in self.chunk_metadata:  # Check if valid index
                result_metadata.append(self.chunk_metadata[idx])
            else:
                # Add placeholder if index not found
                result_metadata.append({"chunk_id": f"unknown_{idx}", "content": "Not found"})
        
        return similarities[0], indices[0], result_metadata
    
    def get_total_vectors(self) -> int:
        """
        Return the total number of vectors in the index
        """
        if FAISS_AVAILABLE:
            return self.index.ntotal
        else:
            return len(self.index)
    
    def reset_index(self):
        """
        Reset the index and clear all data
        """
        logger.info("Resetting index")
        self.create_index()
        self.save_index()

# Example usage
if __name__ == "__main__":
    # Create an index manager
    manager = FaissIndexManager(dimension=384)
    
    # Sample vectors and metadata
    sample_vectors = np.random.rand(3, 384).astype('float32')
    sample_metadata = [
        {"document_id": "doc1", "content": "Sample content 1", "source": "file1.pdf"},
        {"document_id": "doc2", "content": "Sample content 2", "source": "file2.pdf"},
        {"document_id": "doc3", "content": "Sample content 3", "source": "file3.pdf"}
    ]
    
    # Add vectors to index
    manager.add_vectors(sample_vectors, sample_metadata)
    
    # Search with a query vector
    query_vector = np.random.rand(384).astype('float32')
    similarities, indices, metadatas = manager.search(query_vector, k=2)
    
    print(f"Similarities: {similarities}")
    print(f"Indices: {indices}")
    print(f"Metadatas: {metadatas}")
    
    # Save the index
    manager.save_index()