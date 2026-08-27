import http from 'http';
import { dbHelper } from '../server/db.js';
import { config } from '../server/config.js';

const PORT = config.port || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {})
      }
    };

    if (options.body) {
      if (typeof options.body === 'object') {
        reqOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json || data
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runSecurityAudit() {
  console.log('\n======================================================');
  console.log('🛡️ RUNNING DISCORD OAUTH2 ADMIN AUTHENTICATION SECURITY AUDIT');
  console.log('======================================================\n');

  // Test 1: Unauthenticated protection on HTML routes
  console.log('🔒 Test 1: Protecting /admin and /dashboard from unauthenticated visitors...');
  const resAdmin = await request('/admin');
  assert(resAdmin.status === 302, 'GET /admin returns 302 redirect');
  assert(resAdmin.headers.location === '/admin/login', 'GET /admin redirects to /admin/login');

  const resDashboard = await request('/dashboard');
  assert(resDashboard.status === 302, 'GET /dashboard returns 302 redirect');
  assert(resDashboard.headers.location === '/admin/login', 'GET /dashboard redirects to /admin/login');

  // Test 2: Unauthenticated protection on Admin APIs
  console.log('\n🔒 Test 2: Protecting /api/dashboard/* and /api/admin/* from unauthenticated access...');
  const resApi = await request('/api/dashboard/overview');
  assert(resApi.status === 401, 'GET /api/dashboard/overview rejects unauthenticated request with 401');

  // Test 3: Normal Customer Registration cannot escalate role to ADMIN/OWNER
  console.log('\n🛡️ Test 3: Preventing Customer Privilege Escalation on Registration...');
  const randomEmail = `test_customer_${Date.now()}@example.com`;
  const resReg = await request('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Hacker Attempt',
      email: randomEmail,
      password: 'Password@123',
      role: 'OWNER', // Attacker trying to set role to OWNER
      permissions: ['*']
    }
  });

  assert(resReg.status === 201, 'Registration endpoint responds 201');
  assert(resReg.data.data.role === 'VIEWER', 'Role is strictly enforced as VIEWER (ignored client role payload)');

  const customerToken = resReg.data.data.token;

  // Test 4: Customer VIEWER token CANNOT access Admin APIs or /admin route
  console.log('\n🔒 Test 4: Verifying customer session CANNOT access Admin APIs...');
  const resCustomerApi = await request('/api/dashboard/overview', {
    headers: { 'Cookie': `auth_token=${customerToken}` }
  });
  assert(resCustomerApi.status === 403, 'Customer session blocked from /api/dashboard/overview with 403 Forbidden');
  assert(resCustomerApi.data.error.code === 'FORBIDDEN_NOT_ADMIN', 'Error code specifies FORBIDDEN_NOT_ADMIN');

  const resCustomerAdminHtml = await request('/admin', {
    headers: { 'Cookie': `auth_token=${customerToken}` }
  });
  assert(resCustomerAdminHtml.status === 302, 'Customer session blocked from /admin HTML view');
  assert(resCustomerAdminHtml.headers.location === '/admin/login', 'Redirected to /admin/login');

  // Test 5: Prevent password login for Admin accounts
  console.log('\n🚫 Test 5: Verifying password login is strictly disabled for Admin accounts...');
  // Manually seed a dummy owner to verify password login rejection
  const testAdminDiscordId = '987654321098765432';
  const adminRecord = dbHelper.upsertDiscordAdmin({
    discordId: testAdminDiscordId,
    username: 'TestAdminDiscord',
    globalName: 'Super Admin',
    avatar: 'abcdef123456'
  });

  const resAdminPassLogin = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: adminRecord.email,
      password: 'SomePassword@123'
    }
  });
  assert(resAdminPassLogin.status === 403, 'Password login for Admin account rejected with 403');
  assert(resAdminPassLogin.data.error.code === 'DISCORD_AUTH_REQUIRED', 'Returns DISCORD_AUTH_REQUIRED code');

  // Test 6: Discord OAuth2 CSRF State Validation
  console.log('\n🔐 Test 6: Verifying Discord OAuth2 CSRF State Validation...');
  const resCallbackBadState = await request('/api/auth/discord/callback?code=mock_code&state=fake_state_123');
  assert(resCallbackBadState.status === 302, 'Callback with invalid state returns 302');
  assert(resCallbackBadState.headers.location.includes('error=csrf_detected'), 'Redirects with error=csrf_detected');

  // Test 7: Authorized Discord Admin Login & Session Lifecycle
  console.log('\n👑 Test 7: Simulating Authorized Discord Admin Session Lifecycle...');
  const adminSessionToken = dbHelper.createSession(adminRecord.id, 7);

  const resAdminApi = await request('/api/dashboard/overview', {
    headers: { 'Cookie': `auth_token=${adminSessionToken}` }
  });
  assert(resAdminApi.status === 200, 'Authorized Admin session accesses /api/dashboard/overview with 200 OK');
  assert(resAdminApi.data.success === true, 'Admin API successfully returns dashboard data');

  const resAdminMe = await request('/api/auth/me', {
    headers: { 'Cookie': `auth_token=${adminSessionToken}` }
  });
  assert(resAdminMe.status === 200, 'GET /api/auth/me returns 200 OK');
  assert(resAdminMe.data.data.role === 'OWNER', 'Admin role is verified as OWNER');
  assert(resAdminMe.data.data.discord_id === testAdminDiscordId, 'Admin record is linked to verified Discord ID');

  // Test 8: Admin Logout & Session Invalidation
  console.log('\n🚪 Test 8: Verifying Admin Logout and Session Invalidation...');
  const resLogout = await request('/api/auth/logout', {
    method: 'POST',
    headers: { 'Cookie': `auth_token=${adminSessionToken}` }
  });
  assert(resLogout.status === 200, 'Logout endpoint responded 200 OK');

  // Subsequent request with the logged out token must be rejected
  const resAfterLogout = await request('/api/dashboard/overview', {
    headers: { 'Cookie': `auth_token=${adminSessionToken}` }
  });
  assert(resAfterLogout.status === 401, 'Logged out session token rejected with 401 Unauthorized');

  console.log('\n======================================================');
  console.log('🎉 ALL 8 DISCORD ADMIN AUTH SECURITY TESTS PASSED PERFECTLY!');
  console.log('======================================================\n');
}

runSecurityAudit().catch(err => {
  console.error('Audit run error:', err);
  process.exit(1);
});
