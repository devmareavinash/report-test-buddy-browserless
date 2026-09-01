# Push local images to ECR and print next ECS console steps.
# Prerequisites: AWS CLI installed + `aws configure` (or SSO login) completed.
#
# Usage (PowerShell):
#   .\infra\ecs\push-to-ecr.ps1 -Region us-east-1

param(
  [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-Error "AWS CLI not found. Install from https://aws.amazon.com/cli/ then re-open the terminal."
}

$Account = aws sts get-caller-identity --query Account --output text
if (-not $Account) { Write-Error "Not logged into AWS. Run: aws configure   OR   aws sso login" }

$Reg = "$Account.dkr.ecr.$Region.amazonaws.com"
Write-Host "Account=$Account  Region=$Region"
Write-Host "Registry=$Reg"

$repos = @(
  "bi-tester-web",
  "bi-tester-backend",
  "bi-tester-snowflake-sso",
  "browserless-chromium"
)

foreach ($r in $repos) {
  aws ecr describe-repositories --repository-names $r --region $Region 2>$null |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating ECR repo $r"
    aws ecr create-repository --repository-name $r --region $Region | Out-Null
  }
}

Write-Host "Logging into ECR..."
aws ecr get-login-password --region $Region |
  docker login --username AWS --password-stdin $Reg

$map = @{
  "reporttestbuddybrwserless-web"           = "bi-tester-web:latest"
  "reporttestbuddybrwserless-backend"       = "bi-tester-backend:latest"
  "reporttestbuddybrwserless-snowflake-sso" = "bi-tester-snowflake-sso:latest"
  "ghcr.io/browserless/chromium:v2.55.4"    = "browserless-chromium:v2.55.4"
}

foreach ($local in $map.Keys) {
  $remote = "$Reg/$($map[$local])"
  Write-Host "Tag + push $local -> $remote"
  docker tag $local $remote
  docker push $remote
}

Write-Host ""
Write-Host "Done. Images are in ECR."
Write-Host "Next: create Secrets Manager secret rtb/prod, then ECS cluster/service using infra/ecs/task-definition.json"
Write-Host "Replace ACCOUNT_ID=$Account and REGION=$Region in that JSON."
