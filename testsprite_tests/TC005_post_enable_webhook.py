import requests

def test_post_enable_webhook():
    base_url = "http://localhost:3001"
    url = f"{base_url}/api/webhook/enable"
    headers = {
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(url, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Request to enable webhook failed: {e}"

    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
    # Assuming that the response JSON contains a confirmation message or status field
    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    # Check if confirmation/action field exists and indicates success
    assert (
        "message" in data or "status" in data or "enabled" in data
    ), "Response JSON does not contain expected confirmation fields"
    # If 'enabled' field is present, it should be True
    if "enabled" in data:
        assert data["enabled"] is True, "Webhook enabled flag is not True"
    if "status" in data:
        assert data["status"].lower() in ["enabled", "success", "ok"], f"Unexpected status value: {data['status']}"
    if "message" in data:
        assert isinstance(data["message"], str) and len(data["message"]) > 0, "Message field is empty or invalid"

test_post_enable_webhook()