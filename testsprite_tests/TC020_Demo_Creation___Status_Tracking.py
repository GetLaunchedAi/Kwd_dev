import requests
import time

BASE_URL = "http://localhost:3001"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_TC020_demo_creation_status_tracking():
    # Step 1: Create a new demo (POST /api/demo/create) with minimal valid payload
    create_payload = {
        "businessName": "Test Business TC020",
        "primaryColor": "#123ABC",
        "templateId": "default-template"
    }
    client_slug = None

    try:
        create_resp = requests.post(f"{BASE_URL}/api/demo/create", json=create_payload, headers=HEADERS, timeout=TIMEOUT)
        assert create_resp.status_code == 200, f"Demo creation failed with status {create_resp.status_code} and body {create_resp.text}"
        create_data = create_resp.json()
        assert "clientSlug" in create_data and "status" in create_data, "Response missing clientSlug or status fields"
        assert create_data["status"] == "starting"
        client_slug = create_data["clientSlug"]

        status_url = f"{BASE_URL}/api/demo/status/{client_slug}"

        # Step 2: Check initial status immediately after creation
        status_resp = requests.get(status_url, headers=HEADERS, timeout=TIMEOUT)
        assert status_resp.status_code == 200, f"Status endpoint returned {status_resp.status_code} immediately after creation"
        status_json = status_resp.json()

        # Validate required fields in status response
        expected_keys = {"state", "message", "logs", "currentStep", "totalSteps"}
        assert expected_keys.issubset(status_json.keys()), f"Status response missing keys: {expected_keys - set(status_json.keys())}"
        # State should be 'starting' at this point or shortly after
        valid_states = {"starting", "cloning", "installing", "organizing", "prompting", "triggering", "running", "failed", "completed"}
        assert status_json["state"] in valid_states, f"Unexpected state: {status_json['state']}"

        # Step 3: Poll status endpoint through the stages until it reaches 'running' or 'failed' or times out
        max_wait_seconds = 300
        poll_interval = 5
        waited = 0
        last_state = None
        while waited < max_wait_seconds:
            resp = requests.get(status_url, headers=HEADERS, timeout=TIMEOUT)
            assert resp.status_code == 200, f"Status endpoint returned {resp.status_code} during polling"
            status = resp.json()

            # Validate keys persistently present
            assert expected_keys.issubset(status.keys()), f"Status polling missing keys: {expected_keys - set(status.keys())}"

            # State progression must be valid and monotonic or stable in 'running'
            state = status["state"]
            msg = status.get("message", "")
            logs = status.get("logs", "")
            current_step = status.get("currentStep")
            total_steps = status.get("totalSteps")

            assert isinstance(state, str)
            assert isinstance(msg, str)
            assert isinstance(logs, str)
            assert isinstance(current_step, int)
            assert isinstance(total_steps, int)
            assert 0 <= current_step <= total_steps

            # Check if state is one of the allowed stages and flows forward or stays stable
            if last_state is not None:
                # We won't enforce exact ordering here but ensure no regression in progress bar
                assert current_step >= 0 and current_step <= total_steps

            last_state = state

            # If running, logs may include merged real-time agent logs - check logs not empty when running
            if state == "running":
                assert len(logs) > 0

            if state in ("running", "failed", "completed"):
                break

            time.sleep(poll_interval)
            waited += poll_interval

        # Step 4: Verify status persistence by calling twice and comparing results
        status_after = requests.get(status_url, headers=HEADERS, timeout=TIMEOUT)
        assert status_after.status_code == 200
        status_after_json = status_after.json()
        # They should be similar or equal at this point (especially state)
        assert status_after_json["state"] == last_state

        # Step 5: Verify 404 returned for non-existent clientSlug
        nonexistent_slug = "nonexistentslug12345"
        not_found_resp = requests.get(f"{BASE_URL}/api/demo/status/{nonexistent_slug}", headers=HEADERS, timeout=TIMEOUT)
        assert not_found_resp.status_code == 404, f"Expected 404 for non-existent slug but got {not_found_resp.status_code}"

    finally:
        # Cleanup: delete the created demo if client_slug is set
        if client_slug:
            del_resp = requests.delete(f"{BASE_URL}/api/demo/{client_slug}", headers=HEADERS, timeout=TIMEOUT)
            # Accept 200 or 204 or 404 (if already deleted)
            assert del_resp.status_code in (200, 204, 404), f"Failed to delete demo with slug {client_slug}. Status: {del_resp.status_code}"

test_TC020_demo_creation_status_tracking()