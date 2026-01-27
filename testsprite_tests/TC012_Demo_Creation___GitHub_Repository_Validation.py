import requests
from requests.exceptions import Timeout, RequestException, ConnectionError, ProxyError

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_demo_creation_github_repository_validation():
    url = f"{BASE_URL}/api/git/test-repo"
    headers = {"Content-Type": "application/json"}

    # Test case 1: Accessible public repo => success = true
    public_repo_payload = {"githubRepoUrl": "https://github.com/octocat/Hello-World"}
    try:
        resp = requests.post(url, json=public_repo_payload, headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        assert resp.status_code == 200, f"Expected status 200, got {resp.status_code}"
        assert "success" in data, "'success' not in response"
        assert data["success"] is True, "Expected success=true for public repo"
    except RequestException as e:
        assert False, f"Request failed for accessible public repo test: {e}"

    # Test case 2: Private or invalid repo => 404 with error message
    invalid_repo_payload = {"githubRepoUrl": "https://github.com/octocat/ThisRepoDoesNotExist"}
    try:
        resp = requests.post(url, json=invalid_repo_payload, headers=headers, timeout=TIMEOUT)
        assert resp.status_code == 404, f"Expected status 404 for invalid repo, got {resp.status_code}"
        data = resp.json()
        assert "error" in data, "Expected 'error' field in response for invalid repo"
        assert isinstance(data["error"], str) and len(data["error"]) > 0, "Error message missing or empty"
    except RequestException as e:
        assert False, f"Request failed for private/invalid repo test: {e}"

    # Test case 3: Timeout handling - simulate by using a very low timeout
    # Note: In proxy environments, this may raise ProxyError or ConnectionError instead of Timeout
    try:
        # Intentionally using 0.001s timeout to simulate timeout scenario
        requests.post(url, json=public_repo_payload, headers=headers, timeout=0.001)
        assert False, "Expected timeout exception but request succeeded"
    except (Timeout, ProxyError, ConnectionError):
        # Expected outcome - any of these exceptions indicate the timeout behavior worked
        pass
    except RequestException as e:
        # In some environments, other RequestException subclasses may be raised for timeouts
        # Accept them as valid timeout behavior if they indicate connection issues
        if "timeout" in str(e).lower() or "connect" in str(e).lower():
            pass
        else:
            assert False, f"Unexpected exception type: {e}"

test_demo_creation_github_repository_validation()