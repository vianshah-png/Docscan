# Use official Node.js image
FROM node:20-slim

# Create and define the working directory
WORKDIR /usr/src/app

# Copy dependency files
COPY package*.json ./

# Install dependencies including dev (needed for vite build)
RUN npm install

# Copy project files
COPY . .

# Build the Vite frontend
RUN npm run build

# Expose the port Cloud Run provides
ENV PORT=8080
EXPOSE 8080

# Start the unified Express server
CMD ["node", "server.js"]
