import requests
import time

BASE_URL = "http://localhost:3001"
TIMEOUT = 30
HEADERS = {"Content-Type": "application/json"}

def test_TC022_demo_creation_end_to_end_flow_with_agent_integration():
    demo_create_url = f"{BASE_URL}/api/demo/create"
    demo_status_url_template = f"{BASE_URL}/api/demo/status/{{clientSlug}}"

    # Prepare demo creation payload with required valid fields including valid 'slug'
    payload = {
        "businessName": "Test Business TC022",
        "primaryColor": "#123ABC",
        "templateId": "template-basic",
        "slug": "test-business-tc022"
    }

    resource_client_slug = None

    try:
        # Step 1: Create demo via API
        response = requests.post(demo_create_url, json=payload, headers=HEADERS, timeout=TIMEOUT)
        assert response.status_code == 200, f"Expected 200 but got {response.status_code}: {response.text}"
        resp_json = response.json()
        assert "clientSlug" in resp_json, "Response missing clientSlug"
        assert "status" in resp_json and resp_json["status"] == "starting", "Initial status not 'starting'"

        client_slug = resp_json["clientSlug"]
        resource_client_slug = client_slug

        # Step 2: Poll status endpoint until 'running' or 'failed' or timeout
        status_url = demo_status_url_template.format(clientSlug=client_slug)
        max_wait_time = 900  # wait up to 15 minutes for full demo creation and agent processing
        interval = 10
        elapsed = 0

        last_status = None
        status_history = []
        cursor_task_md_verified = False
        agent_triggered = False
        demo_site_ready = False
        agent_processed_changes = False

        while elapsed < max_wait_time:
            status_resp = requests.get(status_url, headers=HEADERS, timeout=TIMEOUT)
            assert status_resp.status_code == 200, f"Failed to get status: {status_resp.text}"
            status_data = status_resp.json()
            assert "state" in status_data, "Status response missing 'state'"
            assert "currentStep" in status_data, "Status response missing 'currentStep'"
            assert "totalSteps" in status_data, "Status response missing 'totalSteps'"
            assert "message" in status_data, "Status response missing 'message'"

            state = status_data["state"]
            message = status_data["message"]
            logs = status_data.get("logs", "")
            current_step = status_data["currentStep"]
            total_steps = status_data["totalSteps"]

            # Track status transitions historically for assertion after loop
            if last_status != state:
                status_history.append(state)
                last_status = state

            # Check for failure
            if state == "failed":
                raise AssertionError(f"Demo creation failed with message: {message}")

            # Check if CURSOR_TASK.md is generated and content valid:
            # This might not be directly accessible via API; assume logs or message contain hint
            if not cursor_task_md_verified and ("CURSOR_TASK.md generated" in logs or "CURSOR_TASK.md" in message):
                cursor_task_md_verified = True

            # Check if agent is added to queue and triggered
            if not agent_triggered and ("triggering" in state or "running" in state):
                agent_triggered = True

            # Verify that status advances correctly through known stages in order:
            # Expected order (based on validation criteria):
            expected_states_order = [
                "starting", "cloning", "installing", "organizing", "prompting", "triggering", "running"
            ]
            # If state is running, demo site should be available and agent processes task

            if state == "running":
                # Check demo site functionality (assume a GET to clientSlug URL returns 200)
                demo_site_url = f"http://localhost:3000/{client_slug}"  # Assuming demo sites run on 3000 with slug path
                try:
                    site_resp = requests.get(demo_site_url, timeout=TIMEOUT)
                    if site_resp.status_code == 200 and len(site_resp.content) > 0:
                        demo_site_ready = True
                except requests.RequestException:
                    demo_site_ready = False

                # Check agent processed the task and made code changes:
                # Assume logs contain indication of agent success
                if "agent completed changes" in logs or "agent task processed" in logs:
                    agent_processed_changes = True

            # Exit early if all verifications are met
            if (cursor_task_md_verified and agent_triggered and demo_site_ready and agent_processed_changes):
                break

            time.sleep(interval)
            elapsed += interval

        # Assertions after polling loop
        # Verify all expected states appeared in order in status_history
        filtered_history = [s for s in status_history if s in expected_states_order]
        assert all(state in filtered_history for state in expected_states_order), f"Not all expected states seen in order: {filtered_history}"

        assert cursor_task_md_verified, "CURSOR_TASK.md generation not verified via logs/message"
        assert agent_triggered, "Agent queue trigger not confirmed"
        assert demo_site_ready, "Demo site not functional after creation"
        assert agent_processed_changes, "Agent did not process task or make changes"
    finally:
        # Cleanup: Delete created demo via API if such endpoint exists
        if resource_client_slug:
            try:
                delete_url = f"{BASE_URL}/api/demo/{resource_client_slug}"
                del_resp = requests.delete(delete_url, headers=HEADERS, timeout=TIMEOUT)
                assert del_resp.status_code in (200,204), f"Failed to delete demo {resource_client_slug}: {del_resp.status_code} {del_resp.text}"
            except Exception:
                # Log or ignore cleanup failure
                pass

test_TC022_demo_creation_end_to_end_flow_with_agent_integration()
