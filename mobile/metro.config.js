const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('stream-browserify'),
  events: require.resolve('events'),
  assert: require.resolve('assert'),
};

// Redirect web-only modules to empty shim on Android
const emptyModule = path.resolve(__dirname, 'shims/empty.js');
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && (moduleName === 'react-dom' || moduleName === 'react-dom/client')) {
    return { type: 'sourceFile', filePath: emptyModule };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
