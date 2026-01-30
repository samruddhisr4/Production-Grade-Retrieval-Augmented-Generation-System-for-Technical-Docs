@echo off
echo Starting RAG System...

echo Starting Python Retrieval Service...
start cmd /k "cd retrieval-service && python main.py"

timeout /t 5

echo Starting Node.js API Gateway...
start cmd /k "cd api && npm run dev"

timeout /t 5

echo Starting React Frontend...
start cmd /k "cd api/frontend-react && npm start"

timeout /t 5

echo RAG System Started!
echo Visit http://localhost:3000 for API
echo Visit http://localhost:3001 for React Frontend
pause