import requests

def test_post_disable_webhook():
    base_url = "http://localhost:3001"
    url = f"{base_url}/api/webhook/disable"
    headers = {
        "Content-Type": "application/json"
    }
    timeout = 30
    try:
        response = requests.post(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        # Assert status code is 200
        assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
        # Assert response content confirms the action (assuming JSON with message or status)
        json_resp = response.json()
        assert isinstance(json_resp, dict), "Response is not a JSON object"
        # Check for a confirming key or message
        confirmation_keys = ["message", "status", "success"]
        assert any(key in json_resp for key in confirmation_keys), "Response missing confirmation message or status"
        # If message exists, check it contains disable-related text
        message = json_resp.get("message") or ""
        status = json_resp.get("status") or ""
        success = json_resp.get("success")
        assert ("disable" in message.lower() or "disabled" in message.lower() or 
                "disable" in status.lower() or success is True), "Response does not confirm webhook was disabled"
    except requests.exceptions.RequestException as e:
        assert False, f"Request failed: {e}"

test_post_disable_webhook()