# RAG System Deployment Guide

## Frontend Deployment (Vercel)

### Prerequisites

- Vercel account
- GitHub repository with your frontend code

### Steps:

1. Push your frontend code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "New Project"
4. Import your GitHub repository
5. Configure project settings:
   - Framework Preset: Create React App
   - Build Command: `npm run build`
   - Output Directory: `build`
6. Add environment variables:
   - `REACT_APP_API_URL` = Your Render backend URL (e.g., https://your-app-name.onrender.com)
7. Deploy!

## Backend Deployment (Render)

### Prerequisites

- Render account
- GitHub repository with your backend code

### Steps:

1. Push your backend code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click "New+" → "Web Service"
4. Connect your GitHub repository
5. Configure service settings:
   - Name: rag-api
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: Free or paid (based on your needs)
6. Add environment variables from `.env.render.template`:
   - `OPENAI_API_KEY` = Your OpenAI API key
   - `RETRIEVAL_SERVICE_URL` = Your Python service URL (if separate deployment)
   - Other variables as needed
7. Deploy!

## Python Retrieval Service Deployment (Optional)

If you want to deploy the Python retrieval service separately:

### Render Deployment:

1. Create a new Web Service on Render
2. Runtime: Python
3. Build Command: `pip install -r requirements.txt`
4. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables for your LLM keys

### Alternative (Heroku/Other):

Deploy the Python service to your preferred platform with similar configuration.

## Post-Deployment Setup

1. Update your frontend's `REACT_APP_API_URL` with the actual Render backend URL
2. Test the connection between frontend and backend
3. Verify document upload and query functionality
4. Monitor logs for any issues

## Important Notes

- Make sure CORS is properly configured in your backend
- The retrieval service URL should be publicly accessible
- Consider rate limiting for production use
- Monitor your API usage and costs
