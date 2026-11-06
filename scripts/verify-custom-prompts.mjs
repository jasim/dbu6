import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const agentEnvPath = path.join(rootDir, '.env.agent');
const tokenMatch = fs.readFileSync(agentEnvPath, 'utf8').match(/SAPPORTA_API_TOKEN=(.*)/);
const token = tokenMatch ? tokenMatch[1].trim() : '';

console.log('--- RUNNING CUSTOM PROMPTS & UI VERIFICATION SUITE ---');

const { openDbu6 } = await import('../node_modules/@dbu6/app/dist/server/open.js');
const { hono } = await openDbu6({ root: rootDir });

const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json',
};

let testsPassed = 0;
let testsTotal = 0;

function assert(condition, message) {
  testsTotal++;
  if (condition) {
    console.log(`[PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

// Test 1: GET /api/custom-prompts returns default system prompt
const getRes = await hono.request('/api/custom-prompts', { headers });
assert(getRes.status === 200, `GET /api/custom-prompts returns status 200 (got ${getRes.status})`);
const getData = await getRes.json();
assert(getData.ok === true && Array.isArray(getData.prompts), 'GET response has ok: true and prompts array');
const sysPrompt = getData.prompts.find((p) => p.isSystem);
assert(Boolean(sysPrompt), `Default system prompt identified (found: ${sysPrompt?.filename})`);

// Test 2: System prompt direct modification is BLOCKED
const postSysRes = await hono.request('/api/custom-prompts', {
  method: 'POST',
  headers,
  body: JSON.stringify({ filename: 'custom_mappings_default.prompt', content: 'hacked content' }),
});
assert(postSysRes.status === 400, `POST to overwrite system prompt returns status 400 (got ${postSysRes.status})`);
const postSysData = await postSysRes.json();
assert(postSysData.ok === false && postSysData.error.includes('Built-in system prompt cannot be directly modified'), `POST system prompt returns user-facing rejection message: "${postSysData.error}"`);

// Test 3: System prefix modification is BLOCKED
const postSysPrefixRes = await hono.request('/api/custom-prompts', {
  method: 'POST',
  headers,
  body: JSON.stringify({ filename: 'system_core.prompt', content: 'blocked' }),
});
assert(postSysPrefixRes.status === 400, 'POST with system prefix is blocked');

// Test 4: Path traversal attempt is BLOCKED
const postTraversalRes = await hono.request('/api/custom-prompts', {
  method: 'POST',
  headers,
  body: JSON.stringify({ filename: '../secret.prompt', content: 'traversal' }),
});
assert(postTraversalRes.status === 400, 'POST with path traversal ../ is blocked');

// Test 5: Empty filename is BLOCKED
const postEmptyRes = await hono.request('/api/custom-prompts', {
  method: 'POST',
  headers,
  body: JSON.stringify({ filename: '   ', content: 'empty' }),
});
assert(postEmptyRes.status === 400, 'POST with empty filename is blocked');

// Test 6: Creating a valid custom prompt
const testCustomName = 'my_test_custom_rules.prompt';
const testCustomContent = 'My custom categorization rules:\n- Test Account: All test transactions';
const postCustomRes = await hono.request('/api/custom-prompts', {
  method: 'POST',
  headers,
  body: JSON.stringify({ filename: testCustomName, content: testCustomContent }),
});
assert(postCustomRes.status === 200, `POST valid custom prompt returns status 200 (got ${postCustomRes.status})`);
const postCustomData = await postCustomRes.json();
assert(postCustomData.ok === true && postCustomData.filename === testCustomName, 'POST custom prompt returns ok: true');

// Test 7: Verify file actually exists on disk in user-config/
const customFilePath = path.join(rootDir, 'user-config', testCustomName);
assert(fs.existsSync(customFilePath), `Custom prompt file successfully written to disk at ${customFilePath}`);
const fileContentOnDisk = fs.readFileSync(customFilePath, 'utf8');
assert(fileContentOnDisk === testCustomContent, 'File content on disk matches saved payload');

// Test 8: GET /api/custom-prompts?file=... returns the new custom prompt
const getSpecificRes = await hono.request(`/api/custom-prompts?file=${testCustomName}`, { headers });
assert(getSpecificRes.status === 200, 'GET /api/custom-prompts?file=... returns status 200');
const getSpecificData = await getSpecificRes.json();
assert(getSpecificData.prompt?.isSystem === false, 'Custom prompt has isSystem: false');
assert(getSpecificData.prompt?.content === testCustomContent, 'Custom prompt content matches');

// Test 9: Updating an existing custom prompt
const updatedContent = testCustomContent + '\n- Updated Account: New rules';
const putCustomRes = await hono.request('/api/custom-prompts', {
  method: 'POST',
  headers,
  body: JSON.stringify({ filename: testCustomName, content: updatedContent }),
});
assert(putCustomRes.status === 200, 'Updating existing custom prompt succeeds with status 200');
assert(fs.readFileSync(customFilePath, 'utf8') === updatedContent, 'Updated content reflected on disk');

// Clean up test file from user-config/
if (fs.existsSync(customFilePath)) {
  fs.unlinkSync(customFilePath);
  console.log(`[CLEANUP] Removed temporary test prompt file: ${testCustomName}`);
}

// Test 10: Frontend bundle verification
const bundlePath = path.join(rootDir, 'node_modules/@dbu6/app/dist/app/assets/index-Cou-F-rz.js');
const bundleContent = fs.readFileSync(bundlePath, 'utf8');
assert(bundleContent.includes('Add Custom Prompt'), 'Frontend bundle contains "Add Custom Prompt" dropdown option');
assert(bundleContent.includes('Edit Prompt'), 'Frontend bundle contains "Edit Prompt" dropdown option');
assert(bundleContent.includes('System Prompt Protected'), 'Frontend bundle contains "System Prompt Protected" banner header');
assert(bundleContent.includes('This is a built-in system prompt and cannot be directly modified'), 'Frontend bundle contains user-facing system prompt warning message');
assert(bundleContent.includes('Save as Custom Prompt'), 'Frontend bundle contains "Save as Custom Prompt" button flow');
assert(bundleContent.includes('readOnly:pmIsSys'), 'Frontend bundle enforces readOnly: pmIsSys so user cannot edit system prompt');

// Test 11: Cache busting v4 in index.html and assets
const indexPath = path.join(rootDir, 'node_modules/@dbu6/app/dist/app/index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');
assert(indexContent.includes('index-Cou-F-rz-v4.js'), 'dist/app/index.html references index-Cou-F-rz-v4.js');
assert(indexContent.includes('index-DG2rmt1t-v4.css'), 'dist/app/index.html references index-DG2rmt1t-v4.css');
assert(fs.existsSync(path.join(rootDir, 'node_modules/@dbu6/app/dist/app/assets/index-Cou-F-rz-v4.js')), 'index-Cou-F-rz-v4.js exists on disk');
assert(fs.existsSync(path.join(rootDir, 'node_modules/@dbu6/app/dist/app/assets/index-DG2rmt1t-v4.css')), 'index-DG2rmt1t-v4.css exists on disk');

console.log(`\n========================================`);
console.log(`VERIFICATION SUMMARY: ${testsPassed} / ${testsTotal} tests passed.`);
console.log(`========================================\n`);
