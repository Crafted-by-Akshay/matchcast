// fn-recap (AGT-15): Flex Consumption Function app with an Event Hubs trigger. It holds no agent logic;
// it calls the api at full time (docs/architecture/03-runtime-flows.md F8). Identity-based connections only.
@minLength(3)
param name string
param location string
param tags object
param identityId string
param identityClientId string
param storageAccountName string
param storageBlobUrl string
param eventHubFqdn string
param apiUrl string
param appInsightsName string

@description('Scope of the api token, api://<matchcast-web client id>/.default. Empty when sign-in is off.')
param recapApiScope string = ''

// The site name is a global host name, so it carries the same stable suffix as the other global names.
resource appi 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

var suffix = take(uniqueString(resourceGroup().id), 5)
var deploymentContainer = 'app-package'

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-fn-${name}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource fn 'Microsoft.Web/sites@2024-04-01' = {
  name: 'fn-${name}-recap-${suffix}'
  location: location
  tags: union(tags, { 'azd-service-name': 'recap' })
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobUrl}${deploymentContainer}'
          authentication: { type: 'UserAssignedIdentity', userAssignedIdentityResourceId: identityId }
        }
      }
      // 40 is the smallest maximum every API version accepts; events are rare and the api route is idempotent
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'python', version: '3.12' }
    }
    siteConfig: {
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storageAccountName }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'AzureWebJobsStorage__clientId', value: identityClientId }
        { name: 'EVENTHUB__fullyQualifiedNamespace', value: eventHubFqdn }
        { name: 'EVENTHUB__credential', value: 'managedidentity' }
        { name: 'EVENTHUB__clientId', value: identityClientId }
        { name: 'AZURE_CLIENT_ID', value: identityClientId }
        { name: 'API_URL', value: apiUrl }
        { name: 'RECAP_API_SCOPE', value: recapApiScope }
        // Not a credential (an ingestion id), the one connection string kept as a plain setting; see docs/infra.md
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
      ]
    }
  }
}

output name string = fn.name
output hostName string = fn.properties.defaultHostName
