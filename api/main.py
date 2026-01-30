"""FastAPI Application for RAG Pipeline"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import tempfile
import os
import uuid

from app.core.rag_pipeline import rag_pipeline

app = FastAPI(title="RAG Pipeline API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    question: str
    k: int = 5

class QueryResponse(BaseModel):
    answer: str
    # confidence: float removed - using similarity score ranges instead
    sources: List[dict]

class IndexResponse(BaseModel):
    success: bool
    message: str
    doc_id: str

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "RAG Pipeline API is running",
        "document_count": rag_pipeline.get_document_count()
    }

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    """Query the RAG pipeline"""
    try:
        response = await rag_pipeline.query(request.question, k=request.k)
        return QueryResponse(
            answer=response.answer,
            # confidence=response.confidence removed
            sources=response.sources
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/index", response_model=IndexResponse)
async def index_document(file: UploadFile = File(...)):
    """Index a document"""
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_file_path = tmp_file.name
        
        # Generate document ID
        doc_id = f"{uuid.uuid4()}_{file.filename}"
        
        # Index document
        success = await rag_pipeline.index_document(tmp_file_path, doc_id=doc_id)
        
        # Clean up temporary file
        os.unlink(tmp_file_path)
        
        if success:
            return IndexResponse(
                success=True,
                message=f"Successfully indexed {file.filename}",
                doc_id=doc_id
            )
        else:
            raise HTTPException(status_code=400, detail="Failed to index document")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/documents/count")
async def get_document_count():
    """Get number of indexed documents"""
    return {"count": rag_pipeline.get_document_count()}

@app.delete("/documents/clear")
async def clear_documents():
    """Clear all indexed documents"""
    try:
        rag_pipeline.clear_index()
        return {"message": "All documents cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)