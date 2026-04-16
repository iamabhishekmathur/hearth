FROM node:22-alpine

RUN adduser -D sandbox
USER sandbox
WORKDIR /home/sandbox
