const config = {
  appId: 'com.foodplan.app',
  appName: 'FoodPlan',
  webDir: 'www',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f1117'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0f1117',
      androidSplashResourceName: 'splash',
      showSpinner: false
    }
  }
};

module.exports = config;
