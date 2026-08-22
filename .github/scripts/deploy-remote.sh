#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/ec2-user/PydahTransport"
FRONTEND_DIR="${PROJECT_DIR}/frontend"
BACKEND_DIR="${PROJECT_DIR}/backend"
WEB_ROOT="/var/www/pydahtransport"
WEB_STAGING="/var/www/pydahtransport.staging"
WEB_BACKUP="/var/www/pydahtransport.backup"
PM2_APP="backend"
HEALTH_URL="http://127.0.0.1:5000/"

VITE_API_URL="${VITE_API_URL:-/api}"
VITE_CRM_URL="${VITE_CRM_URL:-https://crm.pydah.edu.in}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

# Returns 0 if npm install is needed for a package dir (relative to PROJECT_DIR).
needs_npm_install() {
  local pkg_dir="$1"
  local prev_commit="$2"
  local next_commit="$3"

  if [ ! -d "${PROJECT_DIR}/${pkg_dir}/node_modules" ]; then
    log "${pkg_dir}: node_modules missing — install required."
    return 0
  fi

  if [ -z "${prev_commit}" ] || [ "${prev_commit}" = "${next_commit}" ]; then
    log "${pkg_dir}: no commit change — skipping install."
    return 1
  fi

  if git -C "${PROJECT_DIR}" diff --name-only "${prev_commit}" "${next_commit}" -- \
      "${pkg_dir}/package.json" \
      "${pkg_dir}/package-lock.json" \
      "${pkg_dir}/npm-shrinkwrap.json" \
      | grep -q .; then
    log "${pkg_dir}: package files changed — install required."
    return 0
  fi

  log "${pkg_dir}: package files unchanged — skipping install."
  return 1
}

rollback() {
  log "Deployment failed — attempting rollback..."
  if [ -n "${PREV_COMMIT:-}" ]; then
    cd "${PROJECT_DIR}"
    git reset --hard "${PREV_COMMIT}" || true
  fi
  if [ -d "${WEB_BACKUP}" ]; then
    sudo rm -rf "${WEB_ROOT}"
    sudo mv "${WEB_BACKUP}" "${WEB_ROOT}" || true
  fi
  if command -v pm2 >/dev/null 2>&1; then
    pm2 reload "${PM2_APP}" 2>/dev/null || pm2 restart "${PM2_APP}" 2>/dev/null || true
    pm2 save || true
  fi
  fail "Rollback attempted. Check server logs: pm2 logs ${PM2_APP}"
}

trap rollback ERR

log "Starting deployment..."
cd "${PROJECT_DIR}" || fail "Project directory not found: ${PROJECT_DIR}"

PREV_COMMIT="$(git rev-parse HEAD)"
log "Current commit: ${PREV_COMMIT}"

log "Pulling latest code from main..."
git fetch origin main
git reset --hard origin/main
NEW_COMMIT="$(git rev-parse HEAD)"
log "Deployed commit: ${NEW_COMMIT}"

if needs_npm_install "backend" "${PREV_COMMIT}" "${NEW_COMMIT}"; then
  log "Installing backend dependencies..."
  cd "${BACKEND_DIR}"
  npm ci --omit=dev || npm install --omit=dev
else
  log "Skipping backend npm install."
fi

if [ ! -f "${BACKEND_DIR}/.env" ]; then
  fail "backend/.env is missing on the server. Create it before first deploy."
fi

if [ ! -f "${BACKEND_DIR}/ecosystem.config.js" ]; then
  fail "backend/ecosystem.config.js not found on server."
fi

if needs_npm_install "frontend" "${PREV_COMMIT}" "${NEW_COMMIT}"; then
  log "Installing frontend dependencies..."
  cd "${FRONTEND_DIR}"
  npm ci || npm install
else
  log "Skipping frontend npm install."
fi

log "Building frontend..."
printf 'VITE_API_URL=%s\nVITE_CRM_URL=%s\n' "${VITE_API_URL}" "${VITE_CRM_URL}" > .env.production
npm run build

if [ ! -d "dist" ]; then
  fail "frontend/dist was not created."
fi

log "Publishing frontend to ${WEB_ROOT}..."
sudo rm -rf "${WEB_STAGING}"
sudo mkdir -p "${WEB_STAGING}"
sudo rsync -a --delete dist/ "${WEB_STAGING}/"

if [ -d "${WEB_ROOT}" ]; then
  sudo rm -rf "${WEB_BACKUP}"
  sudo cp -a "${WEB_ROOT}" "${WEB_BACKUP}"
fi

sudo mkdir -p "$(dirname "${WEB_ROOT}")"
if [ -d "${WEB_ROOT}" ]; then
  sudo rm -rf "${WEB_ROOT}"
fi
sudo mv "${WEB_STAGING}" "${WEB_ROOT}"
sudo chown -R nginx:nginx "${WEB_ROOT}" 2>/dev/null || sudo chown -R ec2-user:ec2-user "${WEB_ROOT}" || true
sudo chmod -R 755 "${WEB_ROOT}"

log "Reloading backend with PM2..."
cd "${BACKEND_DIR}"
if pm2 describe "${PM2_APP}" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --only "${PM2_APP}" --update-env
else
  pm2 start ecosystem.config.js --only "${PM2_APP}"
fi

pm2 save

log "Verifying PM2 process is online..."
if ! pm2 describe "${PM2_APP}" | grep -q "online"; then
  fail "PM2 process '${PM2_APP}' is not online."
fi

log "Waiting for backend health check..."
for i in $(seq 1 30); do
  if curl -sf "${HEALTH_URL}" >/dev/null; then
    log "Backend is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Backend health check failed after 30 attempts."
  fi
  sleep 2
done

trap - ERR

log "Deployment completed successfully."
log "Commit: ${NEW_COMMIT}"
pm2 list
