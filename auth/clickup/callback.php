<?php
/**
 * ClickUp OAuth Callback Handler
 * 
 * This file handles the OAuth callback from ClickUp, exchanges the authorization
 * code for an access token, and saves it where the Node.js app expects it.
 */

// Load environment variables from .env file into an array (putenv is disabled on Cloudways)
// Go up 2 levels: callback.php -> clickup/ -> auth/ -> app root
$env = [];
$envFile = dirname(__DIR__, 2) . '/.env';
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos($line, '#') === 0) continue;
        if (strpos($line, '=') === false) continue;
        list($key, $value) = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Remove surrounding quotes if present
        $value = trim($value, '"\'');
        $env[$key] = $value;
    }
}

// Helper function to get config value (from $env array or server environment)
function getConfig($key) {
    global $env;
    return isset($env[$key]) ? $env[$key] : (getenv($key) ?: null);
}

// Get configuration
$clientId = getConfig('CLICKUP_CLIENT_ID');
$clientSecret = getConfig('CLICKUP_CLIENT_SECRET');
$redirectUri = getConfig('CLICKUP_REDIRECT_URI');

// Check for error from ClickUp
if (isset($_GET['error'])) {
    $error = htmlspecialchars($_GET['error']);
    die("<html><head><title>Authorization Failed</title></head>
        <body><h1>Authorization Failed</h1><p>Error: $error</p>
        <p><a href='/auth/clickup'>Try again</a></p></body></html>");
}

// Check for authorization code
if (!isset($_GET['code'])) {
    die("<html><head><title>Authorization Required</title></head>
        <body><h1>Authorization Required</h1>
        <p>No authorization code received.</p>
        <p><a href='/auth/clickup'>Start authorization</a></p></body></html>");
}

$code = $_GET['code'];

// Exchange code for access token
$tokenUrl = 'https://api.clickup.com/api/v2/oauth/token';
$postData = [
    'client_id' => $clientId,
    'client_secret' => $clientSecret,
    'code' => $code,
    'redirect_uri' => $redirectUri
];

$ch = curl_init($tokenUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postData));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json'
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    die("<html><head><title>Connection Error</title></head>
        <body><h1>Connection Error</h1><p>$curlError</p>
        <p><a href='/auth/clickup'>Try again</a></p></body></html>");
}

$tokenData = json_decode($response, true);

if ($httpCode !== 200 || !isset($tokenData['access_token'])) {
    $errorMsg = isset($tokenData['error']) ? $tokenData['error'] : 'Unknown error';
    $errorDesc = isset($tokenData['error_description']) ? $tokenData['error_description'] : $response;
    die("<html><head><title>Token Exchange Failed</title></head>
        <body><h1>Token Exchange Failed</h1>
        <p>Error: $errorMsg</p><p>Details: $errorDesc</p>
        <p><a href='/auth/clickup'>Try again</a></p></body></html>");
}

// Save the access token to where Node.js expects it
$tokensDir = dirname(__DIR__, 2) . '/tokens';
if (!is_dir($tokensDir)) {
    mkdir($tokensDir, 0755, true);
}

$tokenFile = $tokensDir . '/clickup-access-token.json';
$tokenToSave = [
    'access_token' => $tokenData['access_token'],
    'expires_at' => isset($tokenData['expires_in']) ? (time() + $tokenData['expires_in']) * 1000 : null,
    'saved_at' => date('c')
];

file_put_contents($tokenFile, json_encode($tokenToSave, JSON_PRETTY_PRINT));

// Success - redirect to dashboard
?>
<!DOCTYPE html>
<html>
<head>
    <title>Authorization Successful</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
        .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="success">
        <h1>✅ Authorization Successful!</h1>
        <p>Your ClickUp app has been authorized successfully.</p>
        <p>The access token has been saved and will be used for API calls.</p>
        <a href="/" class="button">Go to Dashboard</a>
    </div>
</body>
</html>

