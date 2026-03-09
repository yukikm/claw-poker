module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { unstable_transformImportMeta: true }],
    ],
    plugins: [
      // expo-router plugin must be explicit because babel-preset-expo is hoisted
      // to the monorepo root where it cannot resolve expo-router
      require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin,
      'react-native-reanimated/plugin',
    ],
  };
};
