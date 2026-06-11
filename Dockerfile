FROM node:18-slim

# Pasang dependensi sistem dasar: Python3, Pip, ca-certificates, FFmpeg, dan Curl
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python-is-python3 \
    ca-certificates \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Pasang pustaka HTTP modern & TLS fingerprinting bypass untuk yt-dlp
RUN pip3 install --no-cache-dir requests brotli certifi

# Unduh biner yt-dlp versi terbaru dan atur izin eksekusinya
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install

COPY index.js ./

# Port default yang dibuka oleh infrastruktur Hugging Face Spaces
EXPOSE 7860
ENV PORT=7860

CMD ["node", "index.js"]