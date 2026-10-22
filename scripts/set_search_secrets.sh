#!/usr/bin/env bash
# azd postprovision hook (AGT-16): copy the AI Search keys into Key Vault as srch-query-key and srch-admin-key.
# AI Search Free has no managed identity (ADR-0009), so these are the only stored secrets. The keys are read
# here and written straight to Key Vault: never printed, never a Bicep output, never in the repo.
# The deploying identity needs "Key Vault Secrets Officer" on the vault; the script says so if it lacks it.
# After the first run, SEARCH_KEYS_IN_VAULT=true is saved in the azd environment, so the next `azd provision`
# adds the Key Vault reference to the api (a reference to a missing secret would fail the revision).
set -euo pipefail

RG=${AZURE_RESOURCE_GROUP:-rg-matchcast}
SEARCH=${SEARCH_SERVICE:?SEARCH_SERVICE is not set (azd output of the ai module)}
VAULT=${KEY_VAULT:?KEY_VAULT is not set (azd output)}

# needs Contributor or Search Service Contributor on the resource group
admin=$(az search admin-key show -g "$RG" --service-name "$SEARCH" --query primaryKey -o tsv)
query=$(az search query-key list -g "$RG" --service-name "$SEARCH" --query '[0].key' -o tsv)
if [ -z "$query" ]; then
  query=$(az search query-key create -g "$RG" --service-name "$SEARCH" --name matchcast-query --query key -o tsv)
fi

err=$(mktemp)
trap 'rm -f "$err"' EXIT

set_secret() { # the value goes through stdin, not the command line (visible in the process list)
  if ! printf '%s' "$2" | az keyvault secret set --vault-name "$VAULT" --name "$1" --file /dev/stdin \
    --encoding utf-8 --output none 2>"$err"; then
    echo "could not write $1 to $VAULT: $(head -c 300 "$err")" >&2
    echo "grant yourself 'Key Vault Secrets Officer' on $VAULT and run this script again" >&2
    exit 1
  fi
}
set_secret srch-admin-key "$admin"
set_secret srch-query-key "$query"
unset admin query

if command -v azd >/dev/null; then azd env set SEARCH_KEYS_IN_VAULT true >/dev/null; fi
echo "stored srch-admin-key and srch-query-key in $VAULT"
