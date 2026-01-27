
# TestSprite AI Testing Report(MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** Kwd_dev
- **Date:** 2026-01-09
- **Prepared by:** TestSprite AI Team

---

## 2️⃣ Requirement Validation Summary

#### Test TC001
- **Test Name:** get_basic_health_check
- **Test Code:** [TC001_get_basic_health_check.py](./TC001_get_basic_health_check.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/d4de4e50-af31-4ee8-a2fc-c8ee013c8c89
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC002
- **Test Name:** get_detailed_health_check_with_clickup_status
- **Test Code:** [TC002_get_detailed_health_check_with_clickup_status.py](./TC002_get_detailed_health_check_with_clickup_status.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/290da3bb-a05f-4e91-a509-375cb0aa124d
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC003
- **Test Name:** get_webhook_enabled_status
- **Test Code:** [TC003_get_webhook_enabled_status.py](./TC003_get_webhook_enabled_status.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/25859d1f-fa98-4b56-a8f9-31eff924129d
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC004
- **Test Name:** post_toggle_webhook_state
- **Test Code:** [TC004_post_toggle_webhook_state.py](./TC004_post_toggle_webhook_state.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 33, in <module>
  File "<string>", line 27, in test_post_toggle_webhook_state
AssertionError: Response JSON missing 'newState' or 'state' field with boolean value

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/f9bb1fa7-5d0b-4423-adde-850ebdae01ff
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC005
- **Test Name:** post_enable_webhook
- **Test Code:** [TC005_post_enable_webhook.py](./TC005_post_enable_webhook.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/25ab6501-1a01-4686-8d14-e4166e25040b
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC006
- **Test Name:** post_disable_webhook
- **Test Code:** [TC006_post_disable_webhook.py](./TC006_post_disable_webhook.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/906b0eaf-c6e1-4355-a2d6-2ac80c581a0b
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC007
- **Test Name:** post_receive_clickup_webhook_events
- **Test Code:** [TC007_post_receive_clickup_webhook_events.py](./TC007_post_receive_clickup_webhook_events.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/eaaf58b2-36bb-41be-a036-cdc9d8b7edd6
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC008
- **Test Name:** get_initiate_clickup_oauth_flow
- **Test Code:** [TC008_get_initiate_clickup_oauth_flow.py](./TC008_get_initiate_clickup_oauth_flow.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 19, in <module>
  File "<string>", line 12, in test_get_initiate_clickup_oauth_flow
AssertionError: Expected status code 302, got 200

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/c20b18a0-b3cb-43e4-9367-c541de139564
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC009
- **Test Name:** get_clickup_oauth_callback_handling
- **Test Code:** [TC009_get_clickup_oauth_callback_handling.py](./TC009_get_clickup_oauth_callback_handling.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 39, in <module>
  File "<string>", line 11, in test_get_clickup_oauth_callback_handling
AssertionError: Expected 200 OK on success, got 500

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/7a032d78-5669-4ea8-828c-8c9143df94b4
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC010
- **Test Name:** get_all_tasks
- **Test Code:** [TC010_get_all_tasks.py](./TC010_get_all_tasks.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/727ffdc9-2b63-4ddd-b9bd-dbc1f01493f3
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC011
- **Test Name:** Demo Creation - Slug Availability Check
- **Test Code:** [TC011_Demo_Creation___Slug_Availability_Check.py](./TC011_Demo_Creation___Slug_Availability_Check.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/9d3557a8-d2b9-440e-ad30-4f1ffd19f745
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC012
- **Test Name:** Demo Creation - GitHub Repository Validation
- **Test Code:** [TC012_Demo_Creation___GitHub_Repository_Validation.py](./TC012_Demo_Creation___GitHub_Repository_Validation.py)
- **Test Error:** Traceback (most recent call last):
  File "/var/task/urllib3/connection.py", line 198, in _new_conn
    sock = connection.create_connection(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/var/task/urllib3/util/connection.py", line 85, in create_connection
    raise err
  File "/var/task/urllib3/util/connection.py", line 73, in create_connection
    sock.connect(sa)
TimeoutError: timed out

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/var/task/urllib3/connectionpool.py", line 787, in urlopen
    response = self._make_request(
               ^^^^^^^^^^^^^^^^^^^
  File "/var/task/urllib3/connectionpool.py", line 493, in _make_request
    conn.request(
  File "/var/task/urllib3/connection.py", line 494, in request
    self.endheaders()
  File "/var/lang/lib/python3.12/http/client.py", line 1333, in endheaders
    self._send_output(message_body, encode_chunked=encode_chunked)
  File "/var/lang/lib/python3.12/http/client.py", line 1093, in _send_output
    self.send(msg)
  File "/var/lang/lib/python3.12/http/client.py", line 1037, in send
    self.connect()
  File "/var/task/urllib3/connection.py", line 325, in connect
    self.sock = self._new_conn()
                ^^^^^^^^^^^^^^^^
  File "/var/task/urllib3/connection.py", line 207, in _new_conn
    raise ConnectTimeoutError(
urllib3.exceptions.ConnectTimeoutError: (<urllib3.connection.HTTPConnection object at 0x7fe4484e3fb0>, 'Connection to tun.testsprite.com timed out. (connect timeout=0.001)')

The above exception was the direct cause of the following exception:

urllib3.exceptions.ProxyError: ('Unable to connect to proxy', ConnectTimeoutError(<urllib3.connection.HTTPConnection object at 0x7fe4484e3fb0>, 'Connection to tun.testsprite.com timed out. (connect timeout=0.001)'))

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/var/task/requests/adapters.py", line 667, in send
    resp = conn.urlopen(
           ^^^^^^^^^^^^^
  File "/var/task/urllib3/connectionpool.py", line 841, in urlopen
    retries = retries.increment(
              ^^^^^^^^^^^^^^^^^^
  File "/var/task/urllib3/util/retry.py", line 519, in increment
    raise MaxRetryError(_pool, url, reason) from reason  # type: ignore[arg-type]
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
urllib3.exceptions.MaxRetryError: HTTPConnectionPool(host='tun.testsprite.com', port=8080): Max retries exceeded with url: http://localhost:3001/api/git/test-repo (Caused by ProxyError('Unable to connect to proxy', ConnectTimeoutError(<urllib3.connection.HTTPConnection object at 0x7fe4484e3fb0>, 'Connection to tun.testsprite.com timed out. (connect timeout=0.001)')))

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "<string>", line 37, in test_demo_creation_github_repository_validation
  File "/var/task/requests/api.py", line 115, in post
    return request("post", url, data=data, json=json, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/var/task/requests/api.py", line 59, in request
    return session.request(method=method, url=url, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/var/task/requests/sessions.py", line 589, in request
    resp = self.send(prep, **send_kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/var/task/requests/sessions.py", line 703, in send
    r = adapter.send(request, **kwargs)
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/var/task/requests/adapters.py", line 694, in send
    raise ProxyError(e, request=request)
requests.exceptions.ProxyError: HTTPConnectionPool(host='tun.testsprite.com', port=8080): Max retries exceeded with url: http://localhost:3001/api/git/test-repo (Caused by ProxyError('Unable to connect to proxy', ConnectTimeoutError(<urllib3.connection.HTTPConnection object at 0x7fe4484e3fb0>, 'Connection to tun.testsprite.com timed out. (connect timeout=0.001)')))

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/var/task/handler.py", line 258, in run_with_retry
    exec(code, exec_env)
  File "<string>", line 45, in <module>
  File "<string>", line 43, in test_demo_creation_github_repository_validation
AssertionError: Unexpected exception type: HTTPConnectionPool(host='tun.testsprite.com', port=8080): Max retries exceeded with url: http://localhost:3001/api/git/test-repo (Caused by ProxyError('Unable to connect to proxy', ConnectTimeoutError(<urllib3.connection.HTTPConnection object at 0x7fe4484e3fb0>, 'Connection to tun.testsprite.com timed out. (connect timeout=0.001)')))

- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/36d9abd5-0853-49c3-862a-154ddc13ede1
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC013
- **Test Name:** Demo Creation - Validation and Required Fields
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/59628128-11bd-401e-bb98-b9b23fcf6763
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC014
- **Test Name:** Demo Creation - Initial Response and Background Processing
- **Test Code:** [TC014_Demo_Creation___Initial_Response_and_Background_Processing.py](./TC014_Demo_Creation___Initial_Response_and_Background_Processing.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/18e0ff7b-a79e-40a9-a2fe-a8dd49223a7b
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC015
- **Test Name:** Demo Creation - Repository Cloning
- **Test Code:** [TC015_Demo_Creation___Repository_Cloning.py](./TC015_Demo_Creation___Repository_Cloning.py)
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/eb1e0754-fb75-418f-bf63-9297a920a79b
- **Status:** ✅ Passed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC016
- **Test Name:** Demo Creation - Dependency Installation
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/c7146af4-0ddd-4655-ac45-497dd0c4089b
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC017
- **Test Name:** Demo Creation - File Organization and Asset Processing
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/9ee1a3e5-6cdc-4c96-9193-f01951f3a0ba
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC018
- **Test Name:** Demo Creation - CURSOR_TASK.md Generation
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/8ccaeb11-b9e7-478c-83e5-676084306c5c
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC019
- **Test Name:** Demo Creation - Cursor Agent Triggering
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/9730580e-6a5a-4a48-bb46-b211df4db5ea
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC020
- **Test Name:** Demo Creation - Status Tracking
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/6d572465-96a7-43db-9e8b-9446c0908ebb
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC021
- **Test Name:** Demo Creation - Demo Site Structure Verification
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/39817367-b8f1-4ced-8d42-e4742a8d7a1b
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC022
- **Test Name:** Demo Creation - End-to-End Flow with Agent Integration
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/2e59b208-00b9-40ff-8f5e-8e53ffbca41e
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC023
- **Test Name:** Demo Creation - Error Handling and Cleanup
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/de35497f-3e02-4d37-b049-1b32c5510ca4
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC024
- **Test Name:** Demo Creation - Status Manager Integration
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/eb6f8b36-38ed-4e0e-93d9-943e3cdb2534
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---

#### Test TC025
- **Test Name:** Demo Creation - Slug Generation and Uniqueness
- **Test Code:** [null](./null)
- **Test Error:** Test execution timed out after 15 minutes
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/3fe51a6d-313f-45d0-ae23-782368d4297e/b48b6c5a-4ee2-4638-9001-253121581fda
- **Status:** ❌ Failed
- **Analysis / Findings:** {{TODO:AI_ANALYSIS}}.
---


## 3️⃣ Coverage & Matching Metrics

- **40.00** of tests passed

| Requirement        | Total Tests | ✅ Passed | ❌ Failed  |
|--------------------|-------------|-----------|------------|
| ...                | ...         | ...       | ...        |
---


## 4️⃣ Key Gaps / Risks
{AI_GNERATED_KET_GAPS_AND_RISKS}
---