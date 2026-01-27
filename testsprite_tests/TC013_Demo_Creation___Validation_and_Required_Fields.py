import requests
import re

BASE_URL = "http://localhost:3001"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_demo_creation_validation_and_required_fields():
    # Utility functions
    def check_slug_availability(slug):
        r = requests.get(f"{BASE_URL}/api/demo/check-slug", params={"slug": slug}, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()

    def create_demo(payload):
        return requests.post(f"{BASE_URL}/api/demo/create", json=payload, headers=HEADERS, timeout=TIMEOUT)

    def delete_demo(slug):
        # Assuming there is a DELETE endpoint to cleanup demos, fallback to pass if not exists
        try:
            requests.delete(f"{BASE_URL}/api/demo/{slug}", timeout=TIMEOUT)
        except Exception:
            pass

    # Test data for failures and valid cases
    valid_business_name = "Test Business"
    valid_primary_color = "#aabbcc"
    invalid_primary_color = "zzzzzz"
    valid_template_id = "template123"
    valid_github_repo_url = "https://github.com/public/repo"
    invalid_slug = "Invalid Slug!"
    valid_slug = "valid-slug-001"  # will check availability and alter if needed

    # 1. Validate required fields: missing businessName
    payload_missing_business_name = {
        "primaryColor": valid_primary_color,
        "templateId": valid_template_id,
        "slug": "missing-businessname"
    }
    r = create_demo(payload_missing_business_name)
    assert r.status_code == 400
    assert "businessName" in r.text or "required" in r.text.lower()

    # 2. Validate required fields: missing primaryColor
    payload_missing_primary_color = {
        "businessName": valid_business_name,
        "templateId": valid_template_id,
        "slug": "missing-primarycolor"
    }
    r = create_demo(payload_missing_primary_color)
    assert r.status_code == 400
    assert "primaryColor" in r.text or "required" in r.text.lower()

    # 3. Validate required fields: missing templateId and githubRepoUrl (one must be present)
    payload_missing_source = {
        "businessName": valid_business_name,
        "primaryColor": valid_primary_color,
        "slug": "missing-source"
    }
    r = create_demo(payload_missing_source)
    assert r.status_code == 400
    assert ("templateId" in r.text or "githubRepoUrl" in r.text or "required" in r.text.lower())

    # 4. Validate hex color format - invalid color
    payload_invalid_color = {
        "businessName": valid_business_name,
        "primaryColor": invalid_primary_color,
        "templateId": valid_template_id,
        "slug": "invalid-color"
    }
    r = create_demo(payload_invalid_color)
    assert r.status_code == 400
    # Expect error about invalid color format
    assert re.search(r"hex.*color", r.text, re.I)

    # 5. Validate slug pattern - invalid slug
    payload_invalid_slug = {
        "businessName": valid_business_name,
        "primaryColor": valid_primary_color,
        "templateId": valid_template_id,
        "slug": invalid_slug
    }
    r = create_demo(payload_invalid_slug)
    assert r.status_code == 400
    # Expect error about slug pattern invalid
    assert re.search(r"slug.*pattern", r.text, re.I)

    # 6. Check slug availability to prevent race conditions
    # Use valid slug; if already taken, append suffix until available
    slug = valid_slug
    suffix = 0
    availability = check_slug_availability(slug)
    while not availability.get("available", False):
        suffix += 1
        slug = f"{valid_slug}-{suffix}"
        availability = check_slug_availability(slug)

    payload_valid = {
        "businessName": valid_business_name,
        "primaryColor": valid_primary_color,
        "templateId": valid_template_id,
        "slug": slug
    }

    # Successful creation should not return 400 here, but this test focuses on validation so we do not assert success.
    # But we still create the demo to test race condition prevention.
    try:
        r = create_demo(payload_valid)
        # API may return 200 or 202 for accepted
        assert r.status_code in (200, 201, 202), f"Unexpected success status code: {r.status_code}"
        body = r.json()
        # Confirm returned slug matches requested slug
        assert body.get("slug") == slug

        # Immediately try to create again with same slug to simulate race condition
        r2 = create_demo(payload_valid)
        # Expect failure due to slug taken
        assert r2.status_code in (400, 409, 422)
        assert re.search(r"slug", r2.text, re.I)
    finally:
        # Clean up created demo if possible
        delete_demo(slug)

test_demo_creation_validation_and_required_fields()
