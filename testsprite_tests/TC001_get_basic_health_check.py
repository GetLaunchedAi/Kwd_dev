import requests

def test_get_basic_health_check():
    base_url = "http://localhost:3001"
    url = f"{base_url}/health"
    headers = {'Accept': 'application/json'}
    timeout = 30

    try:
        response = requests.get(url, headers=headers, timeout=timeout)
        # Validate HTTP status code
        assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

        json_response = response.json()
        # Validate required fields exist
        assert "status" in json_response, "'status' field missing in response"
        assert "timestamp" in json_response, "'timestamp' field missing in response"
        # Validate 'status' is not empty and is a string
        assert isinstance(json_response["status"], str) and json_response["status"], "'status' field should be a non-empty string"
        # Validate 'timestamp' is a string (Further datetime format validation can be added if needed)
        assert isinstance(json_response["timestamp"], str) and json_response["timestamp"], "'timestamp' field should be a non-empty string"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    except ValueError:
        assert False, "Response is not valid JSON"

test_get_basic_health_check()