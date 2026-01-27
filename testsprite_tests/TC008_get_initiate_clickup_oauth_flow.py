import requests

def test_get_initiate_clickup_oauth_flow():
    base_url = "http://localhost:3001"
    url = f"{base_url}/auth/clickup"
    timeout = 30
    try:
        response = requests.get(url, timeout=timeout, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Request to {url} failed with exception: {str(e)}"
    
    assert response.status_code == 302, f"Expected status code 302, got {response.status_code}"
    location = response.headers.get("Location")
    assert location is not None, "Response missing 'Location' header for redirect"
    # Validate that the redirect is to ClickUp authorization URL (basic check)
    assert "clickup.com" in location.lower() and "oauth" in location.lower(), \
        f"Redirect location does not appear to be a ClickUp OAuth URL: {location}"

test_get_initiate_clickup_oauth_flow()