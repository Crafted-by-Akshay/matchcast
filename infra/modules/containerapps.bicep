param name string
param location string
param tags object
param logAnalyticsName string
param appInsightsName string
param identityId string
param identityClientId string
param foundryProjectEndpoint string
param storageTableUrl string
param storageBlobUrl string
param eventHubFqdn string
param eventHubName string
param eventHubNamespace string
param storageAccountName string
param webImage string
param apiImage string
param mcpImage string

@description('Client ID of the Entra app registration matchcast-web (PLT-5). Empty leaves Easy Auth off.')
param entraClientId string = ''
param keyVaultUri string = ''
param contentSafetyEndpoint string = ''
param speechEndpoint string = ''
param speechRegion string = ''
param translatorEndpoint string = ''
param translatorRegion string = ''
param searchEndpoint string = ''

@allowed(['direct', 'memory', 'eventhubs'])
param pipelineMode string = 'direct'

@description('True when Key Vault already holds srch-query-key; a Key Vault secret reference to a missing secret fails the revision.')
param searchKeysInVault bool = false

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource appi 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
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
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection' }
]

// The App Insights connection string is not a credential, but it is stored as an app
// secret and referenced, so no connection string appears as a plain environment value.
var authEnabled = !empty(entraClientId)

// The Entra client secret is the one secret Easy Auth needs (documented in docs/infra.md).
// It lives in Key Vault as 'entra-client-secret' and is referenced, never stored here.
var appInsightsSecrets = concat(
  [{ name: 'appinsights-connection', value: appi.properties.ConnectionString }],
  authEnabled
    ? [
        {
          name: 'entra-client-secret'
          keyVaultUrl: '${keyVaultUri}secrets/entra-client-secret'
          identity: identityId
        }
      ]
    : []
)

var searchSecrets = searchKeysInVault
  ? [{ name: 'srch-query-key', keyVaultUrl: '${keyVaultUri}secrets/srch-query-key', identity: identityId }]
  : []
var searchEnv = searchKeysInVault ? [{ name: 'SEARCH_QUERY_KEY', secretRef: 'srch-query-key' }] : []

var authEnv = authEnabled
  ? [
      { name: 'MATCHCAST_EASY_AUTH', value: '1' }
      { name: 'MATCHCAST_REQUIRE_ROLE', value: '1' }
    ]
  : []

resource web 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-web-${name}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: identity
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: appInsightsSecrets
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

resource api 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-api-${name}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: identity
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: concat(appInsightsSecrets, searchSecrets)
      ingress: { external: true, targetPort: 8000, transport: 'auto' }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, authEnv, [
            { name: 'MATCHCAST_AGENT_MODE', value: 'rules' }
            { name: 'MATCHCAST_PIPELINE', value: pipelineMode }
            // ADR-0017: one writer of matchstate per mode; the reducer owns it whenever events go through the hub
            { name: 'MATCHCAST_STATE_WRITER', value: pipelineMode == 'direct' ? 'workflow' : 'reducer' }
            // The ingress is the only way in and appends the caller to X-Forwarded-For
            { name: 'MATCHCAST_BEHIND_INGRESS', value: 'true' }
            { name: 'FOUNDRY_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
            { name: 'FOUNDRY_MODEL_DEPLOYMENT', value: 'gpt-6-luna' }
            { name: 'FOUNDRY_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
            { name: 'STORAGE_TABLE_URL', value: storageTableUrl }
            { name: 'STORAGE_BLOB_URL', value: storageBlobUrl }
            { name: 'EVENTHUB_FQDN', value: eventHubFqdn }
            { name: 'EVENTHUB_NAME', value: eventHubName }
            { name: 'MATCHCAST_STORE', value: 'table' }
            { name: 'CONTENT_SAFETY_ENDPOINT', value: contentSafetyEndpoint }
            { name: 'SPEECH_ENDPOINT', value: speechEndpoint }
            { name: 'SPEECH_REGION', value: speechRegion }
            { name: 'TRANSLATOR_ENDPOINT', value: translatorEndpoint }
            { name: 'TRANSLATOR_REGION', value: translatorRegion }
            { name: 'SEARCH_ENDPOINT', value: searchEndpoint }
            { name: 'SEARCH_INDEX', value: 'kb-matchcast-v1' }
            // Easy Auth and the ingress already restrict Host; the FQDN is not known inside its own app
            { name: 'MATCHCAST_MCP_ALLOWED_HOSTS', value: '*' }
          ], searchEnv)
          probes: [
            { type: 'Liveness', httpGet: { path: '/health', port: 8000 } }
            { type: 'Readiness', httpGet: { path: '/ready', port: 8000 } }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          { name: 'http', http: { metadata: { concurrentRequests: '20' } } }
          {
            name: 'match-events-backlog'
            custom: {
              type: 'azure-eventhub'
              metadata: {
                eventHubNamespace: eventHubNamespace
                eventHubName: eventHubName
                consumerGroup: '$Default'
                unprocessedEventThreshold: '50'
                storageAccountName: storageAccountName
                blobContainer: 'eh-checkpoints'
                checkpointStrategy: 'blobMetadata'
              }
              identity: identityId
            }
          }
        ]
      }
    }
  }
}

resource mcp 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-mcp-${name}'
  location: location
  tags: union(tags, { 'azd-service-name': 'mcp' })
  identity: identity
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: appInsightsSecrets
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

var authAudience = 'api://${entraClientId}'

resource webAuth 'Microsoft.App/containerApps/authConfigs@2025-01-01' = if (authEnabled) {
  parent: web
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: { unauthenticatedClientAction: 'AllowAnonymous' }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'entra-client-secret'
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
        }
        validation: { allowedAudiences: [authAudience, entraClientId] }
      }
    }
    login: { preserveUrlFragmentsForLogins: true }
  }
}

resource apiAuth 'Microsoft.App/containerApps/authConfigs@2025-01-01' = if (authEnabled) {
  parent: api
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: { unauthenticatedClientAction: 'AllowAnonymous' }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'entra-client-secret'
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
        }
        validation: { allowedAudiences: [authAudience, entraClientId] }
      }
    }
  }
}
