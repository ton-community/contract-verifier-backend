FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl unzip jq

COPY script/download-ton-binaries.sh ./
RUN ./download-ton-binaries.sh

COPY package*.json ./
RUN npm ci --ignore-scripts && \
    npm cache clean --force

COPY . .

EXPOSE ${PORT:-3003}

CMD ["npm", "start"]