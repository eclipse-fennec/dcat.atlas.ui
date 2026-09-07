# Der DCAT-Viewer: die gebaute Vue-App hinter nginx, mit einem Proxy auf das
# Portal.
#
# Aus dem Repository-Wurzelverzeichnis bauen:
#     docker build -f deploy/Dockerfile -t dcat-atlas-ui .

FROM node:22-alpine AS build

WORKDIR /src

# Erst die Manifeste, dann der Rest: so bleibt die Installationsschicht im
# Cache, solange sich die Abhängigkeiten nicht ändern.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_DCAT_API wird hier *nicht* gesetzt. Der Client fällt damit auf seinen
# Default `/dcat/rest` zurück, den nginx zur Laufzeit an das Portal
# weiterreicht — dieses Image passt deshalb zu jedem Portal, statt eines pro
# Portal zu brauchen. Siehe deploy/nginx.conf.template.
RUN npm run build


FROM nginx:alpine

# Lässt das Entrypoint-Skript 15-local-resolvers.envsh die Nameserver aus der
# /etc/resolv.conf des Containers exportieren, die das Template als `resolver`
# nutzt. Ohne das bleibt ${NGINX_LOCAL_RESOLVERS} leer und nginx startet nicht.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

# Jede Variable, die das Template ersetzt, braucht hier einen Wert: envsubst
# lässt eine *nicht gesetzte* als literales ${NAME} stehen, was nginx als
# unbekannte Direktive ablehnt.
#
# Der Default zeigt auf ein Portal auf dem Docker-Host. Bei einem einfachen
# `docker run` braucht dieser Name `--add-host host.docker.internal:host-gateway`;
# im Compose steht der Eintrag unter extra_hosts. nginx startet auch ohne
# erreichbares Portal — der Proxy löst pro Anfrage auf und antwortet bis dahin
# mit 502.
#
# DCAT_ATLAS_URL ist die Basis, unter der /rest und /health des Portals liegen,
# mit abschließendem Schrägstrich. Für das Portal-Image (CONTEXT_PATH=/) ist das
# die blanke Wurzel; ein bndrun-Lauf mit Kontextpfad /dcat braucht ihn hier mit.
ENV DCAT_ATLAS_URL=http://host.docker.internal:8080/
ENV DCAT_ATLAS_HOST=host.docker.internal:8080
# Der Docker-Linter warnt hier (SecretsUsedInArgOrEnv) wegen des Namens. Es ist
# ein leerer Platzhalter, kein Geheimnis: envsubst braucht die Variable in der
# Umgebung, sonst bleibt ${DCAT_ATLAS_AUTH} literal im Template stehen. Einen
# echten Wert zur Laufzeit übergeben, nicht hier einbacken.
ENV DCAT_ATLAS_AUTH=""

COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 80

# Prüft nur, dass die App ausgeliefert wird. Das Portal ist ausdrücklich nicht
# Teil davon: ein Viewer, der seine Oberfläche zeigt und dahinter meldet, dass
# das Portal fehlt, ist gesund — er ist genau dafür gebaut.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
