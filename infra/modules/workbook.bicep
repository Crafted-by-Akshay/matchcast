param location string
param tags object
param appInsightsId string

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, 'matchcast-agents')
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: 'MatchCast agents'
    category: 'workbook'
    sourceId: appInsightsId
    serializedData: loadTextContent('workbook.json')
  }
}
