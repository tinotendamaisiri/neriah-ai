FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for Pillow and PDF processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY shared/ shared/
COPY functions/batch_grading.py functions/batch_grading.py
COPY functions/push.py functions/push.py
COPY functions/__init__.py functions/__init__.py

# Environment variables (injected at job execution time)
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "functions.batch_grading"]
