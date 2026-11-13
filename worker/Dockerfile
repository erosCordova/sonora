# Worker con ACE-Step 1.5. Requiere NVIDIA Container Toolkit en el host (docker run --gpus all).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg libsndfile1 build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git
WORKDIR /opt/ACE-Step-1.5
RUN uv sync
RUN uv pip install requests psutil
COPY worker/ /opt/worker/
ENV ACESTEP_DIR=/opt/ACE-Step-1.5 PYTHONUNBUFFERED=1
VOLUME ["/opt/ACE-Step-1.5/checkpoints"]
WORKDIR /opt/worker
CMD ["uv", "run", "--project", "/opt/ACE-Step-1.5", "python", "/opt/worker/worker.py"]
