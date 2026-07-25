# Base image Node.js LTS
FROM node:18-bullseye-slim

# Install Python3, Pip, python-is-python3, FFmpeg, build tools, and networking tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    python-is-python3 \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Python & PATH
ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}"
ENV PYTHONUNBUFFERED=1
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# Set working directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy python requirements and install/upgrade Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --upgrade -r requirements.txt

# Copy remaining source code
COPY . .

# Expose default ports
EXPOSE 8080 10000

# Start server
CMD ["npm", "start"]
