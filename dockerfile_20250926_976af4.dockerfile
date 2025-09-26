FROM apify/actor-node-puppeteer:16

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm --quiet set progress=false \
    && npm install --only=prod --no-optional

# Copy source code
COPY . ./

# Set environment variables for Apify
ENV HUGGINGFACE_TOKEN=${HUGGINGFACE_TOKEN}

# Compile (if needed)
RUN npm run build || true

# Run the actor
CMD ["npm", "start"]