#!/bin/bash
# Nasadenie Píšťalky.
#
# Build beží lokálne, výsledok (`public/`) sa commituje do gitu a server si ho
# len stiahne cez `git reset --hard origin/main`. Statický web, takže žiadny
# maintenance mód netreba – prepnutie verzie je jeden git príkaz.
#
#   ./deploy.sh              testy + build + commit + push + nasadenie
#   ./deploy.sh --skip-tests preskočí Playwright testy
#   ./deploy.sh --setup      jednorazové sprevádzkovanie servera (vhost + certifikát)

set -u

SERVER="root@37.205.15.159"
DOMAIN="pistalka.vsetkosada.sk"
REMOTE_DIR="/var/www/pistalka"
REPO="git@github.com:tito10047/pistalka.git"
BRANCH="main"

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$PROJECT_ROOT" || exit 1

SKIP_TESTS=0
DO_SETUP=0
OLD_REMOTE_COMMIT=""

usage() {
    sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
}

for arg in "$@"; do
    case "$arg" in
        --skip-tests ) SKIP_TESTS=1 ;;
        --setup      ) DO_SETUP=1 ;;
        -h|--help    ) usage ;;
        *            ) echo "❌ Neznámy prepínač: $arg"; usage ;;
    esac
done

# Chyba počas nasadenia – ponúkne rollback na predchádzajúci commit na serveri.
handle_error() {
    local error_msg=$1
    echo "❌ $error_msg"

    if [ -z "$OLD_REMOTE_COMMIT" ]; then
        echo "🛑 Na serveri sa ešte nič nemenilo, končím."
        exit 1
    fi

    read -r -p "Čo mám urobiť? [r]ollback na $OLD_REMOTE_COMMIT / [e]xit (nechať ako je): " choice
    case "$choice" in
        r|R )
            echo "⏪ Rollbackujem server na $OLD_REMOTE_COMMIT..."
            ssh "$SERVER" "cd $REMOTE_DIR && git reset --hard $OLD_REMOTE_COMMIT"
            echo "⏪ Rollback hotový. Lokálny repozitár a origin/$BRANCH ostávajú na novej verzii."
            exit 1
            ;;
        * )
            echo "🛑 Končím. Server ostáva na nasadenej verzii."
            exit 1
            ;;
    esac
}

# ── Jednorazové sprevádzkovanie servera ──────────────────────────────────────
setup_server() {
    echo "🧱 Pripravujem server $SERVER pre $DOMAIN..."

    ssh "$SERVER" REMOTE_DIR="$REMOTE_DIR" REPO="$REPO" DOMAIN="$DOMAIN" BRANCH="$BRANCH" 'bash -s' <<'REMOTE_SETUP'
set -eu

# 1. Klon repozitára (server má vlastný GitHub kľúč)
if [ ! -d "$REMOTE_DIR/.git" ]; then
    echo "📥 Klonujem $REPO do $REMOTE_DIR..."
    mkdir -p "$(dirname "$REMOTE_DIR")"
    git clone --branch "$BRANCH" "$REPO" "$REMOTE_DIR"
else
    echo "ℹ️  $REMOTE_DIR už existuje, klonovanie preskakujem."
fi
git config --global --add safe.directory "$REMOTE_DIR" 2>/dev/null || true

# Aby mal Apache čo servírovať aj pred prvým buildom
mkdir -p "$REMOTE_DIR/public"

# 2. Apache vhost (HTTP – HTTPS dorobí certbot)
VHOST="/etc/apache2/sites-available/${DOMAIN}.conf"
if [ ! -f "$VHOST" ]; then
    echo "📝 Vytváram $VHOST..."
    cat > "$VHOST" <<VHOSTEOF
<VirtualHost *:80>
    ServerName ${DOMAIN}
    DocumentRoot "${REMOTE_DIR}/public"

    <Directory "${REMOTE_DIR}/public">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # PWA: service worker, HTML a manifest sa nesmú cachovať, inak sa nová
    # verzia u ľudí nikdy neprejaví. Assety majú hash v názve, tie môžu navždy.
    <FilesMatch "^(sw\.js|index\.html|manifest\.webmanifest|registerSW\.js)$">
        Header set Cache-Control "no-cache, must-revalidate"
    </FilesMatch>
    <LocationMatch "^/assets/">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </LocationMatch>

    ErrorLog /var/log/apache2/pistalka-error.log
    CustomLog /var/log/apache2/pistalka-access.log combined
</VirtualHost>
VHOSTEOF
else
    echo "ℹ️  $VHOST už existuje, nechávam ho tak."
fi

a2ensite "${DOMAIN}" >/dev/null
apache2ctl configtest
systemctl reload apache2
echo "✅ Apache beží s vhostom pre ${DOMAIN}."

# 3. Certifikát
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    echo "ℹ️  Certifikát pre ${DOMAIN} už existuje, preskakujem certbot."
else
    echo "🔐 Vydávam Let's Encrypt certifikát pre ${DOMAIN}..."
    certbot --apache -d "${DOMAIN}" --non-interactive --agree-tos --redirect
    systemctl reload apache2
fi
REMOTE_SETUP

    if [ $? -ne 0 ]; then
        echo "❌ Sprevádzkovanie servera zlyhalo."
        exit 1
    fi

    echo "✨ Server je pripravený."
}

