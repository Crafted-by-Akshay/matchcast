param name string
param location string
param tags object
param appInsightsId string
param alertEmail string

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${name}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'matchcast'
    enabled: true
    emailReceivers: [
      { name: 'owner', emailAddress: alertEmail, useCommonAlertSchema: true }
    ]
  }
}

var rules = [
  {
    key: 'errors'
    display: 'MatchCast 5xx above 5% for 5 minutes'
    window: 'PT5M'
    query: 'requests | summarize failed = countif(toint(resultCode) >= 500), total = count() | where total > 20 and failed * 100.0 / total > 5'
  }
  {
    key: 'agent-latency'
    display: 'MatchCast agent p95 latency above 6 s'
    window: 'PT10M'
    query: 'dependencies | where name startswith "invoke_agent" | summarize p95 = percentile(duration, 95) | where p95 > 6000'
  }
  {
    key: 'fallback-spike'
    display: 'MatchCast more than 20% of lines from rules mode'
    window: 'PT10M'
    query: 'dependencies | where name startswith "invoke_agent" | summarize rules = countif(tostring(customDimensions["matchcast.mode"]) == "rules"), total = count() | where total > 10 and rules * 100.0 / total > 20'
  }
]

resource alertRules 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = [for r in rules: {
  name: 'alert-${r.key}-${name}'
  location: location
  tags: tags
  properties: {
    displayName: r.display
    enabled: true
    severity: 2
    scopes: [appInsightsId]
    evaluationFrequency: 'PT5M'
    windowSize: r.window
    criteria: {
      allOf: [
        {
          query: r.query
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}]
