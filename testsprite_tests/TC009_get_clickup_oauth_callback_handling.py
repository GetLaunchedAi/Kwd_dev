import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_get_clickup_oauth_callback_handling():
    # Test success case with 'code' query parameter
    params_success = {'code': 'valid_oauth_code_example'}
    try:
        response = requests.get(f"{BASE_URL}/auth/clickup/callback", params=params_success, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected 200 OK on success, got {response.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed during success case: {e}"

    # Test error case with 'error' query parameter
    params_error = {'error': 'access_denied'}
    try:
        response = requests.get(f"{BASE_URL}/auth/clickup/callback", params=params_error, timeout=TIMEOUT)
        assert response.status_code == 400, f"Expected 400 Bad Request on error, got {response.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed during error case: {e}"

    # Test edge case with both 'code' and 'error' parameters set (should treat as error)
    params_conflict = {'code': 'somecode', 'error': 'someerror'}
    try:
        response = requests.get(f"{BASE_URL}/auth/clickup/callback", params=params_conflict, timeout=TIMEOUT)
        # Assuming error has priority, expect 400
        assert response.status_code == 400, f"Expected 400 Bad Request when both code and error present, got {response.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed during conflict case: {e}"

    # Test case with neither 'code' nor 'error' params (likely invalid request, expect 400)
    try:
        response = requests.get(f"{BASE_URL}/auth/clickup/callback", timeout=TIMEOUT)
        assert response.status_code == 400, f"Expected 400 Bad Request when no query params, got {response.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed during missing params case: {e}"

test_get_clickup_oauth_callback_handling()