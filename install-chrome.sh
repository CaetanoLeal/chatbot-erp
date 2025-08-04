#!/bin/bash

set -e

# Atualiza os pacotes e instala o wget
apt-get update && apt-get install -y wget

# Baixa o pacote .deb do Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb

# Instala o pacote .deb
dpkg -i google-chrome-stable_current_amd64.deb || true

# Corrige dependências quebradas, se houver
apt-get install -f -y

# Remove o instalador .deb para economizar espaço
rm google-chrome-stable_current_amd64.deb

# Limpa o cache do apt
apt-get clean
rm -rf /var/lib/apt/lists/*

