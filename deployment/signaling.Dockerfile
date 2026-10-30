FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY signaling ./signaling
ENV PORT=9000
EXPOSE 9000
USER node
CMD ["node", "signaling/server.cjs"]
