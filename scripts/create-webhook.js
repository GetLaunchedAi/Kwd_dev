/**
 * Script to create ClickUp webhook via API
 * Usage: node create-webhook.js
 */

const axios = require('axios');
require('dotenv').config();

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CLICKUP_ACCESS_TOKEN = process.env.CLICKUP_ACCESS_TOKEN;
const TEAM_ID = process.env.CLICKUP_TEAM_ID; // Optional, will try to detect if not provided

const WEBHOOK_URL = 'https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup';
const WEBHOOK_EVENTS = ['taskStatusUpdated', 'taskUpdated'];

async function getAccessToken() {
  // Try to load from token file (OAuth)
  try {
    const fs = require('fs-extra');
    const path = require('path');
    const tokenFile = path.join(__dirname, 'tokens', 'clickup-access-token.json');
    if (fs.existsSync(tokenFile)) {
      const tokenData = await fs.readJson(tokenFile);
      if (tokenData.access_token) {
        return tokenData.access_token;
      }
    }
  } catch (error) {
    // Ignore
  }

  // Try environment variable
  if (CLICKUP_ACCESS_TOKEN) {
    return CLICKUP_ACCESS_TOKEN;
  }

  // Try API token
  if (CLICKUP_API_TOKEN) {
    return CLICKUP_API_TOKEN;
  }

  throw new Error('No access token found. Please authorize OAuth first or set CLICKUP_API_TOKEN in .env');
}

async function getTeamId(token) {
  if (TEAM_ID) {
    return TEAM_ID;
  }

  try {
    console.log('Fetching teams to get Team ID...');
    const response = await axios.get('https://api.clickup.com/api/v2/team', {
      headers: {
        'Authorization': token,
      },
    });

    const teams = response.data.teams;
    if (teams && teams.length > 0) {
      const teamId = teams[0].id;
      console.log(`Using Team ID: ${teamId}`);
      return teamId;
    }

    throw new Error('No teams found');
  } catch (error) {
    console.error('Error fetching teams:', error.response?.data || error.message);
    throw new Error('Could not get Team ID. Please set CLICKUP_TEAM_ID in .env');
  }
}

async function createWebhook() {
  try {
    const token = await getAccessToken();
    console.log('✓ Got access token');

    const teamId = await getTeamId(token);
    console.log('✓ Got team ID');

    console.log('\nCreating webhook...');
    const response = await axios.post(
      `https://api.clickup.com/api/v2/team/${teamId}/webhook`,
      {
        endpoint: WEBHOOK_URL,
        client_id: process.env.CLICKUP_CLIENT_ID,
        events: WEBHOOK_EVENTS,
        task_id: null, // null means all tasks
        list_id: null, // null means all lists
        folder_id: null, // null means all folders
        space_id: null, // null means all spaces
        health: {
          status: 'active',
        },
      },
      {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('\n✅ Webhook created successfully!');
    console.log('\nWebhook Details:');
    console.log('  ID:', response.data.id);
    console.log('  URL:', response.data.endpoint);
    console.log('  Status:', response.data.status);
    console.log('\n⚠️  IMPORTANT: Save the webhook secret!');
    console.log('  Secret:', response.data.secret || 'Not provided by API');
    console.log('\nAdd this to your .env file:');
    console.log(`  CLICKUP_WEBHOOK_SECRET=${response.data.secret || 'YOUR_SECRET_HERE'}`);

    return response.data;
  } catch (error) {
    console.error('\n❌ Error creating webhook:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

// Run the script
createWebhook();




