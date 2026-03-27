param location string
param storageAccountName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

var containers = ['scans', 'marked']

resource blobContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = [for c in containers: {
  parent: blobService
  name: c
  properties: { publicAccess: 'None' }
}]

output storageAccountName string = storageAccount.name
output storageKey string = storageAccount.listKeys().keys[0].value
