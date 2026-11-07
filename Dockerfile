# Stage 1: React (Vite + TypeScript) 프론트엔드 빌드
FROM node:22-alpine AS frontend-build
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY frontend ./frontend
RUN npm run build

# Stage 2: Kotlin (Ktor) 백엔드 빌드
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace

COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew

COPY src ./src
RUN ./gradlew installDist --no-daemon

# Stage 3: 경량 JRE 런타임 + 정적 자산 통합
FROM eclipse-temurin:21-jre-alpine

ENV PORT=3000 \
    HOST=0.0.0.0 \
    PUBLIC_DIR=/app/public
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /workspace/build/install/ulevelp-server/lib ./lib
COPY public ./public
COPY --from=frontend-build /workspace/dist/assets ./public/assets
COPY --from=frontend-build /workspace/dist/index.html ./public/spa.html

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["java", "-XX:MaxRAMPercentage=75.0", "-cp", "/app/lib/*", "ulevelp.MainKt"]
