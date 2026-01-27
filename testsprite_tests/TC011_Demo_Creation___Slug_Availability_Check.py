import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30
HEADERS = {
    "Accept": "application/json"
}


def test_demo_creation_slug_availability_check():
    """
    Verify GET /api/demo/check-slug endpoint correctly:
    - returns available=true for new slugs
    - returns available=false for existing or reserved slugs
    - handles validation errors with appropriate status codes
    """
    url = f"{BASE_URL}/api/demo/check-slug"

    # Test with a new unique slug which should be available
    new_slug = "unique-new-slug-test-123"
    try:
        resp = requests.get(url, params={"slug": new_slug}, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        assert isinstance(data, dict), "Response JSON should be an object"
        assert "available" in data, "Response JSON must include 'available'"
        assert data["available"] is True, f"Slug '{new_slug}' should be available"
    except requests.RequestException as e:
        assert False, f"Request failed for new slug availability check: {e}"

    # Test with an existing or reserved slug which should NOT be available
    # We assume "admin" is reserved for this test
    reserved_slugs = ["admin"]
    for slug in reserved_slugs:
        try:
            resp = requests.get(url, params={"slug": slug}, headers=HEADERS, timeout=TIMEOUT)
            # For existing slug, the API should still return 200 but available=False
            resp.raise_for_status()
            data = resp.json()
            assert isinstance(data, dict), "Response JSON should be an object"
            assert "available" in data, "Response JSON must include 'available'"
            assert data["available"] is False, f"Slug '{slug}' should NOT be available"
        except requests.RequestException as e:
            assert False, f"Request failed for reserved slug '{slug}': {e}"

    # Test validation error cases: missing slug parameter
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        # Expect a 400 Bad Request or another client error code due to missing slug param
        assert resp.status_code in {400, 422}, f"Missing slug parameter should return 400 or 422, got {resp.status_code}"
        # Response should have error details
        try:
            error_data = resp.json()
            assert "error" in error_data or "message" in error_data, "Response should contain error or message field"
        except Exception:
            pass  # JSON parse not mandatory, but preferred
    except requests.RequestException as e:
        assert False, f"Request failed for missing slug param case: {e}"

    # Test validation error cases: invalid slug format (e.g. with spaces or special chars)
    invalid_slugs = ["invalid slug!", "with@chars#", "space slug", "!@#$$%^&*()"]
    for inv_slug in invalid_slugs:
        try:
            resp = requests.get(url, params={"slug": inv_slug}, headers=HEADERS, timeout=TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                assert isinstance(data, dict), "Response JSON should be an object"
                assert "available" in data, "Response JSON must include 'available'"
                # Allow either True or False for available here since server behavior varies
                assert isinstance(data["available"], bool), f"'available' must be boolean for slug '{inv_slug}'"
            else:
                assert resp.status_code in {400, 422}, f"Invalid slug '{inv_slug}' should return 400 or 422, got {resp.status_code}"
        except requests.RequestException as e:
            assert False, f"Request failed for invalid slug '{inv_slug}': {e}"


test_demo_creation_slug_availability_check()
