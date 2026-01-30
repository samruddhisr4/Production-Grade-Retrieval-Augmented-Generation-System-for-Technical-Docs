import re
from typing import List, Dict, Any, Optional
import logging
import uuid
from datetime import datetime
import tempfile
import os

logger = logging.getLogger(__name__)

class DocumentProcessor:
    """
    Handles document processing tasks like chunking and cleaning
    Enhanced with detailed metadata for better tracking
    Supports multiple file formats: txt, pdf, docx, md
    """
    
    def __init__(self, chunk_size: int = 512, overlap: int = 50):
        self.chunk_size = chunk_size
        self.overlap = overlap
        
    def extract_text_from_file(self, file_content: bytes, file_type: str) -> str:
        """
        Extract text content from different file types
        """
        if file_type.lower() in ['.txt', '.md', '.markdown']:
            # For text files, decode the bytes directly
            try:
                return file_content.decode('utf-8')
            except UnicodeDecodeError:
                # Fallback to latin-1 if utf-8 fails
                return file_content.decode('latin-1')
        elif file_type.lower() == '.pdf':
            # Check if PyPDF2 is available
            try:
                import PyPDF2  # type: ignore
            except ImportError:
                raise Exception("PyPDF2 library not available for PDF processing")
            
            # Extract text from PDF
            temp_pdf_path = None
            try:
                # Create a temporary file with a proper name
                with tempfile.NamedTemporaryFile(mode='wb', delete=False, suffix='.pdf') as temp_pdf:
                    temp_pdf.write(file_content)
                    temp_pdf_path = temp_pdf.name
                
                text = ""
                with open(temp_pdf_path, 'rb') as pdf_file:
                    pdf_reader = PyPDF2.PdfReader(pdf_file)
                    for page in pdf_reader.pages:
                        text += page.extract_text() + "\n"
                
                # Clean up temp file
                if temp_pdf_path and os.path.exists(temp_pdf_path):
                    os.unlink(temp_pdf_path)
                    
                return text
            except Exception as e:
                # Clean up temp file in case of error
                if temp_pdf_path and os.path.exists(temp_pdf_path):
                    os.unlink(temp_pdf_path)
                raise e
        elif file_type.lower() in ['.docx', '.doc']:
            # Check if python-docx is available
            try:
                from docx import Document  # type: ignore
            except ImportError:
                raise Exception("python-docx library not available for Word processing")
            
            # Extract text from Word document
            temp_docx_path = None
            try:
                with tempfile.NamedTemporaryFile(mode='wb', delete=False, suffix='.docx') as temp_docx:
                    temp_docx.write(file_content)
                    temp_docx_path = temp_docx.name
                
                doc = Document(temp_docx_path)
                text = '\n'.join([paragraph.text for paragraph in doc.paragraphs])
                
                # Clean up temp file
                if temp_docx_path and os.path.exists(temp_docx_path):
                    os.unlink(temp_docx_path)
                    
                return text
            except Exception as e:
                # Clean up temp file in case of error
                if temp_docx_path and os.path.exists(temp_docx_path):
                    os.unlink(temp_docx_path)
                raise e
        else:
            # Unsupported format
            raise Exception(f"Unsupported file type: {file_type}")
    
    def process_document(self, content: str, document_id: str, document_name: Optional[str] = None, file_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Process a document by chunking it and adding metadata
        This is the main method called by the ingestion endpoint
        """
        # Chunk the text
        raw_chunks = self.chunk_text(content)
        
        # Add document metadata to each chunk
        processed_chunks = []
        for i, chunk in enumerate(raw_chunks):
            # Calculate offset/position in document
            offset_start = self._calculate_offset(content, chunk['content'], i, raw_chunks)
            
            processed_chunk = {
                'chunk_id': f"{document_id}_{uuid.uuid4().hex[:8]}",
                'content': chunk['content'],
                'metadata': {
                    'document_id': document_id,
                    'document_name': document_name or document_id,
                    'chunk_index': i,
                    'chunk_length': chunk['length'],
                    'total_chunks': len(raw_chunks),
                    'offset_start': offset_start,
                    'offset_end': offset_start + chunk['length'],
                    'section': self._identify_section(chunk['content'], i, raw_chunks),
                    'chunk_id': f"chunk_{i}",
                    'file_type': file_type or 'unknown',
                    'processing_timestamp': datetime.utcnow().isoformat()
                }
            }
            processed_chunks.append(processed_chunk)
            
        logger.info(f"Processed document {document_name or document_id} ({file_type}) into {len(processed_chunks)} chunks with enhanced metadata")
        return processed_chunks
    
    def _calculate_offset(self, full_text: str, chunk_content: str, chunk_index: int, all_chunks: List[Dict]) -> int:
        """
        Calculate the character offset of this chunk in the original document
        """
        # Simple approach: calculate based on previous chunks
        offset = 0
        for i in range(chunk_index):
            offset += all_chunks[i]['length'] + 1  # +1 for space between chunks
        return offset
    
    def _identify_section(self, chunk_content: str, chunk_index: int, all_chunks: List[Dict]) -> str:
        """
        Identify the section of the document this chunk belongs to
        """
        # Look for section headers or structural patterns
        content_lower = chunk_content.lower()
        
        # Check for common section indicators
        if any(keyword in content_lower for keyword in ['introduction', 'abstract', 'summary']):
            return 'Introduction'
        elif any(keyword in content_lower for keyword in ['method', 'approach', 'methodology']):
            return 'Methodology'
        elif any(keyword in content_lower for keyword in ['result', 'finding', 'outcome']):
            return 'Results'
        elif any(keyword in content_lower for keyword in ['conclusion', 'discussion', 'future']):
            return 'Conclusion'
        elif any(keyword in content_lower for keyword in ['reference', 'bibliography', 'citation']):
            return 'References'
        elif chunk_index == 0:
            return 'Opening'
        elif chunk_index == len(all_chunks) - 1:
            return 'Closing'
        else:
            return f'Section_{chunk_index + 1}'
    
    def chunk_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Split text into overlapping chunks of specified size
        """
        # Clean the text by removing extra whitespaces
        text = re.sub(r'\s+', ' ', text)
        
        # Split text into sentences
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        chunks = []
        current_chunk = ""
        chunk_id = 0
        
        for sentence in sentences:
            # If adding the sentence would exceed chunk size
            if len(current_chunk) + len(sentence) > self.chunk_size:
                if current_chunk:
                    # Save current chunk
                    chunks.append({
                        "chunk_id": f"chunk_{chunk_id}",
                        "content": current_chunk.strip(),
                        "length": len(current_chunk)
                    })
                    
                    # Start new chunk with overlap
                    if self.overlap > 0:
                        # Get the last few sentences from current chunk for overlap
                        overlap_sentences = self._get_overlap_sentences(current_chunk, self.overlap)
                        current_chunk = overlap_sentences + " " + sentence
                    else:
                        current_chunk = sentence
                    chunk_id += 1
                else:
                    # If single sentence is longer than chunk_size, split it
                    if len(sentence) > self.chunk_size:
                        sub_chunks = self._split_long_sentence(sentence)
                        for sub_chunk in sub_chunks:
                            chunks.append({
                                "chunk_id": f"chunk_{chunk_id}",
                                "content": sub_chunk.strip(),
                                "length": len(sub_chunk)
                            })
                            chunk_id += 1
                    else:
                        current_chunk = sentence
            else:
                current_chunk += " " + sentence
                
        # Add the final chunk if it has content
        if current_chunk.strip():
            chunks.append({
                "chunk_id": f"chunk_{chunk_id}",
                "content": current_chunk.strip(),
                "length": len(current_chunk)
            })
            
        logger.info(f"Document chunked into {len(chunks)} pieces")
        return chunks
    
    def _get_overlap_sentences(self, text: str, overlap_size: int) -> str:
        """
        Extract sentences from the end of text that approximately match overlap_size
        """
        sentences = re.split(r'[.!?]+', text)
        overlap_text = ""
        
        for sentence in reversed(sentences):
            if len(overlap_text) + len(sentence) <= overlap_size:
                overlap_text = sentence + " " + overlap_text
            else:
                break
                
        return overlap_text.strip()
    
    def _split_long_sentence(self, sentence: str) -> List[str]:
        """
        Split a very long sentence into smaller chunks
        """
        if len(sentence) <= self.chunk_size:
            return [sentence]
            
        chunks = []
        words = sentence.split()
        current_chunk = ""
        
        for word in words:
            if len(current_chunk) + len(word) <= self.chunk_size:
                current_chunk += " " + word
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = word
                
        if current_chunk:
            chunks.append(current_chunk.strip())
            
        return chunks

# Example usage
if __name__ == "__main__":
    processor = DocumentProcessor(chunk_size=200, overlap=20)
    sample_text = "This is a sample document. It has multiple sentences. Some sentences might be quite long and need to be processed properly. We want to make sure that our chunking algorithm works correctly for various text lengths."
    chunks = processor.chunk_text(sample_text)
    for chunk in chunks:
        print(f"Chunk {chunk['chunk_id']}: {chunk['content'][:50]}...")
        print(f"Length: {chunk['length']}\n")