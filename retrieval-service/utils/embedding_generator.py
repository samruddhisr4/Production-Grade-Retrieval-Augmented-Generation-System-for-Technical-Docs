import numpy as np
import logging
from typing import List

# Try to import sentence_transformers, fall back to simple hashing if not available
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logging.warning("sentence-transformers not available, using simple hash-based embeddings")

logger = logging.getLogger(__name__)

class EmbeddingGenerator:
    """
    Generates embeddings for text using pre-trained sentence transformer models
    """
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the embedding generator
        """
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            logger.info(f"Loading sentence transformer model: {model_name}")
            self.model = SentenceTransformer(model_name)
            self.embedding_dim = 384  # Dimension of all-MiniLM-L6-v2 embeddings
        else:
            logger.info("Using simple hash-based embeddings (fallback mode)")
            self.embedding_dim = 128  # Smaller dimension for hash-based approach
        
    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate a single embedding for the given text
        """
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            embedding = self.model.encode([text])[0]  # Get first (and only) embedding
            return embedding.tolist()
        else:
            # Simple hash-based embedding as fallback
            return self._hash_embedding(text)
    
    def generate_embeddings(self, texts: List[str]) -> np.ndarray:
        """
        Generate embeddings for a list of texts
        Returns a numpy array of shape (num_texts, embedding_dim)
        """
        logger.info(f"Generating embeddings for {len(texts)} texts")
        
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            embeddings = self.model.encode(texts)
            return embeddings.astype('float32')  # FAISS works with float32
        else:
            # Generate hash-based embeddings for all texts
            embeddings = []
            for text in texts:
                embedding = self._hash_embedding(text)
                embeddings.append(embedding)
            return np.array(embeddings, dtype='float32')
    
    def get_embedding_dimension(self) -> int:
        """
        Return the dimension of the embeddings
        """
        return self.embedding_dim
    
    def _hash_embedding(self, text: str) -> List[float]:
        """
        Generate a simple hash-based embedding as fallback
        This is not as good as transformer embeddings but works without external dependencies
        """
        # Simple character-based hash
        hash_values = []
        text_lower = text.lower().encode('utf-8')
        
        # Generate multiple hash values for better distribution
        for i in range(self.embedding_dim):
            # Mix characters with position and simple math
            hash_val = 0
            for j, char in enumerate(text_lower):
                hash_val = (hash_val * 31 + char + i * j) % 1000000
            # Normalize to [-1, 1] range
            normalized = (hash_val % 2000000) / 1000000.0 - 1.0
            hash_values.append(normalized)
        
        return hash_values

# Example usage
if __name__ == "__main__":
    generator = EmbeddingGenerator()
    
    # Test single embedding
    text = "This is a sample sentence for embedding"
    embedding = generator.generate_embedding(text)
    print(f"Single embedding shape: {len(embedding)}")
    print(f"Sample values: {embedding[:5]}...")
    
    # Test batch embedding
    texts = [
        "First sentence",
        "Second sentence", 
        "Third sentence"
    ]
    embeddings = generator.generate_embeddings(texts)
    print(f"Batch embeddings shape: {embeddings.shape}")