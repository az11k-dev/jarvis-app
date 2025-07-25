export default {
  expo: {
    name: "JARVIS",
    slug: "jarvis-app",
    version: "1.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    ios: {
      supportsTablet: true
    },
    android: {
      permissions: ["RECORD_AUDIO"],
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      edgeToEdgeEnabled: true,
      package: "com.az11k.jarvisapp",

      config: {
        manifest: {
          application: {
            "tools:replace": "android:appComponentFactory",
            "android:appComponentFactory": "androidx.core.app.CoreComponentFactory"
          }
        }
      }
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      eas: {
        projectId: "0725382c-d323-4a56-a612-05f4674a9b69"
      }
    },
    plugins: [
      [
        "expo-audio",
        {
          microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone."
        }
      ]
    ]
  }
};
