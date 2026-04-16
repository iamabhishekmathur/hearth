FROM mcr.microsoft.com/playwright:v1.48.0-noble

RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox
