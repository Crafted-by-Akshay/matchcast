targetScope = 'resourceGroup'

@description('Azure region for all resources except the resource group.')
param location string = 'eastus2'

@description('azd environment name, used in resource names and the azd-env-name tag.')
param environmentName string = 'dev'

@description('Endpoint of the hand-made Foundry project (proj-default).')
param foundryProjectEndpoint string

@description('Name of the hand-made Foundry resource, in this resource group.')
param foundryAccountName string = 'matchcast-foundry'

@description('Email for operational alerts (PLT-8). Empty skips the alert rules.')
param alertEmail string = ''

@description('Client ID of the Entra app registration matchcast-web (PLT-5). Empty leaves sign-in off.')
param entraClientId string = ''

@description('Container images. The defaults are a public placeholder; deploy (PLT-7) replaces them with ghcr.io/crafted-by-akshay/matchcast-* tags.')
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
param mcpImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('True once scripts/set_search_secrets.sh has stored srch-query-key in Key Vault (the post-provision hook sets it for the next provision).')
param searchKeysInVault string = 'false'

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

module ai 'modules/ai.bicep' = {
  name: 'ai'
  params: { name: name, location: location, tags: tags }
}

module containerapps 'modules/containerapps.bicep' = {
  name: 'containerapps'
  params: {
    name: name
    location: location
    tags: tags
    logAnalyticsName: monitoring.outputs.logAnalyticsName
    appInsightsName: monitoring.outputs.appInsightsName
    identityId: identity.outputs.id
    identityClientId: identity.outputs.clientId
    foundryProjectEndpoint: foundryProjectEndpoint
    storageTableUrl: storage.outputs.tableUrl
    storageBlobUrl: storage.outputs.blobUrl
    eventHubFqdn: eventhubs.outputs.fqdn
    eventHubName: eventhubs.outputs.hubName
    eventHubNamespace: eventhubs.outputs.name
    storageAccountName: storage.outputs.name
    webImage: webImage
    apiImage: apiImage
    mcpImage: mcpImage
    entraClientId: entraClientId
    keyVaultUri: keyvault.outputs.uri
    contentSafetyEndpoint: ai.outputs.contentSafetyEndpoint
    speechEndpoint: ai.outputs.speechEndpoint
    speechRegion: ai.outputs.speechRegion
    searchEndpoint: ai.outputs.searchEndpoint
    searchKeysInVault: searchKeysInVault == 'true'
  }
}

module recapFunction 'modules/function.bicep' = {
  name: 'recapFunction'
  params: {
    name: name
    location: location
    tags: tags
    identityId: identity.outputs.id
    identityClientId: identity.outputs.clientId
    storageAccountName: storage.outputs.name
    storageBlobUrl: storage.outputs.blobUrl
    eventHubFqdn: eventhubs.outputs.fqdn
    apiUrl: 'https://${containerapps.outputs.apiFqdn}'
    appInsightsName: monitoring.outputs.appInsightsName
    recapApiScope: empty(entraClientId) ? '' : 'api://${entraClientId}/.default'
  }
}

module alerts 'modules/alerts.bicep' = if (!empty(alertEmail)) {
  name: 'alerts'
  params: {
    name: name
    location: location
    tags: tags
    appInsightsId: monitoring.outputs.appInsightsId
    alertEmail: alertEmail
  }
}

module workbook 'modules/workbook.bicep' = {
  name: 'workbook'
  params: { location: location, tags: tags, appInsightsId: monitoring.outputs.appInsightsId }
}

module roles 'modules/roles.bicep' = {
  name: 'roles'
  params: {
    principalId: identity.outputs.principalId
    storageName: storage.outputs.name
    eventHubNamespaceName: eventhubs.outputs.name
    keyVaultName: keyvault.outputs.name
    foundryAccountName: foundryAccountName
    cognitiveNames: ai.outputs.cognitiveNames
  }
}

output AZURE_CLIENT_ID string = identity.outputs.clientId
output WEB_URI string = 'https://${containerapps.outputs.webFqdn}'
output API_URI string = 'https://${containerapps.outputs.apiFqdn}'
output STORAGE_ACCOUNT string = storage.outputs.name
output EVENTHUB_NAMESPACE string = eventhubs.outputs.name
output KEY_VAULT string = keyvault.outputs.name
output RECAP_FUNCTION string = recapFunction.outputs.name
output SEARCH_SERVICE string = ai.outputs.searchName
output SEARCH_ENDPOINT string = ai.outputs.searchEndpoint
output CONTENT_SAFETY_ENDPOINT string = ai.outputs.contentSafetyEndpoint
output SPEECH_ENDPOINT string = ai.outputs.speechEndpoint
output SPEECH_REGION string = ai.outputs.speechRegion
