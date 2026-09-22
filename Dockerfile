FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Configure timezone to Asia/Kolkata
ENV TZ=Asia/Kolkata
ENV DEBIAN_FRONTEND=noninteractive
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY src ./src

CMD ["node", "src/index.js"]
