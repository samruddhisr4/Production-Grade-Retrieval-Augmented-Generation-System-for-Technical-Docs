"""Demo RAG Pipeline Functionality"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import asyncio
import tempfile
from pathlib import Path

async def demo_basic_rag():
    """Demonstrate basic RAG functionality"""
    print("=== RAG Pipeline Demo ===\n")
    
    # Create sample documents
    sample_docs = [
        ("ai_basics.txt", """
Artificial Intelligence Basics

Artificial Intelligence (AI) refers to systems or machines that mimic human intelligence to perform tasks and can iteratively improve themselves based on the information they collect.

Machine Learning is a subset of AI that enables computers to learn and adapt without being explicitly programmed. Deep Learning is a specialized form of Machine Learning that uses neural networks with multiple layers.

Natural Language Processing (NLP) allows computers to understand, interpret, and generate human language. This includes tasks like translation, sentiment analysis, and question answering.

Computer Vision enables machines to interpret and make decisions based on visual data from the world, similar to human vision.
        """),
        ("ml_fundamentals.txt", """
Machine Learning Fundamentals

Supervised Learning involves training algorithms on labeled datasets where the correct answers are provided. Common algorithms include Linear Regression, Decision Trees, and Support Vector Machines.

Unsupervised Learning works with unlabeled data to discover hidden patterns and structures. Clustering and dimensionality reduction are common unsupervised techniques.

Reinforcement Learning teaches agents to make sequences of decisions by rewarding desired behaviors and punishing undesired ones. This approach is used in game playing and robotics.

Neural Networks are computing systems inspired by biological neural networks. They consist of interconnected nodes that process information in layers.
        """)
    ]
    
    # Create temporary files
    temp_files = []
    try:
        for filename, content in sample_docs:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
                f.write(content.strip())
                temp_files.append((f.name, filename))
                print(f"Created sample document: {filename}")
        
        print("\n--- Indexing Documents ---")
        
        # Import RAG pipeline
        from app.core.rag_pipeline import rag_pipeline
        
        # Index documents
        for file_path, filename in temp_files:
            success = await rag_pipeline.index_document(file_path, doc_id=filename)
            if success:
                print(f"✓ Indexed {filename}")
            else:
                print(f"✗ Failed to index {filename}")
        
        print(f"\nTotal documents indexed: {rag_pipeline.get_document_count()}")
        
        # Test queries
        test_queries = [
            "What is Artificial Intelligence?",
            "Explain Machine Learning basics",
            "How does Natural Language Processing work?",
            "What are neural networks?"
        ]
        
        print("\n--- Testing Queries ---")
        for query in test_queries:
            print(f"\nQuestion: {query}")
            response = await rag_pipeline.query(query, k=3)
            
            print(f"Answer: {response.answer}")
            # Confidence metric removed - using similarity score ranges instead
            # print(f"Confidence: {response.confidence:.2f}")
            print(f"Sources found: {len(response.sources)}")
            
            if response.sources:
                print("Top source snippet:")
                print(f"  {response.sources[0]['content'][:100]}...")
        
        print("\n=== Demo Complete ===")
        
    finally:
        # Clean up temporary files
        for file_path, _ in temp_files:
            try:
                os.unlink(file_path)
            except:
                pass

async def demo_vector_store():
    """Demonstrate vector store functionality"""
    print("\n=== Vector Store Demo ===\n")
    
    from app.core.vector_store import SimpleVectorStore, VectorDocument
    
    # Create vector store
    store = SimpleVectorStore()
    
    # Add sample documents with embeddings
    sample_docs = [
        VectorDocument(
            id="tech_doc_1",
            content="Python is a high-level programming language known for its simplicity and readability.",
            embedding=[0.1, 0.8, 0.3, 0.6],
            metadata={"category": "programming", "language": "python"}
        ),
        VectorDocument(
            id="tech_doc_2",
            content="JavaScript is a versatile programming language primarily used for web development.",
            embedding=[0.2, 0.7, 0.4, 0.5],
            metadata={"category": "programming", "language": "javascript"}
        ),
        VectorDocument(
            id="ai_doc_1",
            content="Machine learning algorithms can automatically improve through experience.",
            embedding=[0.8, 0.2, 0.7, 0.3],
            metadata={"category": "artificial-intelligence", "topic": "ml"}
        )
    ]
    
    store.add_documents(sample_docs)
    print(f"Indexed {len(sample_docs)} documents")
    
    # Test similarity search
    query_embedding = [0.15, 0.75, 0.35, 0.55]  # Similar to Python document
    results = store.similarity_search(query_embedding, k=2)
    
    print(f"\nQuery embedding: {query_embedding}")
    print("Most similar documents:")
    for i, doc in enumerate(results, 1):
        print(f"{i}. {doc.id}: {doc.content[:50]}...")
        print(f"   Metadata: {doc.metadata}")

def main():
    """Run all demos"""
    print("RAG Pipeline Demonstration\n")
    
    # Run vector store demo
    demo_vector_store()
    
    # Run RAG demo
    asyncio.run(demo_basic_rag())

if __name__ == "__main__":
    main()