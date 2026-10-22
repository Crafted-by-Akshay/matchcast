// Cognitive Services accounts and AI Search for the app (AGT-12, AGT-16). Foundry is hand-made and not here.
// Speech, Translator and Vision are added to `accounts` by their own stories.
@minLength(3)
param name string
param location string
param tags object

// Makes the global custom domain and search names unique; stable per resource group.
var suffix = take(uniqueString(resourceGroup().id), 5)

@description('Cognitive Services accounts: kind and the short prefix of the name and custom subdomain.')
param accounts array = [
  { key: 'contentSafety', kind: 'ContentSafety', prefix: 'cs', sku: 'S0' }
]

resource cog 'Microsoft.CognitiveServices/accounts@2024-10-01' = [for a in accounts: {
  name: '${a.prefix}-${name}'
  location: location
  tags: tags
  kind: a.kind
  sku: { name: a.sku }
  properties: {
    customSubDomainName: '${a.prefix}-${name}-${suffix}'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}]

// AI Search Free (ADR-0009). Free has no managed identity, so access is by key; the keys are
// copied into Key Vault by the post-provision hook (scripts/set_search_secrets.sh), never output here.
resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: 'srch-${name}-${suffix}'
  location: location
  tags: tags
  sku: { name: 'free' }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
  }
}

output cognitiveNames array = [for (a, i) in accounts: cog[i].name]
output contentSafetyEndpoint string = cog[indexOf(map(accounts, a => a.key), 'contentSafety')].properties.endpoint
output searchName string = search.name
output searchEndpoint string = 'https://${search.name}.search.windows.net'
