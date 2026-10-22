param name string
param location string
param tags object
param logAnalyticsName string
param identityId string
param identityClientId string
param foundryProjectEndpoint string
param storageTableUrl string
param storageBlobUrl string
param eventHubFqdn string
param eventHubName string
param webImage string
param apiImage string
param mcpImage string

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${name}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var identity = {
  type: 'UserAssigned'
  userAssignedIdentities: { '${identityId}': {} }
}

var commonEnv = [
  { name: 'AZURE_CLIENT_ID', value: identityClientId }
  { name: 'MATCHCAST_MODE', value: 'cloud' }
]

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-${name}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: identity
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'auto' }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: commonEnv
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-api-${name}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: identity
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8000, transport: 'auto' }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, [
            { name: 'MATCHCAST_AGENT_MODE', value: 'rules' }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
            { name: 'FOUNDRY_MODEL_DEPLOYMENT', value: 'gpt-6-luna' }
            { name: 'FOUNDRY_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
            { name: 'STORAGE_TABLE_URL', value: storageTableUrl }
            { name: 'STORAGE_BLOB_URL', value: storageBlobUrl }
            { name: 'EVENTHUB_FQDN', value: eventHubFqdn }
            { name: 'EVENTHUB_NAME', value: eventHubName }
            { name: 'MATCHCAST_STORE', value: 'table' }
          ])
          probes: [
            { type: 'Liveness', httpGet: { path: '/health', port: 8000 } }
            { type: 'Readiness', httpGet: { path: '/ready', port: 8000 } }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }]
      }
    }
  }
}

resource mcp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-mcp-${name}'
  location: location
  tags: union(tags, { 'azd-service-name': 'mcp' })
  identity: identity
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: false, targetPort: 8001, transport: 'auto' }
    }
    template: {
      containers: [
        {
          name: 'mcp'
          image: mcpImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, [
            { name: 'STORAGE_TABLE_URL', value: storageTableUrl }
            { name: 'STORAGE_BLOB_URL', value: storageBlobUrl }
          ])
          probes: [
            { type: 'Liveness', httpGet: { path: '/health', port: 8001 } }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '20' } } }]
      }
    }
  }
}

output webFqdn string = web.properties.configuration.ingress.fqdn
output apiFqdn string = api.properties.configuration.ingress.fqdn
output mcpFqdn string = mcp.properties.configuration.ingress.fqdn
