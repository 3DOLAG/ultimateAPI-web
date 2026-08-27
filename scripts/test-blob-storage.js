import { blobService } from '../server/services/blobService.js';
import fs from 'fs';
import path from 'path';

async function testBlobService() {
  console.log('🧪 Testing Blob Storage Service...');
  console.log('Blob Configured:', blobService.isBlobConfigured() ? 'Yes (Vercel Blob)' : 'No (Local Fallback)');

  const sampleBuffer = Buffer.from('Fake Image Content for Testing');
  const uploadResult = await blobService.upload('sample-test-image.png', sampleBuffer, {
    folder: 'branding',
    contentType: 'image/png'
  });

  console.log('✅ Upload Result:', uploadResult);

  if (!uploadResult.url) {
    throw new Error('Upload failed: missing url');
  }

  // Test Delete
  console.log('🗑️ Testing deletion...');
  const delResult = await blobService.delete(uploadResult.url);
  console.log('✅ Delete Result:', delResult);

  console.log('\n🎉 Blob storage service passed all tests!\n');
}

testBlobService().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
