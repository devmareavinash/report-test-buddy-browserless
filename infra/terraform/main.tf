// Skeleton — see infra/README.md for the full architecture.
// Modules are intentionally left as stubs; fill in per-environment values.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

module "network"             { source = "./modules/network" }
module "rds"                 { source = "./modules/rds"                 vpc = module.network }
module "cognito"             { source = "./modules/cognito" }
module "s3_artifacts"        { source = "./modules/s3-artifacts" }
module "secretsmanager"      { source = "./modules/secretsmanager" }
module "sqs"                 { source = "./modules/sqs" }
module "lambda_orchestrator" { source = "./modules/lambda-orchestrator" rds = module.rds queue = module.sqs }
module "fargate_playwright"  { source = "./modules/fargate-playwright"  vpc = module.network artifacts = module.s3_artifacts }
module "eventbridge"         { source = "./modules/eventbridge"         orchestrator = module.lambda_orchestrator }
