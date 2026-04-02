# Use 'latest' to ensure we get the most recent compatible browser environment
FROM mcr.microsoft.com/playwright:latest

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
