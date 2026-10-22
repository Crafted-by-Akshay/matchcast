param location string
param tags object

resource id 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-matchcast'
  location: location
  tags: tags
}

output id string = id.id
output name string = id.name
output principalId string = id.properties.principalId
output clientId string = id.properties.clientId
