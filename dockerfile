FROM node:18-alpine

WORKDIR /app

# Install dependencies securely
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose port (Koyeb handles the routing)
EXPOSE 7860

CMD ["npm", "start"]
