# Use the verified 1.59.0 manifest
FROM mcr.microsoft.com/playwright:v1.59.0

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Railway uses the PORT env variable
EXPOSE 8080

CMD ["node", "index.js"]
