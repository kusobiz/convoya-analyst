# Deployment Guide — analyst.convoya.ai

Hetzner CX22 · Ubuntu 22.04 · Node.js 20 · PM2 · Nginx · Let's Encrypt

---

## 1. Server prerequisites (run once)

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx

# Certbot
sudo apt-get install -y certbot python3-certbot-nginx
```

---

## 2. Upload the project

```bash
# From your local machine
rsync -av --exclude node_modules --exclude .env \
  /path/to/analyst/ root@<SERVER_IP>:/root/analyst/
```

---

## 3. Create .env on the server

```bash
cd /root/analyst
cp .env.example .env
nano .env   # fill in real values
```

`.env` must contain:
```
SESSION_SECRET=<long random string — run: openssl rand -hex 32>
MANAGER_PASSWORD=<shared password for all managers>
CLAUDE_API_KEY=sk-ant-<your Anthropic key>
PORT=3000
```

---

## 4. Install dependencies

```bash
cd /root/analyst
npm install --omit=dev
```

---

## 5. Place the Excel data file

```bash
# Copy your stock file to the fixed location
cp /path/to/your/file.xlsx /root/analyst/data/stock_data.xlsx
```

---

## 6. Start with PM2

```bash
cd /root/analyst
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

Useful PM2 commands:
```bash
pm2 status            # check process state
pm2 logs analyst      # tail logs
pm2 restart analyst   # restart after config changes
pm2 stop analyst      # stop
```

---

## 7. Nginx — install config

```bash
sudo cp /root/analyst/nginx.conf /etc/nginx/sites-available/analyst.convoya.ai
sudo ln -s /etc/nginx/sites-available/analyst.convoya.ai \
           /etc/nginx/sites-enabled/analyst.convoya.ai

# Remove default site if present
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t          # must say "syntax is ok"
sudo systemctl reload nginx
```

---

## 8. SSL — Certbot (Let's Encrypt)

DNS for `analyst.convoya.ai` must point to the server IP before running this.

```bash
sudo certbot --nginx -d analyst.convoya.ai
```

Certbot will:
- Obtain a certificate from Let's Encrypt
- Automatically patch the Nginx config with SSL paths
- Set up auto-renewal via a systemd timer

Verify auto-renewal works:
```bash
sudo certbot renew --dry-run
```

---

## 9. Monthly data refresh

When a new `stock_data.xlsx` is ready each month:

```bash
# Replace the file
cp /path/to/new_file.xlsx /root/analyst/data/stock_data.xlsx

# Trigger cache refresh (requires being logged in as a manager)
curl -s -b cookies.txt https://analyst.convoya.ai/api/refresh
# — or just restart the process:
pm2 restart analyst
```

---

## 10. Firewall (UFW)

```bash
sudo ufw allow 22      # SSH
sudo ufw allow 80      # HTTP (redirects to HTTPS)
sudo ufw allow 443     # HTTPS
sudo ufw enable
sudo ufw status
```

Port 3000 should NOT be open to the public — Nginx proxies it.

---

## Quick health check

```bash
pm2 status                        # process running?
curl -I http://localhost:3000     # app responding?
curl -I https://analyst.convoya.ai  # HTTPS working?
```
