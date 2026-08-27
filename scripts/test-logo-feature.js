import fs from 'fs';
import path from 'path';

async function runTest() {
  console.log('🧪 Starting Store Logo Feature Verification...\n');

  // 1. Admin Login
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@aurastore.eg',
      password: 'Admin@12345'
    })
  });

  const loginCookie = loginRes.headers.get('set-cookie');
  const loginJson = await loginRes.json();
  if (!loginJson.success) {
    throw new Error('Admin login failed: ' + JSON.stringify(loginJson));
  }
  console.log('✅ 1. Admin login authenticated successfully');

  // 2. Create a test 1x1 PNG image buffer
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  // 3. Test Multipart Upload
  const formData = new FormData();
  formData.append('logo', new Blob([samplePngBuffer], { type: 'image/png' }), 'test-store-logo.png');

  const uploadRes = await fetch('http://localhost:3000/api/dashboard/upload-logo', {
    method: 'POST',
    headers: {
      Cookie: loginCookie
    },
    body: formData
  });

  const uploadJson = await uploadRes.json();
  console.log('Upload response:', uploadJson);
  if (!uploadJson.success || !uploadJson.data?.logo_url) {
    throw new Error('Logo upload endpoint failed: ' + JSON.stringify(uploadJson));
  }
  console.log('✅ 2. Store logo image uploaded successfully to:', uploadJson.data.logo_url);

  // 4. Verify Static Serving of Uploaded Logo
  const staticRes = await fetch(`http://localhost:3000${uploadJson.data.logo_url}`);
  if (staticRes.status !== 200) {
    throw new Error(`Static file access to ${uploadJson.data.logo_url} returned HTTP ${staticRes.status}`);
  }
  console.log('✅ 3. Uploaded logo is statically served with HTTP 200 OK');

  // 5. Verify Store Info Returns the Uploaded Logo URL
  const infoRes = await fetch('http://localhost:3000/api/store/info');
  const infoJson = await infoRes.json();
  if (infoJson.data.logo_url !== uploadJson.data.logo_url) {
    throw new Error(`Store info logo_url (${infoJson.data.logo_url}) does not match expected (${uploadJson.data.logo_url})`);
  }
  console.log('✅ 4. Public store info API accurately returns the new logo URL');

  // 6. Test Settings Save with custom URL
  const customUrl = 'https://res.cloudinary.com/demo/image/upload/sample.png';
  const saveRes = await fetch('http://localhost:3000/api/dashboard/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: loginCookie
    },
    body: JSON.stringify({
      store_name: 'AURA Supreme Gaming',
      tagline: 'Premier Gaming & Digital Hub',
      logo_url: customUrl,
      support_whatsapp: '+201001234567',
      support_discord: 'https://discord.gg/aurastore',
      support_tiktok: 'https://tiktok.com/@aurastore'
    })
  });
  const saveJson = await saveRes.json();
  if (!saveJson.success) {
    throw new Error('Settings save failed: ' + JSON.stringify(saveJson));
  }

  const infoRes2 = await fetch('http://localhost:3000/api/store/info');
  const infoJson2 = await infoRes2.json();
  if (infoJson2.data.logo_url !== customUrl || infoJson2.data.name !== 'AURA Supreme Gaming') {
    throw new Error('Store info does not reflect updated settings');
  }
  console.log('✅ 5. Custom logo URL and store settings successfully updated and verified');

  // 7. Test Logo Removal
  const removeRes = await fetch('http://localhost:3000/api/dashboard/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: loginCookie
    },
    body: JSON.stringify({
      logo_url: ''
    })
  });
  const removeJson = await removeRes.json();
  if (!removeJson.success) {
    throw new Error('Remove logo failed');
  }

  const infoRes3 = await fetch('http://localhost:3000/api/store/info');
  const infoJson3 = await infoRes3.json();
  if (infoJson3.data.logo_url !== '') {
    throw new Error('Logo removal failed to reset logo_url');
  }
  console.log('✅ 6. Logo removal successfully reset logo_url to empty (fallback to default mark)');

  console.log('\n🎉 ALL STORE LOGO FEATURE TESTS PASSED PERFECTLY!\n');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
