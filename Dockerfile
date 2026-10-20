FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# 외부 패키지가 없어서 npm install 단계가 없습니다
COPY package.json server.js ./
COPY public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
