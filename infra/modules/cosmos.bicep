param location string
param accountName string
param databaseName string = 'neriah'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }]
    capabilities: [{ name: 'EnableServerless' }]
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-04-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: { resource: { id: databaseName } }
}

var containers = [
  { name: 'teachers',           partitionKey: '/phone' }
  { name: 'classes',            partitionKey: '/teacher_id' }
  { name: 'students',           partitionKey: '/class_id' }
  { name: 'answer_keys',        partitionKey: '/class_id' }
  { name: 'marks',              partitionKey: '/student_id' }
  { name: 'sessions',           partitionKey: '/phone' }
  { name: 'rubrics',            partitionKey: '/class_id' }
  { name: 'submissions',        partitionKey: '/student_id' }
  { name: 'submission_codes',   partitionKey: '/class_id' }
  { name: 'otp_verifications',  partitionKey: '/phone' }
  { name: 'schools',            partitionKey: '/id' }
]

resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-04-15' = [for c in containers: {
  parent: database
  name: c.name
  properties: {
    resource: {
      id: c.name
      partitionKey: { paths: [c.partitionKey], kind: 'Hash' }
      defaultTtl: c.name == 'sessions' ? 86400 : c.name == 'otp_verifications' ? 600 : -1
    }
  }
}]

output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosKey string = cosmosAccount.listKeys().primaryMasterKey
