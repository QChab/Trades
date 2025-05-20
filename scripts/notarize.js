require('dotenv').config();
const { notarize } = require('electron-notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }
  console.log('Begin notarization');
  
  const appName = context.packager.appInfo.productFilename;

  await notarize({
    tool: 'notarytool', // <--- explicitly sets notarytool
    appBundleId: 'com.yourcompany.yourapp',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.ASC_PROVIDER, // Explicitly recommended
  });

  console.log(`✅ Notarization complete for ${appName}`);
};