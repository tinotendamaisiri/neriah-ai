param location string = 'eastus'
param accountName string

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: accountName
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
  }
}

resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openaiAccount
  name: 'gpt-4o-mini'
  sku: { name: 'Standard', capacity: 10 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4o-mini', version: '2024-07-18' }
  }
}

output openaiEndpoint string = openaiAccount.properties.endpoint
output openaiKey string = openaiAccount.listKeys().key1
