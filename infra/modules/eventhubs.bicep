param name string
param location string
param tags object

resource ns 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: 'evhns-${name}'
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic', capacity: 1 }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
  }
}

resource hub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: ns
  name: 'match-events'
  properties: {
    partitionCount: 1
    retentionDescription: null
    messageRetentionInDays: 1
  }
}

output name string = ns.name
output fqdn string = '${ns.name}.servicebus.windows.net'
output hubName string = hub.name
