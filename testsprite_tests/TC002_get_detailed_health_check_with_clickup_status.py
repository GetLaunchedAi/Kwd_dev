import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_get_detailed_health_check_with_clickup_status():
    url = f"{BASE_URL}/api/health"
    headers = {
        "Accept": "application/json"
    }
    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request to {url} failed with exception: {e}"

    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
    try:
        data = response.json()
    except ValueError:
        assert False, "Response is not in JSON format"

    # Validate expected keys in the response for detailed health status
    assert isinstance(data, dict), "Response JSON is not a dictionary"

    # Check for 'clickup' key and structure
    assert "clickup" in data, "'clickup' key missing in response"
    clickup_status = data["clickup"]
    assert isinstance(clickup_status, dict), "'clickup' field is not an object"
    assert "status" in clickup_status, "'status' missing in clickup data"
    connection_status = clickup_status["status"]
    assert isinstance(connection_status, str), "'status' should be a string"

    # Check for 'timestamp' key
    assert "timestamp" in data, "'timestamp' key missing in response"
    timestamp = data["timestamp"]
    assert isinstance(timestamp, str), "'timestamp' should be a string"

test_get_detailed_health_check_with_clickup_status()
