param environmentName string
param location string
param tags object

var tableNames = [
  'matches'
  'events'
  'matchstate'
  'claims'
  'lines'
  'publications'
  'recaps'
  'audit'
  'checkpoints'
  'conversations'
]

var containerNames = [
  'season'
  'scenes'
  'models'
  'audio'
  'recaps'
  'kb-chunks'
  'vision'
  'exports'
  'overflow'
  'eh-checkpoints'
]

resource st 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stmatchcast${replace(environmentName, '-', '')}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    defaultToOAuthAuthentication: true
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: st
  name: 'default'
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = [for t in tableNames: {
  parent: tableService
  name: t
}]

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: st
  name: 'default'
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for c in containerNames: {
  parent: blobService
  name: c
}]

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: st
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'audio-30d'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['audio/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 30 } } }
          }
        }
        {
          name: 'vision-1d'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['vision/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 1 } } }
          }
        }
        {
          name: 'exports-7d'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['exports/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 7 } } }
          }
        }
      ]
    }
  }
  dependsOn: [containers]
}

output name string = st.name
output tableUrl string = st.properties.primaryEndpoints.table
output blobUrl string = st.properties.primaryEndpoints.blob
