import requests

def test_get_webhook_enabled_status():
    base_url = "http://localhost:3001"
    url = f"{base_url}/api/webhook/status"
    headers = {
        "Accept": "application/json"
    }

    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        assert False, f"Request to {url} failed: {e}"

    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not valid JSON"

    assert "enabled" in data, "Response JSON does not contain 'enabled' key"
    assert isinstance(data["enabled"], bool), "'enabled' key should be of boolean type"

test_get_webhook_enabled_status()