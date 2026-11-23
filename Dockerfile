FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS server
COPY src ./src
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production
USER node
CMD ["node", "src/signaling/index.js"]

FROM dependencies AS build
COPY . .
ARG VITE_SIGNAL_URL
ARG VITE_RELAY_URL
ENV VITE_SIGNAL_URL=$VITE_SIGNAL_URL VITE_RELAY_URL=$VITE_RELAY_URL VITE_SIGNAL_PATH=/signal/socket.io VITE_RELAY_PATH=/relay/socket.io
RUN npm run build

FROM nginx:alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
