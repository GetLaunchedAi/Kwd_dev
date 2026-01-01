#!/bin/bash
# Simple script to create ClickUp webhook via curl
# Usage: ./create-webhook.sh

# Load .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get access token (try OAuth token file first, then env vars)
TOKEN=""
if [ -f "tokens/clickup-access-token.json" ]; then
    TOKEN=$(cat tokens/clickup-access-token.json | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
fi

if [ -z "$TOKEN" ]; then
    TOKEN=$CLICKUP_ACCESS_TOKEN
fi

if [ -z "$TOKEN" ]; then
    TOKEN=$CLICKUP_API_TOKEN
fi

if [ -z "$TOKEN" ]; then
    echo "❌ No access token found!"
    echo "Please authorize OAuth first or set CLICKUP_API_TOKEN in .env"
    exit 1
fi

echo "✓ Got access token"

# Get Team ID
if [ -z "$CLICKUP_TEAM_ID" ]; then
    echo "Fetching teams to get Team ID..."
    TEAM_RESPONSE=$(curl -s --request GET \
        --url https://api.clickup.com/api/v2/team \
        --header "Authorization: $TOKEN")
    
    CLICKUP_TEAM_ID=$(echo $TEAM_RESPONSE | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
    
    if [ -z "$CLICKUP_TEAM_ID" ]; then
        echo "❌ Could not get Team ID"
        exit 1
    fi
    echo "✓ Using Team ID: $CLICKUP_TEAM_ID"
else
    echo "✓ Using Team ID: $CLICKUP_TEAM_ID"
fi

# Create webhook
echo ""
echo "Creating webhook..."

WEBHOOK_URL="https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup"

RESPONSE=$(curl -s --request POST \
    --url "https://api.clickup.com/api/v2/team/$CLICKUP_TEAM_ID/webhook" \
    --header "Authorization: $TOKEN" \
    --header "Content-Type: application/json" \
    --data "{
        \"endpoint\": \"$WEBHOOK_URL\",
        \"client_id\": \"$CLICKUP_CLIENT_ID\",
        \"events\": [\"taskStatusUpdated\", \"taskUpdated\"],
        \"task_id\": null,
        \"list_id\": null,
        \"folder_id\": null,
        \"space_id\": null,
        \"health\": {
            \"status\": \"active\"
        }
    }")

echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

WEBHOOK_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ ! -z "$WEBHOOK_ID" ]; then
    echo ""
    echo "✅ Webhook created successfully!"
    echo "Webhook ID: $WEBHOOK_ID"
else
    echo "⚠️ Check the response above for details"
fi