echo "🚀 Spúšťam nasadenie Píšťalky na https://$DOMAIN"

if [ "$DO_SETUP" -eq 1 ]; then
    setup_server
fi

# ── 1. Predkontroly ──────────────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    echo "❌ Si na vetve '$CURRENT_BRANCH', nasadzuje sa len z '$BRANCH'."
    exit 1
fi

# Necommitnuté zdrojové zmeny – public/ ignorujeme, ten prepisuje tento skript.
DIRTY=$(git status --porcelain -- . ':(exclude)public')
if [ -n "$DIRTY" ]; then
    echo "❌ Máš necommitnuté zmeny v zdrojákoch:"
    echo "$DIRTY"
    echo "   Commitni ich (alebo stashni) a spusti deploy znova."
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "📦 Chýbajú závislosti, inštalujem (npm ci)..."
    npm ci || { echo "❌ npm ci zlyhal!"; exit 1; }
fi

# ── 2. Testy ─────────────────────────────────────────────────────────────────
if [ "$SKIP_TESTS" -eq 1 ]; then
    echo "⏭️  Testy preskočené (--skip-tests)."
else
    echo "🧪 Spúšťam Playwright testy (desktop + mobil)..."
    npm test || { echo "❌ Testy zlyhali! Nenasadzujem."; exit 1; }
    echo "✅ Testy prebehli úspešne."
fi

# ── 3. Build ─────────────────────────────────────────────────────────────────
echo "🔨 Buildujem produkčnú verziu..."
npm run build || { echo "❌ Build zlyhal!"; exit 1; }
echo "✅ Build hotový (public/)."

# ── 4. Commit buildu ─────────────────────────────────────────────────────────
SOURCE_SHA=$(git rev-parse --short HEAD)
git add -A public
if git diff --cached --quiet; then
    echo "ℹ️  Build sa nezmenil, nový commit netreba."
else
    echo "📝 Commitujem build..."
    git commit -m "chore(build): nasadenie $SOURCE_SHA" || { echo "❌ Commit zlyhal!"; exit 1; }
fi

# ── 5. Push ──────────────────────────────────────────────────────────────────
echo "📤 Pushujem na origin/$BRANCH..."
git push origin "$BRANCH" || { echo "❌ Push zlyhal!"; exit 1; }

# ── 6. Nasadenie na server ───────────────────────────────────────────────────
OLD_REMOTE_COMMIT=$(ssh "$SERVER" "cd $REMOTE_DIR && git rev-parse HEAD" 2>/dev/null)
if [ -z "$OLD_REMOTE_COMMIT" ]; then
    echo "❌ Na serveri nie je repozitár v $REMOTE_DIR. Spusti najprv: ./deploy.sh --setup"
    exit 1
fi

echo "🌍 Nasadzujem na server (predchádzajúca verzia: $OLD_REMOTE_COMMIT)..."
ssh "$SERVER" "cd $REMOTE_DIR && git fetch --prune origin && git reset --hard origin/$BRANCH" \
    || handle_error "Aktualizácia repozitára na serveri zlyhala!"

# ── 7. Healthcheck ───────────────────────────────────────────────────────────
echo "🔍 Overujem dostupnosť..."
for path in "/" "/manifest.webmanifest"; do
    STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}${path}")
    if [ "$STATUS_CODE" != "200" ]; then
        handle_error "Test dostupnosti zlyhal: https://${DOMAIN}${path} vrátilo $STATUS_CODE"
    fi
    echo "   ✅ https://${DOMAIN}${path} → 200"
done

NEW_COMMIT=$(git rev-parse --short HEAD)
echo "✨ Nasadenie dokončené úspešne! ($OLD_REMOTE_COMMIT → $NEW_COMMIT)"
echo "   https://${DOMAIN}"
