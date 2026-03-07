const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withManifestFix(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application[0];
    
    // 1. Add tools namespace
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    
    // 2. Add the override attribute
    app.$['tools:replace'] = 'android:appComponentFactory';
    app.$['android:appComponentFactory'] = 'androidx.core.app.CoreComponentFactory';

    return config;
  });
};
