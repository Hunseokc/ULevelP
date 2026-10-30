FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace

COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle ./gradle
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew

COPY src ./src
RUN ./gradlew installDist --no-daemon

FROM eclipse-temurin:21-jre-alpine

ENV PORT=3000 \
    HOST=0.0.0.0 \
    PUBLIC_DIR=/app/public
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /workspace/build/install/ulevelp-server/lib ./lib
COPY public ./public

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["java", "-XX:MaxRAMPercentage=75.0", "-cp", "/app/lib/*", "ulevelp.MainKt"]
