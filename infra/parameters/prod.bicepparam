// infra/parameters/prod.bicepparam
// Production environment parameter values.

using '../main.bicep'

param environment = 'prod'
param location = 'southafricanorth'
// TODO: pin resourceSuffix to a stable value in prod to prevent resource renames on re-deploy
// param resourceSuffix = 'neriah'
