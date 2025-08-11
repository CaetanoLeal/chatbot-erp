FROM node:18

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libgtk-3-0 \
    libxshmfence1 \
    xdg-utils \
    --no-install-recommends

# Copia o script de instalação do Chrome
COPY install-chrome.sh .

# Dá permissão de execução e executa o script
RUN chmod +x ./install-chrome.sh && ./install-chrome.sh

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome"

CMD ["node", "chatbot.js"]