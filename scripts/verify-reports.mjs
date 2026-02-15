import axios from 'axios';
import chalk from 'chalk';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function verify() {
  console.log(chalk.blue('Starting Backend Reporting Verification...'));

  const endpoints = [
    { name: 'Health Check', path: '/health', expectedStatus: 200 },
    { name: 'Report Jobs', path: '/api/reports/jobs/test-id', expectedStatus: 401 },
    { name: 'Run Report', path: '/api/reports/run', method: 'post', expectedStatus: 401 },
    { name: 'Schedules', path: '/api/schedules', expectedStatus: 401 },
    { name: 'Uptime', path: '/api/uptime/test-site', expectedStatus: 401 },
    { name: 'Public Share Link', path: '/r/invalid-token', expectedStatus: 404 }
  ];

  let allPassed = true;

  for (const endpoint of endpoints) {
    try {
      const method = endpoint.method || 'get';
      const response = await axios({
        method,
        url: `${BASE_URL}${endpoint.path}`,
        validateStatus: () => true
      });

      if (response.status === endpoint.expectedStatus) {
        console.log(chalk.green(`✅ ${endpoint.name}: Received expected status ${endpoint.expectedStatus}`));
      } else {
        console.log(chalk.red(`❌ ${endpoint.name}: Expected ${endpoint.expectedStatus}, but got ${response.status}`));
        allPassed = false;
      }
    } catch (error) {
      console.log(chalk.red(`❌ ${endpoint.name}: Error connecting to server: ${error.message}`));
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log(chalk.bold.green('\nAll integrated reporting routes are responsive!'));
  } else {
    console.log(chalk.bold.red('\nSome checks failed. Ensure the server is running.'));
    process.exit(1);
  }
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});





