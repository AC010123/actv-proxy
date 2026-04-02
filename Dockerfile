# Use the official Microsoft Playwright image which has ALL libraries pre-installed
FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Set working directory
WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy the rest of your code
COPY . .

# Railway uses the PORT environment variable
EXPOSE 8080

# Start the server
CMD ["node", "index.js"]
