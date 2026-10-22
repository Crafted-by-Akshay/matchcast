param principalId string
param storageName string
param eventHubNamespaceName string
param keyVaultName string
param foundryAccountName string

@description('Cognitive Services accounts the identity may call (Cognitive Services User).')
param cognitiveNames array = []

var roleIds = {
  azureAiUser: '53ca6127-db72-4b80-b1b0-d745d6d5456d'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  eventHubsDataSender: '2b629674-e913-4c01-ae53-ef4638d8f975'
  eventHubsDataReceiver: 'a638d3c7-ab3a-418d-83e6-5f17a39d4fde'
  keyVaultSecretsUser: '4633458b-17de-406a-b5cd-9c4a5b5cd8ee'
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  storageQueueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
}

resource st 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: storageName }
resource evh 'Microsoft.EventHub/namespaces@2024-01-01' existing = { name: eventHubNamespaceName }
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = { name: foundryAccountName }

resource foundryUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: foundry
  name: guid(foundry.id, principalId, roleIds.azureAiUser)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.azureAiUser)
  }
}

resource tableContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, principalId, roleIds.storageTableDataContributor)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageTableDataContributor)
  }
}

resource blobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, principalId, roleIds.storageBlobDataContributor)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageBlobDataContributor)
  }
}

// The Functions host (fn-recap) keeps its checkpoints and deployment package in Blob and uses Queue.
resource blobOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, principalId, roleIds.storageBlobDataOwner)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageBlobDataOwner)
  }
}

resource queueContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: st
  name: guid(st.id, principalId, roleIds.storageQueueDataContributor)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageQueueDataContributor)
  }
}

resource ehSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: evh
  name: guid(evh.id, principalId, roleIds.eventHubsDataSender)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.eventHubsDataSender)
  }
}

resource ehReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: evh
  name: guid(evh.id, principalId, roleIds.eventHubsDataReceiver)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.eventHubsDataReceiver)
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, principalId, roleIds.keyVaultSecretsUser)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.keyVaultSecretsUser)
  }
}

resource cognitive 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = [for n in cognitiveNames: {
  name: n
}]

resource cognitiveUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (n, i) in cognitiveNames: {
  scope: cognitive[i]
  name: guid(cognitive[i].id, principalId, roleIds.cognitiveServicesUser)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.cognitiveServicesUser)
  }
}]
