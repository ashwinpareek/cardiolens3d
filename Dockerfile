# ---- 1. build the web app
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. model server + static app
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ml/ ml/
COPY backend/ backend/
COPY config/ config/
COPY data/ data/
COPY frontend/public/data/ frontend/public/data/
COPY --from=web /app/frontend/dist frontend/dist
# Hugging Face Spaces runs containers as UID 1000; Render and others inject $PORT
RUN useradd -m -u 1000 user && chown -R user /app
USER user
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", 8000)}/api/health')"
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
