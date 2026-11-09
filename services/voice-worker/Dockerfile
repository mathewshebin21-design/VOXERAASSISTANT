# syntax=docker/dockerfile:1.7
# Isolated staging voice-worker only. Does not enable SIP or make paid calls.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN pip install --no-cache-dir uv==0.11.32 \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin voxera
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra livekit --no-install-project
COPY voxera_worker ./voxera_worker
RUN uv sync --frozen --no-dev --extra livekit
USER voxera
# Runtime guard refuses production API, missing credentials and enabled SIP.
# No secrets are copied into the image; operator supplies runtime variables.
CMD ["/srv/.venv/bin/python", "-m", "voxera_worker.launch_staging", "start"]
