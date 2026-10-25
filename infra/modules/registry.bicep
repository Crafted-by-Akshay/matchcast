// Azure Container Registry for cloud builds (`az acr build`), so a deploy needs no local Docker.
// Basic tier, no admin user: Container Apps pull with the managed identity (AcrPull in roles.bicep).
param location string
param tags object

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrmatchcast${uniqueString(resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

output name string = acr.name
output loginServer string = acr.properties.loginServer
