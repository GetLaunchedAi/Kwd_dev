import requests
import time

BASE_URL = "http://localhost:3001"
TIMEOUT = 30


def test_demo_creation_dependency_installation():
    # Step 1: Create a new demo (POST /api/demo/create)
    create_payload = {
        "businessName": "Test Business for Dependency Installation",
        "primaryColor": "#0099FF",
        "templateId": "basic-template"
    }
    headers = {"Content-Type": "application/json"}

    demo_slug = None
    demo_id = None

    try:
        # Create demo
        resp_create = requests.post(
            f"{BASE_URL}/api/demo/create",
            json=create_payload,
            headers=headers,
            timeout=TIMEOUT,
        )
        assert resp_create.status_code == 200, f"Failed to create demo: {resp_create.text}"
        create_data = resp_create.json()
        assert "clientSlug" in create_data and create_data["clientSlug"], "No clientSlug in create response"
        assert "status" in create_data and create_data["status"] == "starting", "Demo creation status not 'starting'"

        demo_slug = create_data["clientSlug"]

        # Wait for cloning step to complete (poll status)
        status_url = f"{BASE_URL}/api/demo/status/{demo_slug}"
        max_wait = 300  # 5 minutes max wait for demo creation process
        start_time = time.time()

        installing_detected = False
        install_fail_detected = False
        install_logs_found = False

        while time.time() - start_time < max_wait:
            resp_status = requests.get(status_url, timeout=TIMEOUT)
            assert resp_status.status_code == 200, f"Status check failed with code {resp_status.status_code}"
            status_data = resp_status.json()

            state = status_data.get("state")
            msg = status_data.get("message", "")
            logs = status_data.get("logs", "")
            current_step = status_data.get("currentStep")
            total_steps = status_data.get("totalSteps")

            # Check that status updates to 'installing' during dependency installation
            if state == "installing":
                installing_detected = True

            # Check logs for npm install progress
            if installing_detected and logs:
                if "npm install" in logs.lower() or "added" in logs.lower() or "audited" in logs.lower():
                    install_logs_found = True
                if "error" in logs.lower() or "failed" in logs.lower():
                    install_fail_detected = True

            # If installation complete or failed, break out of loop
            if state not in ["installing", "cloning", "starting"]:
                break

            time.sleep(5)

        assert installing_detected, "Status never updated to 'installing'"
        assert install_logs_found, "No npm install logs found in demo logs"
        assert not install_fail_detected, f"Detected installation failure in logs: {logs}"

    finally:
        # Cleanup: delete the created demo (DELETE /api/demo/:clientSlug)
        if demo_slug:
            try:
                del_resp = requests.delete(f"{BASE_URL}/api/demo/{demo_slug}", timeout=TIMEOUT)
                assert del_resp.status_code in [200, 204], f"Failed to delete demo during cleanup: {del_resp.text}"
            except Exception:
                pass


test_demo_creation_dependency_installation()