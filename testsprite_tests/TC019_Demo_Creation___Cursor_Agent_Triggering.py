import requests
import time

BASE_URL = "http://localhost:3001"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_demo_creation_cursor_agent_triggering():
    # Define the payload for creating a demo
    payload = {
        "businessName": "Cursor Agent Demo Test Business",
        "primaryColor": "#123abc",
        "templateId": "default-template"
    }

    created_slug = None

    try:
        # 1. Create a demo via POST /api/demo/create
        create_resp = requests.post(
            f"{BASE_URL}/api/demo/create",
            json=payload,
            headers=HEADERS,
            timeout=TIMEOUT
        )
        assert create_resp.status_code == 200, f"Expected 200 OK on demo create, got {create_resp.status_code}"
        create_data = create_resp.json()
        assert "clientSlug" in create_data, "Response missing 'clientSlug'"
        assert "status" in create_data, "Response missing 'status'"
        assert create_data["status"] == "starting", f"Expected initial status 'starting', got '{create_data['status']}'"
        created_slug = create_data["clientSlug"]

        # 2. Wait and poll demo status until it reaches 'triggering' stage
        max_wait = 150  # seconds
        interval = 5
        status_resp = None
        current_status = None
        start_time = time.time()
        while time.time() - start_time < max_wait:
            status_resp = requests.get(
                f"{BASE_URL}/api/demo/status/{created_slug}",
                headers=HEADERS,
                timeout=TIMEOUT
            )
            if status_resp.status_code == 200:
                status_data = status_resp.json()
                current_status = status_data.get("state")
                if current_status in ("triggering", "running"):
                    break
            time.sleep(interval)
        else:
            assert False, f"Timeout waiting for demo status to reach 'triggering' or 'running', last status: {current_status}"

        # 3. Verify that after triggering, status transitions to 'running'
        # Poll until running or timeout
        running_status = None
        start_time = time.time()
        while time.time() - start_time < max_wait:
            status_resp = requests.get(
                f"{BASE_URL}/api/demo/status/{created_slug}",
                headers=HEADERS,
                timeout=TIMEOUT
            )
            assert status_resp.status_code == 200, f"Status check HTTP error {status_resp.status_code}"
            status_data = status_resp.json()
            state = status_data.get("state")
            if state == "running":
                running_status = status_data
                break
            elif state == "failed":
                # Check error message presence
                error_msg = status_data.get("message", "")
                assert error_msg, "Status failed but no error message present"
                raise AssertionError(f"Agent trigger failed with error: {error_msg}")
            time.sleep(interval)
        else:
            assert False, "Timeout waiting for demo to reach 'running' state"

        # 4. Verify task state includes baseCommitHash and branchName
        # Assuming these appear in status response under 'taskState'
        task_state = running_status.get("taskState")
        assert task_state is not None, "Missing 'taskState' in running status"
        assert isinstance(task_state, dict), "'taskState' should be an object"
        assert "baseCommitHash" in task_state and task_state["baseCommitHash"], "Missing or empty 'baseCommitHash' in taskState"
        assert "branchName" in task_state and task_state["branchName"], "Missing or empty 'branchName' in taskState"

    finally:
        # Cleanup - delete the created demo to avoid leftovers
        if created_slug:
            try:
                del_resp = requests.delete(
                    f"{BASE_URL}/api/demo/{created_slug}",
                    headers=HEADERS,
                    timeout=TIMEOUT
                )
                # Accept 200 or 204 as success
                assert del_resp.status_code in (200, 204, 404), f"Unexpected status code {del_resp.status_code} on cleanup delete"
            except Exception:
                pass

test_demo_creation_cursor_agent_triggering()
