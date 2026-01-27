import requests
import time

BASE_URL = "http://localhost:3001"
DEMOS_ENDPOINT = "/api/demo/create"
CHECK_SLUG_ENDPOINT = "/api/demo/check-slug"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30


def test_demo_creation_initial_response_and_background_processing():
    import uuid

    # Generate a unique slug to avoid conflicts
    unique_slug = f"testclient-{uuid.uuid4().hex[:8]}"

    # Prepare valid payload for demo creation
    payload = {
        "businessName": "Test Business Inc.",
        "primaryColor": "#123ABC",
        "templateId": "template-001",
        "clientSlug": unique_slug
    }

    # Step 1: Check that slug is available before creation to avoid race conditions (based on PRD validation criteria)
    try:
        r_check = requests.get(
            f"{BASE_URL}{CHECK_SLUG_ENDPOINT}",
            params={"slug": unique_slug},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        r_check.raise_for_status()
        resp_check = r_check.json()
        assert "available" in resp_check
        assert resp_check["available"] is True, f"Slug {unique_slug} unexpectedly already exists"
    except requests.RequestException as e:
        assert False, f"Failed to check slug availability: {str(e)}"
    except AssertionError as e:
        assert False, str(e)

    client_slug_created = None

    try:
        # Step 2: POST to create demo, expect immediate HTTP 200 with status='starting' and clientSlug
        resp = requests.post(
            f"{BASE_URL}{DEMOS_ENDPOINT}",
            json=payload,
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        # Assert immediate HTTP 200
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        resp_json = resp.json()
        # Validate response keys and values
        assert "clientSlug" in resp_json, "Response missing 'clientSlug'"
        assert "status" in resp_json, "Response missing 'status'"
        assert resp_json["clientSlug"] == unique_slug, "Returned clientSlug does not match request"
        assert resp_json["status"] == "starting", f"Expected status 'starting', got {resp_json['status']}"
        client_slug_created = resp_json["clientSlug"]

        # Step 3: Background processing starts without blocking response. 
        # Because it is background, simulate waiting and polling status endpoint to verify it progresses.
        # We expect the demo creation background process eventually changes status from 'starting' to other states.

        STATUS_ENDPOINT = f"{BASE_URL}/api/demo/status/{client_slug_created}"

        # Poll status endpoint up to 2 minutes waiting for status not 'starting' (allowing background task processing)
        # We'll try every 5 seconds.
        max_wait_secs = 120
        poll_interval = 5
        elapsed = 0
        last_status = None
        while elapsed < max_wait_secs:
            try:
                r_status = requests.get(STATUS_ENDPOINT, timeout=TIMEOUT)
                if r_status.status_code == 200:
                    status_json = r_status.json()
                    last_status = status_json.get("state") or status_json.get("status") or status_json.get("status")
                    if last_status and last_status != "starting":
                        break  # Background process has progressed
                else:
                    # If 404, demo might not be immediately available - continue waiting
                    if r_status.status_code == 404:
                        pass
                    else:
                        assert False, f"Unexpected status code polling demo status: {r_status.status_code}"
            except requests.RequestException:
                # Ignore transient errors during polling
                pass
            time.sleep(poll_interval)
            elapsed += poll_interval

        # Step 4: Assert that background process moved demo status beyond 'starting' (or at least status endpoint returns valid response)
        assert last_status is not None, "Did not get any status response from background processing"
        assert last_status != "starting", f"Background demo creation process did not start properly, status: {last_status}"

    finally:
        # Cleanup: Delete the created demo resource to avoid test pollution
        # Assuming there is a DELETE endpoint to remove demo by clientSlug (not in PRD, so skip if not)
        if client_slug_created:
            try:
                del_resp = requests.delete(
                    f"{BASE_URL}/api/demo/{client_slug_created}",
                    headers=HEADERS,
                    timeout=TIMEOUT,
                )
                # Accept success or 404 (already deleted)
                assert del_resp.status_code in (200, 204, 404), f"Cleanup failed with status {del_resp.status_code}"
            except requests.RequestException:
                pass  # Ignore cleanup errors


test_demo_creation_initial_response_and_background_processing()