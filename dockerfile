FROM node:22

# Define ambiente não interativo (evita prompts durante build)
ENV DEBIAN_FRONTEND=noninteractive

# Instala o Chromium e dependências do Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Define a variável de ambiente para o caminho do Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Cria diretório da aplicação
WORKDIR /usr/src/app

# Copia os arquivos de configuração e dependências
COPY package*.json ./

# Instala as dependências (sem baixar o Chromium via Puppeteer)
RUN npm install --production
RUN npm install uuid
# Copia o restante do código
COPY . .

# Expõe a porta da aplicação (altere se for diferente)
EXPOSE 3000

# Comando padrão de execução
CMD ["node", "chatbot.js"]
