// app.config.js — configuração dinâmica do Expo.
// Lê variáveis de ambiente do .env (via dotenv ou Replit Secrets) em tempo de build,
// evitando que chaves de API fiquem hardcoded no app.json.

const googleMapsApiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: "My App",
  slug: "my-app",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "myapp",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/images/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.myapp",
  },
  android: {
    package: "com.myapp",
    config: {
      googleMaps: {
        // Lido de GOOGLE_PLACES_API_KEY no ambiente — nunca hardcoded
        apiKey: googleMapsApiKey,
      },
    },
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
  },
  web: {
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    ["expo-router", { origin: "https://replit.com/" }],
    "expo-font",
    "expo-web-browser",
    // react-native-maps 1.20.x não usa app.plugin.js.
    // A chave do Maps SDK para Android é injetada via android.config.googleMaps.apiKey acima.
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

module.exports = config;
