import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_post_toggle_webhook_state():
    url = f"{BASE_URL}/api/webhook/toggle"
    headers = {
        "Content-Type": "application/json"
    }
    payload = {
        "webhookId": "example-webhook-id"
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    assert ('newState' in data and isinstance(data["newState"], bool)) or ('state' in data and isinstance(data["state"], bool)), "Response JSON missing 'newState' or 'state' field with boolean value"

    assert "message" in data, "Response JSON missing 'message' field"
    assert isinstance(data["message"], str), "'message' should be a string"
    assert len(data["message"]) > 0, "'message' should not be empty"

test_post_toggle_webhook_state()
