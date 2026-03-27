targetScope = 'resourceGroup'

param location string = 'southafricanorth'
param environment string = 'dev'
param prefix string = 'neriah'

var cosmosName  = '${prefix}-cosmos-${environment}'
var storageName = replace('${prefix}stor${environment}', '-', '')
var openaiName  = '${prefix}-openai-${environment}'
var docIntName  = '${prefix}-docint-${environment}'
// gpt-4o-mini has no deployment SKU capacity in southafricanorth; eastus confirmed working
var openaiLocation = 'eastus'

module cosmos 'modules/cosmos.bicep' = {
  name: 'cosmos'
  params: { location: location, accountName: cosmosName }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: { location: location, storageAccountName: storageName }
}

module openai 'modules/openai.bicep' = {
  name: 'openai'
  params: { location: openaiLocation, accountName: openaiName }
}

module docIntelligence 'modules/document_intelligence.bicep' = {
  name: 'docIntelligence'
  params: { location: location, accountName: docIntName }
}

// Note: Function App is provisioned separately via az functionapp create
// (subscription does not permit creating new server farm resources via ARM).
// See scripts/deploy.sh for the CLI step that follows this Bicep deployment.

output cosmosEndpoint string = cosmos.outputs.cosmosEndpoint
output cosmosKey      string = cosmos.outputs.cosmosKey
output storageAccount string = storage.outputs.storageAccountName
output storageKey     string = storage.outputs.storageKey
output openaiEndpoint string = openai.outputs.openaiEndpoint
output openaiKey      string = openai.outputs.openaiKey
output docIntEndpoint string = docIntelligence.outputs.endpoint
output docIntKey      string = docIntelligence.outputs.key
