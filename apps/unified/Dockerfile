# web: the unified app served by nginx (PLT-7). Build context is apps/unified.
#   docker build --build-arg API_URL=https://<api-fqdn> -t matchcast-web apps/unified
FROM python:3.12-slim AS build
ARG API_URL=""
WORKDIR /app
COPY . .
RUN if [ -n "$API_URL" ]; then python build.py --api "$API_URL"; else python build.py; fi

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/index.html /app/config.js /app/contracts.js /app/agents.js /app/live.js /usr/share/nginx/html/
COPY --from=build /app/watch /usr/share/nginx/html/watch
COPY --from=build /app/broadcast /usr/share/nginx/html/broadcast
COPY --from=build /app/analyst /usr/share/nginx/html/analyst
COPY --from=build /app/shared /usr/share/nginx/html/shared
EXPOSE 8080
