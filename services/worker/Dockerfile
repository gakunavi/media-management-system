# MMS worker（Python 常駐）
# 設計書 §6: 既存 .claude/scripts/ は書き直さず legacy/ に置いてそのまま呼ぶ
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY services/worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/worker/worker.py ./worker.py
COPY services/worker/legacy/ ./legacy/

# root で動かさない
RUN useradd --create-home --uid 1001 worker && chown -R worker:worker /app
USER worker

CMD ["python", "worker.py"]
