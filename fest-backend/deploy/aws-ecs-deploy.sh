#!/usr/bin/env bash
# Deploys the backend to AWS ECS Express Mode (Fargate + HTTPS load balancer) in one command.
# Safe to re-run: the first run creates everything, later runs ship a new image version.
#
#   bash fest-backend/deploy/aws-ecs-deploy.sh
#
# Needs: Docker running, the AWS CLI configured for the target account (aws sts get-caller-identity),
# and fest-backend/.env.production with production values (DATABASE_URL from Neon, etc.).
# Secrets go to SSM Parameter Store as SecureStrings, never into the image or the task definition.
set -euo pipefail
export MSYS_NO_PATHCONV=1

# The AWS account (new Builder ID experience) only allows its project home Region, Sydney.
REGION="${AWS_REGION:-ap-southeast-2}"
SERVICE="fest-backend"
REPO="mvsr-fest-backend"
PARAM_PATH="/fest"
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$BACKEND_DIR/.env.production}"
AWS="${AWS_CLI:-$(command -v aws || echo "/c/Program Files/Amazon/AWSCLIV2/aws.exe")}"
aws_() { "$AWS" --region "$REGION" "$@"; }
# Windows programs (aws, docker, node) need D:/... paths when run from Git Bash; elsewhere this is a no-op.
native() { cygpath -m "$1" 2>/dev/null || echo "$1"; }

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy .env.example and fill in production values)"; exit 1; }
ACCOUNT="$(aws_ sts get-caller-identity --query Account --output text)"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
TAG="$(git -C "$(native "$BACKEND_DIR")" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
IMAGE="$REGISTRY/$REPO:$TAG"
echo "Account $ACCOUNT, region $REGION, image $IMAGE"

# 1. Image: build for x86_64 Fargate and push to a private ECR repository.
aws_ ecr describe-repositories --repository-names "$REPO" >/dev/null 2>&1 ||
    aws_ ecr create-repository --repository-name "$REPO" --image-scanning-configuration scanOnPush=true >/dev/null
aws_ ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker build --platform linux/amd64 -t "$IMAGE" "$(native "$BACKEND_DIR")"
# The image is ~1 GB; retry so a dropped connection doesn't abort the deploy (pushed layers are skipped).
for attempt in 1 2 3 4 5; do
    docker push "$IMAGE" && break
    [ "$attempt" = 5 ] && exit 1
    echo "Push failed, retrying ($attempt/5)..."; sleep 10
done

# 2. Settings: secrets become SecureString parameters; everything else stays a plain env var.
SECRET_KEYS="DATABASE_URL JWT_SECRET ADMIN_SUPER_PASSWORD ADMIN_VOLUNTEER1_PASSWORD ADMIN_VOLUNTEER2_PASSWORD GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY LUMA_API_KEY"
CONTAINER_JSON="$(mktemp)"
node - "$(native "$ENV_FILE")" "$SECRET_KEYS" "$PARAM_PATH" "$REGION" "$ACCOUNT" "$IMAGE" > "$CONTAINER_JSON" <<'NODE'
const fs = require("fs");
const [file, secretKeys, paramPath, region, account, image] = process.argv.slice(2);
const env = {};
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] !== "") env[m[1]] = m[2];
}
const required = ["DATABASE_URL", "JWT_SECRET", "CORS_ORIGIN", "ADMIN_SUPER_EMAIL", "ADMIN_SUPER_PASSWORD"];
const missing = required.filter((k) => !env[k]);
if (missing.length) { console.error("Missing in env file: " + missing.join(", ")); process.exit(1); }
const secretSet = new Set(secretKeys.split(" "));
// Values the container needs regardless of the file; PORT matches containerPort below.
Object.assign(env, { NODE_ENV: "production", HOST: "0.0.0.0", PORT: "3000", TRUST_PROXY: env.TRUST_PROXY || "1" });
const environment = [], secrets = [];
for (const [name, value] of Object.entries(env)) {
    if (/^(BACKEND_PORT|API_HOST_PORT|POSTGRES_)/.test(name)) continue; // docker-compose only
    if (secretSet.has(name)) secrets.push({ name, valueFrom: `arn:aws:ssm:${region}:${account}:parameter${paramPath}/${name}`, value });
    else environment.push({ name, value });
}
process.stdout.write(JSON.stringify({
    image,
    containerPort: 3000,
    // Apply migrations and the idempotent admin/event seeds before serving traffic.
    command: ["sh", "-c", "bunx prisma migrate deploy && bun src/lib/seed.ts && bun src/lib/seedEvents.ts && exec bun src/index.ts"],
    environment,
    secrets,
}));
NODE

