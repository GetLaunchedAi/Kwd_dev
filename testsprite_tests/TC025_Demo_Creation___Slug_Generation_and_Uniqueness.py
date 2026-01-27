import requests
import time
import string
import random

BASE_URL = "http://localhost:3001"
HEADERS = {
    "Content-Type": "application/json"
}
TIMEOUT = 30

def random_business_name():
    return "Test Business " + "".join(random.choices(string.ascii_letters + string.digits, k=6))

def slug_exists(slug):
    """Helper to check if a slug is already taken or reserved using check-slug endpoint."""
    try:
        response = requests.get(f"{BASE_URL}/api/demo/check-slug", params={"slug": slug}, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
        data = response.json()
        return not data.get("available", False)
    except requests.RequestException:
        return False

def create_demo(business_name, manual_slug=None):
    """Helper to create a demo with optional manual slug."""
    payload = {
        "businessName": business_name,
        "primaryColor": "#123456",
        "templateId": "default-template-id"
    }
    if manual_slug is not None:
        payload["slug"] = manual_slug

    response = requests.post(f"{BASE_URL}/api/demo/create", json=payload, headers=HEADERS, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()

def delete_demo(slug):
    """Helper to delete a demo by slug, assuming such endpoint exists."""
    try:
        resp = requests.delete(f"{BASE_URL}/api/demo/{slug}", headers=HEADERS, timeout=TIMEOUT)
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()
    except requests.RequestException:
        pass

def test_TC025_slug_generation_and_uniqueness():
    # Test slug normalization and generated slug pattern
    business_name = "My Business! Inc."
    slug1 = None
    slug2 = None
    result_manual = None
    slug_manual2 = None
    try:
        result = create_demo(business_name)
        assert "clientSlug" in result, "Response missing clientSlug"
        slug1 = result["clientSlug"]
        assert all(c.islower() or c.isdigit() or c == '-' for c in slug1), "Slug contains invalid characters"
        assert slug1 == slug1.strip("-"), "Slug has leading/trailing hyphens"

        # Test that slug is URL-safe (no spaces, special chars)
        assert " " not in slug1 and "!" not in slug1, "Slug contains spaces or invalid characters"

        # Test uniqueness: attempt to create a demo with same business name should yield different slug
        result2 = create_demo(business_name)
        slug2 = result2["clientSlug"]
        assert slug2 != slug1, "Slug was not made unique on duplicate business name"
        assert slug2.startswith(slug1.split("-")[0]) or slug2.startswith(slug1), "Unique slug suffix incorrect"

        # Test reserved slug handling by trying a reserved slug manually
        reserved_slugs = ["admin", "api", "login", "signup"]
        for reserved_slug in reserved_slugs:
            response = None
            try:
                # Attempt to create a demo with reserved slug - should error or force unique suffix
                response = requests.post(f"{BASE_URL}/api/demo/create",
                                         json={"businessName": "Reserved Business", "slug": reserved_slug, "primaryColor": "#123456", "templateId": "default-template-id"},
                                         headers=HEADERS, timeout=TIMEOUT)
                # It might return 400 or generate a modified slug - handle both
                if response.status_code == 400:
                    resp_json = response.json()
                    assert "slug" in resp_json.get("errors", {}) or "slug" in resp_json.get("message", "").lower(), f"Expected slug error for reserved slug '{reserved_slug}'"
                elif response.status_code == 200:
                    resp_json = response.json()
                    actual_slug = resp_json.get("clientSlug", "")
                    assert actual_slug != reserved_slug, f"Reserved slug '{reserved_slug}' was allowed as is"
                    assert slug_exists(actual_slug), f"Slug '{actual_slug}' from reserved slug test should exist"
                else:
                    response.raise_for_status()
            finally:
                # Cleanup demo if created with reserved slug
                try:
                    if response is not None:
                        resp_json = response.json()
                        if "clientSlug" in resp_json:
                            delete_demo(resp_json["clientSlug"])
                except Exception:
                    pass

        # Test deterministic slug generation for manual slug
        manual_slug = "custom-slug-123"
        result_manual = create_demo(business_name="Another Business", manual_slug=manual_slug)
        assert result_manual.get("clientSlug") == manual_slug, "Manual slug was not used deterministically"

        # Try creating again with same manual slug to check uniqueness suffix appended
        result_manual2 = create_demo(business_name="Another Business", manual_slug=manual_slug)
        slug_manual2 = result_manual2.get("clientSlug")
        assert slug_manual2 != manual_slug, "Slug uniqueness suffix not appended for duplicate manual slug"
        assert slug_manual2.startswith(manual_slug), "Slug uniqueness suffix format incorrect for manual slug"

    finally:
        # Cleanup created demos
        if slug1:
            delete_demo(slug1)
        if slug2:
            delete_demo(slug2)
        if result_manual and "clientSlug" in result_manual:
            delete_demo(result_manual["clientSlug"])
        if slug_manual2:
            delete_demo(slug_manual2)

test_TC025_slug_generation_and_uniqueness()
