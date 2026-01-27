import requests
import time

BASE_URL = "http://localhost:3001"
HEADERS = {
    "Content-Type": "application/json"
}
TIMEOUT = 30


def test_demo_creation_repository_cloning():
    """
    Test Case TC015: Demo Creation - Repository Cloning
    Verify demo creation process correctly clones the template repository from the provided GitHub URL,
    creates the demo directory in client-websites folder, initializes a fresh Git repository with proper branch name,
    creates initial commit, and handles clone failures with appropriate error messages.
    """
    demo_create_url = f"{BASE_URL}/api/demo/create"
    demo_status_url_template = f"{BASE_URL}/api/demo/status/{{clientSlug}}"

    # Example valid payload for demo creation
    # businessName and primaryColor are required; provide a valid GitHub repo URL: use a public github repo known to be cloneable
    payload = {
        "businessName": "Test Demo Cloning",
        "primaryColor": "#123abc",
        "githubRepoUrl": "https://github.com/octocat/Hello-World.git"
    }

    client_slug = None

    try:
        # 1. Create demo by POST api/demo/create
        resp = requests.post(demo_create_url, json=payload, headers=HEADERS, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200 OK on demo create, got {resp.status_code}"
        resp_json = resp.json()
        assert "clientSlug" in resp_json, "Response missing clientSlug"
        assert "status" in resp_json, "Response missing status"
        assert resp_json["status"] == "starting", "Demo creation initial status should be 'starting'"

        client_slug = resp_json["clientSlug"]

        # 2. Poll demo status until clone completes or error occurs or timeout
        # Maximum wait: 5 minutes (300s) with polling every 5s
        max_wait_seconds = 300
        poll_interval = 5
        elapsed = 0

        while elapsed < max_wait_seconds:
            status_resp = requests.get(demo_status_url_template.format(clientSlug=client_slug), timeout=TIMEOUT)
            if status_resp.status_code == 404:
                raise AssertionError("Demo status endpoint returned 404 - demo might not exist")
            assert status_resp.status_code == 200, f"Expected 200 OK on status polling, got {status_resp.status_code}"
            status_json = status_resp.json()

            # Checking status fields
            demo_status = status_json.get("state") or status_json.get("status") or None
            message = status_json.get("message") or ""
            logs = status_json.get("logs", [])
            if not demo_status:
                raise AssertionError("Demo status response missing 'state' or 'status' key")

            # Check for failure state
            if demo_status == "failed":
                raise AssertionError(f"Demo creation failed: {message}")

            # Check if cloning step passed successfully
            # We expect the status to transition through 'cloning' to 'cloned' or similar before next steps
            # Accept states 'cloned', 'installing', 'organizing', 'prompting', 'triggering', 'running' as success progression
            if demo_status in ["cloned", "installing", "organizing", "prompting", "triggering", "running", "completed"]:
                break

            # If still in 'starting' or 'cloning', wait and continue polling
            time.sleep(poll_interval)
            elapsed += poll_interval
        else:
            raise AssertionError("Timeout waiting for demo cloning to complete")

        # 3. Validate expected fields post cloning
        # Verify demo directory creation: Check 'client-websites/{clientSlug}' likely would be on server side,
        # but from API perspective, check successful clone reflects in status and logs

        # Confirm branch name initialization: Look for logs indicating branch creation or check status field
        found_branch_init_log = any("branch" in log.lower() for log in logs)
        assert found_branch_init_log, "Expected log evidence of Git branch initialization not found."

        # Confirm initial commit creation: look for logs indicating Git commit or "initial commit"
        found_initial_commit_log = any(
            "initial commit" in log.lower() or "commit" in log.lower()
            for log in logs
        )
        assert found_initial_commit_log, "Expected log evidence of initial Git commit not found."

        # 4. Simulate clone failure scenario by creating demo with an invalid repository URL
        invalid_payload = {
            "businessName": "Test Demo Clone Fail",
            "primaryColor": "#654321",
            "githubRepoUrl": "https://github.com/invalid-user/invalid-repo.git"
        }

        fail_resp = requests.post(demo_create_url, json=invalid_payload, headers=HEADERS, timeout=TIMEOUT)
        assert fail_resp.status_code == 200, f"Expected 200 OK even on failure start, got {fail_resp.status_code}"
        fail_json = fail_resp.json()
        fail_client_slug = fail_json.get("clientSlug", None)
        assert fail_client_slug, "Failure test response missing clientSlug"

        # Poll status to capture failure message about clone error
        elapsed = 0
        while elapsed < max_wait_seconds:
            fail_status_resp = requests.get(demo_status_url_template.format(clientSlug=fail_client_slug), timeout=TIMEOUT)
            assert fail_status_resp.status_code == 200, f"Expected 200 OK on failure status polling, got {fail_status_resp.status_code}"
            fail_status_json = fail_status_resp.json()
            fail_status = fail_status_json.get("state") or fail_status_json.get("status") or None
            fail_message = fail_status_json.get("message") or ""

            if fail_status == "failed":
                # Verify message indicates clone failure
                assert "clone" in fail_message.lower() or "repository" in fail_message.lower(), \
                    "Failure message does not indicate repository cloning issue"
                break
            time.sleep(poll_interval)
            elapsed += poll_interval
        else:
            raise AssertionError("Timeout waiting for clone failure status update")

    finally:
        # Cleanup: Attempt to delete created demos via API if such endpoint exists
        # No deletion endpoint is defined in PRD; If exists:
        # DELETE /api/demo/:clientSlug
        for slug_to_delete in [client_slug, fail_client_slug if 'fail_client_slug' in locals() else None]:
            if slug_to_delete:
                try:
                    del_resp = requests.delete(f"{BASE_URL}/api/demo/{slug_to_delete}", timeout=TIMEOUT)
                    # Accept 200 or 204 as successful deletion
                    if del_resp.status_code not in (200, 204, 404):
                        print(f"Warning: unexpected status code {del_resp.status_code} on deleting demo {slug_to_delete}")
                except Exception:
                    # Log but ignore cleanup exceptions
                    pass


test_demo_creation_repository_cloning()
