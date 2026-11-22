# Image de production Sentinel. Construite et testée avec `docker compose up -d --build`.
# BASE est surchargeable pour les tests derrière un proxy ; en production : python:3.12-slim.
ARG BASE=python:3.12-slim
FROM ${BASE}

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

RUN pip install --no-cache-dir uv==0.11.32

WORKDIR /app
# 1) dépendances seules (couche mise en cache tant que uv.lock ne change pas)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 2) code, configuration par défaut et statistiques de backtest citées dans les alertes
COPY src ./src
COPY config ./config
COPY reports/stats ./reports/stats
RUN uv sync --frozen --no-dev

# Utilisateur non root ; data/ (journal, cache, graphiques) est un volume persistant.
RUN useradd --create-home --uid 1000 sentinel && mkdir -p /app/data && chown -R sentinel /app/data
USER sentinel

HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
    CMD ["/app/.venv/bin/python", "-m", "sentinel.health"]

ENTRYPOINT ["/app/.venv/bin/python", "-m", "sentinel"]
CMD ["--config", "config/config.yaml"]
