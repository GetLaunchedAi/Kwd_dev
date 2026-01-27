import requests
import threading
import time

BASE_URL = "http://localhost:3001"
HEADERS = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_TC024_demo_status_manager_integration():
    # We will create a demo to test status manager features.
    demo_create_url = f"{BASE_URL}/api/demo/create"
    demo_status_url_template = f"{BASE_URL}/api/demo/status/{{clientSlug}}"
    
    demo_payload = {
        "clientSlug": "kwd-demo-status-manager",
        "businessName": "KWD Demo Status Manager",
        "primaryColor": "#112233",
        "templateId": "default-template"
    }
    
    # Step 1: Create a demo
    create_resp = requests.post(demo_create_url, json=demo_payload, headers=HEADERS, timeout=TIMEOUT)
    assert create_resp.status_code == 200, f"Demo creation failed: {create_resp.text}"
    create_json = create_resp.json()
    assert "clientSlug" in create_json, "Response missing clientSlug"
    assert create_json.get("status") == "starting", "Initial status is not 'starting'"
    
    client_slug = create_json["clientSlug"]
    demo_status_url = demo_status_url_template.format(clientSlug=client_slug)
    
    # Helper function to fetch status repeatedly to validate in-memory cache and atomic updates
    def repeatedly_fetch_status(results, index):
        try:
            resp = requests.get(demo_status_url, timeout=TIMEOUT)
            if resp.status_code == 200:
                results[index] = resp.json()
            else:
                results[index] = None
        except Exception:
            results[index] = None
    
    # Step 2: Wait for some time and check multiple concurrent status fetches to verify in-memory caching & atomicity
    time.sleep(5)  # Let some status updates happen
    
    concurrent_calls = 5
    threads = []
    results = [None] * concurrent_calls
    for i in range(concurrent_calls):
        t = threading.Thread(target=repeatedly_fetch_status, args=(results, i))
        threads.append(t)
        t.start()
    for t in threads:
        t.join()
    
    # Validate all fetches returned a non-null and consistent status structure
    statuses = [r for r in results if r is not None]
    assert len(statuses) == concurrent_calls, "Not all concurrent status fetches succeeded"
    base_state = statuses[0].get("state")
    base_msg = statuses[0].get("message")
    base_logs = statuses[0].get("logs")
    for status in statuses[1:]:
        assert status.get("state") == base_state, "Inconsistent 'state' in concurrent status fetches"
        assert status.get("message") == base_msg, "Inconsistent 'message' in concurrent status fetches"
        assert status.get("logs") == base_logs, "Inconsistent 'logs' in concurrent status fetches"
    
    # Step 3: Trigger simulated concurrent status updates via TaskStatusManager sync endpoint if available
    # Since PRD does not specify such endpoint directly, try simultaneous reads and assert state is stable.
    # If the API had a write endpoint for status, we'd simulate concurrent writes here.
    
    # Step 4: Verify audit log update by fetching active demos audit log endpoint if exists
    audit_url = f"{BASE_URL}/api/demo/active-demos"
    audit_resp = requests.get(audit_url, timeout=TIMEOUT)
    assert audit_resp.status_code == 200, "Failed to get active demos audit log"
    audit_json = audit_resp.json()
    # Check audit log contains our clientSlug and some status info
    assert any(demo.get("clientSlug") == client_slug for demo in audit_json), "Demo not found in active demos audit log"
    
    # Step 5: During active creation, ensure status endpoint returns accurate status
    # Create a loop polling status until it reaches a final state (e.g. running, failed, succeeded)
    final_states = {"running", "failed", "succeeded"}
    status_response = None
    max_wait_secs = 120
    interval = 5
    waited = 0
    while waited < max_wait_secs:
        resp = requests.get(demo_status_url, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Status fetch failed unexpectedly: {resp.text}"
        status_response = resp.json()
        state = status_response.get("state")
        if state in final_states:
            break
        time.sleep(interval)
        waited += interval
    
    assert status_response is not None, "No status response received at end of wait"
    assert status_response.get("state") in final_states, f"Final state not reached after wait, current state: {status_response.get('state')}"
    
    # Validate that logs are present and are strings or list
    logs = status_response.get("logs")
    assert logs is not None, "Logs should be present in status response"
    assert isinstance(logs, (list, str)), "Logs should be string or list"
    
    # Step 6: Validate atomicity and correct merge of agent logs (if possible by multiple fetches)
    # For demonstration, fetch twice and verify logs are cumulative or consistent
    resp1 = requests.get(demo_status_url, timeout=TIMEOUT)
    resp2 = requests.get(demo_status_url, timeout=TIMEOUT)
    assert resp1.status_code == 200 and resp2.status_code == 200, "Status fetch failed during atomicity check"
    logs1 = resp1.json().get("logs")
    logs2 = resp2.json().get("logs")
    # The logs should be strings or lists; if lists, logs2 should contain logs1 or be equal or longer
    if isinstance(logs1, list) and isinstance(logs2, list):
        assert len(logs2) >= len(logs1), "Logs are not cumulative or consistent"
    elif isinstance(logs1, str) and isinstance(logs2, str):
        assert logs2.startswith(logs1) or logs2 == logs1, "String logs are inconsistent"
    
    # Note: We do not delete demo here as per instructions because test depends on ongoing status updates.

test_TC024_demo_status_manager_integration()