node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const s of c.secrets)console.log(s.name+"\t"+s.value)' "$(native "$CONTAINER_JSON")" |
    while IFS=$'\t' read -r name value; do
        aws_ ssm put-parameter --name "$PARAM_PATH/$name" --type SecureString --overwrite --value="$value" >/dev/null
        echo "Stored secret $PARAM_PATH/$name"
    done
# Strip the plaintext values now that they live in Parameter Store.
node -e 'const f=process.argv[1];const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.secrets=c.secrets.map(({name,valueFrom})=>({name,valueFrom}));require("fs").writeFileSync(f,JSON.stringify(c))' "$(native "$CONTAINER_JSON")"

# 3. IAM roles (created once): task execution (pull image, read /fest secrets) and Express infrastructure.
ensure_role() {
    local role="$1" principal="$2" policy="$3"
    if ! aws_ iam get-role --role-name "$role" >/dev/null 2>&1; then
        aws_ iam create-role --role-name "$role" --assume-role-policy-document \
            "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$principal\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
        aws_ iam attach-role-policy --role-name "$role" --policy-arn "$policy"
        CREATED_ROLE=1
    fi
}
CREATED_ROLE=0
ensure_role ecsTaskExecutionRole ecs-tasks.amazonaws.com arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
ensure_role ecsInfrastructureRoleForExpressServices ecs.amazonaws.com arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
aws_ iam put-role-policy --role-name ecsTaskExecutionRole --policy-name fest-read-secrets --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameters\",\"Resource\":\"arn:aws:ssm:$REGION:$ACCOUNT:parameter$PARAM_PATH/*\"}]}"
[ "$CREATED_ROLE" = 1 ] && { echo "Waiting for new IAM roles to propagate..."; sleep 30; }
EXEC_ROLE="arn:aws:iam::$ACCOUNT:role/ecsTaskExecutionRole"
INFRA_ROLE="arn:aws:iam::$ACCOUNT:role/ecsInfrastructureRoleForExpressServices"

# 4. Create the service on the first run, otherwise roll out the new image.
SERVICE_ARN="$(aws_ ecs list-services --cluster default --query "serviceArns[?ends_with(@, '/$SERVICE')] | [0]" --output text 2>/dev/null || true)"
if [ -z "$SERVICE_ARN" ] || [ "$SERVICE_ARN" = "None" ]; then
    echo "Creating Express Mode service $SERVICE..."
    for attempt in 1 2 3; do
        if aws_ ecs create-express-gateway-service \
            --service-name "$SERVICE" \
            --execution-role-arn "$EXEC_ROLE" \
            --infrastructure-role-arn "$INFRA_ROLE" \
            --primary-container "file://$(native "$CONTAINER_JSON")" \
            --cpu 512 --memory 1024 \
            --health-check-path /health \
            --scaling-target '{"minTaskCount":1,"maxTaskCount":2}' \
            --monitor-resources DEPLOYMENT --monitor-mode TEXT-ONLY; then break; fi
        [ "$attempt" = 3 ] && exit 1
        echo "Retrying in 60s (IAM roles can take a minute to become usable)..."; sleep 60
    done
    SERVICE_ARN="$(aws_ ecs list-services --cluster default --query "serviceArns[?ends_with(@, '/$SERVICE')] | [0]" --output text)"
else
    echo "Updating $SERVICE_ARN to $IMAGE..."
    aws_ ecs update-express-gateway-service --service-arn "$SERVICE_ARN" \
        --execution-role-arn "$EXEC_ROLE" --primary-container "file://$(native "$CONTAINER_JSON")" \
        --monitor-resources DEPLOYMENT --monitor-mode TEXT-ONLY
fi
rm -f "$CONTAINER_JSON"

aws_ ecs describe-express-gateway-service --service-arn "$SERVICE_ARN" --output json |
    node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d).service||{};const urls=JSON.stringify(s).match(/[a-z0-9-]+\.ecs\.[a-z0-9-]+\.on\.aws/g)||[];console.log("\nStatus: "+((s.status||{}).statusCode||"?"));console.log("URL:    "+(urls[0]?"https://"+urls[0]:"(see the ECS console)"))})'
