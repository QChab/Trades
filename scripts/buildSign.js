const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

// Read package.json version
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const version = packageJson.version;

// Define dmg filename dynamically
const dmgName = `transfers-${version}-arm64.dmg`;
const dmgPath = path.join('dist', dmgName);

// Define credentials (replace or load from ENV for security)
const appleId = 'email';
const password = 'pwd';
const teamId = 'TEAMID';

try {
  console.log(`📦 Submitting ${dmgPath} to Apple for notarization...`);
  execSync(
    `xcrun notarytool submit "${dmgPath}" --apple-id "${appleId}" --password "${password}" --team-id "${teamId}" --wait --progress`,
    { stdio: 'inherit' }
  );

  console.log(`🧷 Stapling ticket into ${dmgPath}...`);
  execSync(`xcrun stapler staple "${dmgPath}"`, { stdio: 'inherit' });

  console.log(`🚀 Uploading ${dmgPath} to server...`);
  execSync(`scp "${dmgPath}" game:~/drive/`, { stdio: 'inherit' });

  console.log('✅ Done!');
} catch (err) {
  console.error('❌ Error during buildSign process:', err);
  process.exit(1);
}