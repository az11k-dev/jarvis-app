export default {
  expo: {
    name: 'JARVIS',
    slug: 'jarvis-app',
    version: '1.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
    },
    android: {
      permissions: ['RECORD_AUDIO'],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      package: 'com.az11k.jarvisapp',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      eas: {
        projectId: '0725382c-d323-4a56-a612-05f4674a9b69',
      },
    },
    plugins: [
      'expo-asset',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
      [
        'expo-audio',
        {
          microphonePermission:
            'Allow $(PRODUCT_NAME) to access your microphone.',
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission:
            'Allow $(PRODUCT_NAME) to use the camera to see what you ask about.',
          barcodeScannerEnabled: false,
        },
      ],
      [
        'expo-image-picker',
        {
          cameraPermission:
            'Allow $(PRODUCT_NAME) to use the camera to see what you ask about.',
          photosPermission:
            'Allow $(PRODUCT_NAME) to analyse photos you ask about.',
        },
      ],
    ],
  },
};
