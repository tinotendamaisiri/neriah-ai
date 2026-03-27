param location string
param accountName string

resource docIntelligence 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: accountName
  location: location
  kind: 'FormRecognizer'
  sku: { name: 'F0' }
  properties: {
    customSubDomainName: accountName
    publicNetworkAccess: 'Enabled'
  }
}

output endpoint string = docIntelligence.properties.endpoint
output key string = docIntelligence.listKeys().key1
