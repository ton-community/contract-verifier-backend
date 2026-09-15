#!/bin/sh
# Downloads TON compiler binaries (func, fift, fiftlib)
# Replicates https://github.com/ton-defi-org/heroku-buildpack-func-compiler/blob/main/bin/compile

# Note: Not using 'set -e' to allow graceful handling of missing versions

BINARIES_DIR="${BINARIES_DIR:-/app/resources/binaries}"
CONFIG_URL="https://raw.githubusercontent.com/ton-community/contract-verifier-config/main/config.json"
BINARIES_BASE="https://github.com/ton-defi-org/ton-binaries/releases/download"

echo "Creating binaries directory at ${BINARIES_DIR}..."
mkdir -p "${BINARIES_DIR}"

echo "Fetching supported FunC versions from ${CONFIG_URL}..."
VERSIONS=$(curl -sL "${CONFIG_URL}" | jq -r '.funcVersions[]')

if [ -z "$VERSIONS" ]; then
    echo "Error: No versions found in config"
    exit 1
fi

echo "Found versions: $(echo $VERSIONS | tr '\n' ' ')"

SUCCESSFUL=0
FAILED=0

for VERSION in $VERSIONS; do
    echo ""
    echo "=== Downloading TON binaries for version ${VERSION} ==="

    VERSION_DIR="${BINARIES_DIR}/${VERSION}"
    mkdir -p "${VERSION_DIR}/fiftlib"

    DOWNLOAD_FAILED=false

    # Download func compiler
    echo "  - Downloading func..."
    if ! curl -fsSL "${BINARIES_BASE}/ubuntu-22-${VERSION}/func" -o "${VERSION_DIR}/func" 2>/dev/null; then
        echo "  ⚠ Warning: func binary not found for version ${VERSION}"
        DOWNLOAD_FAILED=true
    fi

    # Download fift interpreter
    if [ "$DOWNLOAD_FAILED" = false ]; then
        echo "  - Downloading fift..."
        if ! curl -fsSL "${BINARIES_BASE}/ubuntu-22-${VERSION}/fift" -o "${VERSION_DIR}/fift" 2>/dev/null; then
            echo "  ⚠ Warning: fift binary not found for version ${VERSION}"
            DOWNLOAD_FAILED=true
        fi
    fi

    # Download fiftlib
    if [ "$DOWNLOAD_FAILED" = false ]; then
        echo "  - Downloading fiftlib..."
        if ! curl -fsSL "${BINARIES_BASE}/ubuntu-22-${VERSION}/fiftlib.zip" -o /tmp/fiftlib-${VERSION}.zip 2>/dev/null; then
            echo "  ⚠ Warning: fiftlib not found for version ${VERSION}"
            DOWNLOAD_FAILED=true
        fi
    fi

    if [ "$DOWNLOAD_FAILED" = true ]; then
        echo "  ✗ Skipping version ${VERSION} (binaries not available)"
        rm -rf "${VERSION_DIR}"
        FAILED=$((FAILED + 1))
        continue
    fi

    # Make executables
    chmod +x "${VERSION_DIR}/func" "${VERSION_DIR}/fift"

    # Extract fiftlib
    echo "  - Extracting fiftlib..."
    unzip -q /tmp/fiftlib-${VERSION}.zip -d "${VERSION_DIR}/fiftlib"
    rm /tmp/fiftlib-${VERSION}.zip

    echo "  ✓ Version ${VERSION} installed successfully"
    SUCCESSFUL=$((SUCCESSFUL + 1))
done

echo ""
echo "=== TON binaries installation complete ==="
echo "Successfully installed: ${SUCCESSFUL} versions"
if [ $FAILED -gt 0 ]; then
    echo "Failed/Skipped: ${FAILED} versions"
fi
echo "Installation directory: ${BINARIES_DIR}"
