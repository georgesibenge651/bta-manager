#!/usr/bin/env bash
set -euo pipefail
ROOT="$(pwd)"
OUT="$ROOT/bta-manager-diagnostic-source.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

FILES=(
  "package.json" "package-lock.json" "capacitor.config.ts" "vite.config.ts" "tsconfig.json"
  "src/core/api.ts" "src/core/session.tsx" "src/core/bootstrap.ts" "src/firebase/auth.ts"
  "android/app/src/main/AndroidManifest.xml"
  "android/app/src/main/java" "android/app/src/main/kotlin"
  "android/app/src/main/res/xml/config.xml"
)
mkdir -p "$STAGE/bta-manager"
for item in "${FILES[@]}"; do
  if [ -e "$ROOT/$item" ]; then
    mkdir -p "$STAGE/bta-manager/$(dirname "$item")"
    cp -R "$ROOT/$item" "$STAGE/bta-manager/$(dirname "$item")/"
  fi
done
for dir in src/core src/db src/components; do
  if [ -d "$ROOT/$dir" ]; then
    mkdir -p "$STAGE/bta-manager/$(dirname "$dir")"
    cp -R "$ROOT/$dir" "$STAGE/bta-manager/$(dirname "$dir")/"
  fi
done
find "$STAGE" -type d \( -name node_modules -o -name .git -o -name dist -o -name build \) -prune -exec rm -rf {} +
find "$STAGE" -type f \( -name '.env' -o -name '.env.*' -o -name '*secret*' -o -name '*credential*' \
  -o -name 'google-services.json' -o -name '*.jks' -o -name '*.keystore' -o -name 'wp-config.php' \
  -o -name 'id_rsa' -o -name '*.pem' -o -name '*.p12' \) -delete
cat > "$STAGE/README.txt" <<'EOF'
Sources ciblées BTA Manager pour diagnostic Claude.
Aucun node_modules, dist, historique Git, fichier .env ou clé de signature volontairement inclus.
Vérifier manuellement le contenu avant transmission.
Le plugin WordPress doit être fourni séparément s'il doit être analysé.
EOF
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" bta-manager)
echo "ZIP créé : $OUT"
echo "Taille : $(du -h "$OUT" | cut -f1)"
echo "Vérification : unzip -l \"$OUT\""
