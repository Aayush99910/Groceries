# The API, for Render (or any container host).
#
# Python only, no Node: the frontend is built and served by Netlify, so this
# image never needs to run `vite build`. If you ever go back to serving the
# frontend from here, this becomes a two-stage build with a node image first.
#
# Pinned to 3.13 rather than the 3.14 used in development, because every
# dependency here has prebuilt 3.13 wheels for linux/arm64 and linux/amd64.
# On 3.14 some of them (uvloop in particular) can fall back to compiling from
# source, which turns a 40-second build into several minutes or a failure.
FROM python:3.13-slim

# Don't buffer stdout, or logs arrive in unhelpful bursts on the host's log view.
# Don't write .pyc files into the image.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Requirements first, as their own layer: application code changes on every
# push, dependencies rarely do, so this layer stays cached and rebuilds are fast.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Run as a non-root user. Nothing here needs root, and a container process that
# can't write to its own filesystem is one less thing to worry about.
RUN useradd --create-home --uid 10001 appuser
USER appuser

# Render (and Fly, and Cloud Run) inject the port to listen on. Defaulting to
# 8000 keeps `docker run -p 8000:8000 groceries` working locally.
ENV PORT=8000
EXPOSE 8000

# Shell form on purpose, so ${PORT} is expanded at runtime rather than baked in.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
