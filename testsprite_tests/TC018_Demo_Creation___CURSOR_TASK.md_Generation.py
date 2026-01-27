import requests
import time

BASE_URL = "http://localhost:3001"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_demo_creation_cursor_task_md_generation():
    demo_payload = {
        "businessName": "Test Business XYZ",
        "primaryColor": "#1a73e8",
        "secondaryColor": "#ff5722",
        "accentColor": "#4caf50",
        "fonts": {
            "primary": "Arial, sans-serif",
            "secondary": "Georgia, serif"
        },
        "templateId": "default-template",
        "logoUrl": "https://example.com/logo.png",
        "heroImageUrl": "https://example.com/hero.jpg"
    }

    # Step 1: Create demo - POST /api/demo/create
    try:
        create_resp = requests.post(
            f"{BASE_URL}/api/demo/create",
            json=demo_payload,
            headers=HEADERS,
            timeout=TIMEOUT
        )
        assert create_resp.status_code == 200, f"Demo creation failed: {create_resp.text}"
        create_data = create_resp.json()
        assert "clientSlug" in create_data, "clientSlug missing in response"
        assert create_data.get("status") == "starting", "Initial status is not 'starting'"
        client_slug = create_data["clientSlug"]

        # Poll status until it reaches 'prompting' (max wait 300s)
        status = None
        prompt_deadline = time.time() + 300
        cursor_task_md_content = None
        while time.time() < prompt_deadline:
            status_resp = requests.get(f"{BASE_URL}/api/demo/status/{client_slug}", headers=HEADERS, timeout=TIMEOUT)
            assert status_resp.status_code == 200, f"Status fetch failed: {status_resp.text}"
            status_data = status_resp.json()
            status = status_data.get("status") or status_data.get("state")
            if status == "prompting":
                break
            time.sleep(5)
        else:
            assert False, f"Demo status did not reach 'prompting' within timeout, last status: {status}"

        # Step 2: Verify CURSOR_TASK.md existence and content
        # There is no direct API specified to get the file, so retrieve the demo file via the backend or assume an endpoint:
        # Try GET /api/demo/files/{clientSlug}/CURSOR_TASK.md
        file_resp = requests.get(f"{BASE_URL}/api/demo/files/{client_slug}/CURSOR_TASK.md", headers=HEADERS, timeout=TIMEOUT)
        assert file_resp.status_code == 200, f"CURSOR_TASK.md not found or inaccessible: {file_resp.text}"
        cursor_task_md_content = file_resp.text

        # Validate placeholder replacements and content structure
        # Check placeholders are replaced - no '{{' or '}}' templates remain
        assert "{{" not in cursor_task_md_content and "}}" not in cursor_task_md_content, "Template placeholders not replaced in CURSOR_TASK.md"

        # Check presence of key businessName and clientSlug
        assert "Test Business XYZ" in cursor_task_md_content, "'businessName' not replaced in CURSOR_TASK.md"
        assert client_slug in cursor_task_md_content, "'clientSlug' not replaced in CURSOR_TASK.md"

        # Check color codes are replaced correctly
        for color in [demo_payload["primaryColor"], demo_payload["secondaryColor"], demo_payload["accentColor"]]:
            assert color.lower() in cursor_task_md_content.lower(), f"Color {color} not found in CURSOR_TASK.md"

        # Check fonts presence
        for font_name in demo_payload["fonts"].values():
            assert font_name in cursor_task_md_content, f"Font '{font_name}' not found in CURSOR_TASK.md"

        # Check imagesDir (e.g. logo or heroImage URLs replaced accordingly)
        for img_url in [demo_payload["logoUrl"], demo_payload["heroImageUrl"]]:
            # We expect a relative images dir usage; ensure the URLs are not present as raw URLs but replaced with local references,
            # or at least the file name is present
            img_filename = img_url.split("/")[-1]
            assert img_filename in cursor_task_md_content, f"Image reference '{img_filename}' not found in CURSOR_TASK.md"

        # Check task structure and step information presence (presence of "steps" or similar keywords)
        assert "steps" in cursor_task_md_content.lower() or "step" in cursor_task_md_content.lower(), "Step information missing in CURSOR_TASK.md"

        # Check that status is updated to 'prompting' in the status endpoint
        status_resp_final = requests.get(f"{BASE_URL}/api/demo/status/{client_slug}", headers=HEADERS, timeout=TIMEOUT)
        assert status_resp_final.status_code == 200, f"Failed to fetch status for verification: {status_resp_final.text}"
        status_data_final = status_resp_final.json()
        final_status = status_data_final.get("status") or status_data_final.get("state")
        assert final_status == "prompting", f"Final demo status is not 'prompting', got '{final_status}'"

    finally:
        # Cleanup - delete the created demo if possible
        if 'client_slug' in locals():
            try:
                del_resp = requests.delete(f"{BASE_URL}/api/demo/{client_slug}", headers=HEADERS, timeout=TIMEOUT)
                # Accept 200 or 204 for successful deletion; do not fail test if cleanup fails
                assert del_resp.status_code in (200, 204), f"Demo deletion failed: {del_resp.text}"
            except Exception:
                pass


test_demo_creation_cursor_task_md_generation()