"""Document Processing Module"""

import asyncio
from typing import List
from dataclasses import dataclass

@dataclass
class DocumentChunk:
    """Represents a chunk of a document"""
    text: str
    page_number: int = 1
    section_title: str = ""

class DocumentProcessor:
    """Process documents into chunks"""
    
    def __init__(self, chunk_size: int = 1000, overlap: int = 100):
        self.chunk_size = chunk_size
        self.overlap = overlap
    
    async def process_document(self, file_path: str) -> List[DocumentChunk]:
        """Process a document file into chunks"""
        try:
            # Read file content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Simple chunking strategy
            chunks = []
            for i in range(0, len(content), self.chunk_size - self.overlap):
                chunk_text = content[i:i + self.chunk_size]
                if chunk_text.strip():  # Only add non-empty chunks
                    chunk = DocumentChunk(
                        text=chunk_text,
                        page_number=1 + (i // self.chunk_size),
                        section_title=f"Section {(i // self.chunk_size) + 1}"
                    )
                    chunks.append(chunk)
            
            return chunks
            
        except Exception as e:
            print(f"Error processing document {file_path}: {e}")
            return []