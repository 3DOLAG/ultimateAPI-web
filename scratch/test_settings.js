import { getMergedSettings } from '../server/routes/store.js';

async function test() {
  const s = await getMergedSettings();
  console.log('Current Merged Store Name:', s.store_name);
  console.log('Current Merged Tagline:', s.tagline);
}

test();
