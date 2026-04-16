FROM python:3.12-slim

RUN useradd -m -s /bin/bash sandbox
RUN pip install --no-cache-dir \
    pandas numpy matplotlib seaborn plotly scipy scikit-learn openpyxl requests

USER sandbox
WORKDIR /home/sandbox
