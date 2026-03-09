import { registerRootComponent } from 'expo';
import { NativeEventEmitter } from 'react-native';

// ✅ 1. Apply Polyfill FIRST (Fixes the TTS/Mic crash)
if (!(NativeEventEmitter.prototype as any).removeListener) {
  (NativeEventEmitter.prototype as any).removeListener = function (eventType: string) {
    console.log(`Polyfill caught removeListener: ${eventType}`);
  };
}

// ✅ 2. Load App SECOND (Prevents ES6 hoisting from loading audio modules too early)
const App = require('./App').default;

registerRootComponent(App);