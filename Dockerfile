# Updated to match the required version from your logs
FROM mcr.microsoft.com/playwright:v1.59.1-focal

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
