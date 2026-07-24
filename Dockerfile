# Base image Node.js LTS
FROM node:18-bullseye-slim

# Install Python3, Pip, and FFmpeg (required for yt-dlp & spotdl audio/video merging)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy python requirements and install Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy remaining source code
COPY . .

# Expose port
EXPOSE 8080

# Environment variables
ENV PORT=8080

# Start server
CMD ["npm", "start"]
