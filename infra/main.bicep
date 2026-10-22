targetScope = 'resourceGroup'

@description('Azure region for all resources except the resource group.')
param location string = 'eastus2'

@description('azd environment name, used in resource names and the azd-env-name tag.')
param environmentName string = 'dev'

@description('Endpoint of the hand-made Foundry project (proj-default).')
param foundryProjectEndpoint string

@description('Name of the hand-made Foundry resource, in this resource group.')
param foundryAccountName string = 'matchcast-foundry'

@description('Container images. The defaults are a public placeholder; deploy (PLT-7) replaces them with ghcr.io/crafted-by-akshay/matchcast-* tags.')
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param mcpImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

var name = 'matchcast-${environmentName}'
var tags = {
  project: 'matchcast'
  'azd-env-name': environmentName
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { name: name, location: location, tags: tags }
}

module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: { location: location, tags: tags }
}

module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: { name: name, location: location, tags: tags }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: { environmentName: environmentName, location: location, tags: tags }
}

module eventhubs 'modules/eventhubs.bicep' = {
  name: 'eventhubs'
  params: { name: name, location: location, tags: tags }
}

module containerapps 'modules/containerapps.bicep' = {
  name: 'containerapps'
  params: {
    name: name
    location: location
    tags: tags
    logAnalyticsName: monitoring.outputs.logAnalyticsName
    identityId: identity.outputs.id
    identityClientId: identity.outputs.clientId
    foundryProjectEndpoint: foundryProjectEndpoint
    storageTableUrl: storage.outputs.tableUrl
    storageBlobUrl: storage.outputs.blobUrl
    eventHubFqdn: eventhubs.outputs.fqdn
    eventHubName: eventhubs.outputs.hubName
    webImage: webImage
    apiImage: apiImage
    mcpImage: mcpImage
  }
}

module roles 'modules/roles.bicep' = {
  name: 'roles'
  params: {
    principalId: identity.outputs.principalId
    storageName: storage.outputs.name
    eventHubNamespaceName: eventhubs.outputs.name
    keyVaultName: keyvault.outputs.name
    foundryAccountName: foundryAccountName
  }
}

output AZURE_CLIENT_ID string = identity.outputs.clientId
output WEB_URI string = 'https://${containerapps.outputs.webFqdn}'
output API_URI string = 'https://${containerapps.outputs.apiFqdn}'
output STORAGE_ACCOUNT string = storage.outputs.name
output EVENTHUB_NAMESPACE string = eventhubs.outputs.name
output KEY_VAULT string = keyvault.outputs.name
