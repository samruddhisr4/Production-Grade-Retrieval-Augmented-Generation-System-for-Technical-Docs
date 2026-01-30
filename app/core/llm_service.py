"""LLM Service Module"""

import asyncio
import os
import httpx
from typing import Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class LLMService:
    """Generate responses using LLM with API integration"""
    
    def __init__(self, model_name: str = "gpt-3.5-turbo"):
        self.model_name = model_name
        self.api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY")
        self.api_base = os.getenv("OPENAI_API_BASE") or os.getenv("LLM_API_BASE") or "https://api.openai.com/v1/chat/completions"
        self.provider = os.getenv("LLM_PROVIDER", "openai")  # openai, anthropic, azure, etc.
        
        if not self.api_key:
            print("Warning: No LLM API key found. Using mock responses.")
    
    async def generate_response(self, prompt: str) -> str:
        """Generate response for a given prompt using LLM API"""
        if not self.api_key:
            # Fallback to mock responses if no API key is configured
            return await self._mock_generate_response(prompt)
        
        try:
            if self.provider.lower() == "openai":
                return await self._call_openai_api(prompt)
            elif self.provider.lower() == "anthropic":
                return await self._call_anthropic_api(prompt)
            else:
                # Default to OpenAI-compatible API
                return await self._call_openai_api(prompt)
                
        except Exception as e:
            print(f"Error calling LLM API: {e}")
            # Fallback to mock response on error
            return await self._mock_generate_response(prompt)
    
    async def _call_openai_api(self, prompt: str) -> str:
        """Call OpenAI-compatible API"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant that answers questions based on provided context."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.7,
            "max_tokens": 500
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(self.api_base, json=payload, headers=headers)
            response.raise_for_status()
            
            result = response.json()
            return result["choices"][0]["message"]["content"]
    
    async def _call_anthropic_api(self, prompt: str) -> str:
        """Call Anthropic API"""
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }
        
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 500,
            "temperature": 0.7
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
            response.raise_for_status()
            
            result = response.json()
            return result["content"][0]["text"]
    
    async def _mock_generate_response(self, prompt: str) -> str:
        """Generate mock response when API key is not available"""
        import random
        
        responses = [
            f"Based on the provided context, this is a comprehensive answer to your question about: {prompt[:50]}...",
            f"The information suggests that the answer is quite straightforward: {prompt[:50]}",
            f"According to the context, here's what I can tell you about that topic: {prompt[:50]}",
            f"From the given information, I can provide the following insights: {prompt[:50]}",
            f"The context contains relevant information that leads to this conclusion: {prompt[:50]}"
        ]
        
        # Select response based on prompt hash for consistency
        seed = hash(prompt) % len(responses)
        response = responses[seed]
        
        return response