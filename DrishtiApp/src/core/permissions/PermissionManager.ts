import { PermissionsAndroid, Platform } from 'react-native';
import { Camera } from 'react-native-vision-camera';

export const requestDrishtiPermissions = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    try {
      // 1. Vision Camera Native Permissions
      const cameraPermission = await Camera.requestCameraPermission();
      const microphonePermission = await Camera.requestMicrophonePermission();

      // 2. Android System Level Permissions for Voice & Storage
      const grantes = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      ]);

      const audioGranted = grantes['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED;
      
      // Note: On Android 13+, WRITE_EXTERNAL_STORAGE might return 'never_ask_again' 
      // but we mainly need it for older SDKs since we are using the Cache dir.
      
      return (
        cameraPermission === 'granted' &&
        microphonePermission === 'granted' &&
        audioGranted
      );
    } catch (err) {
      console.warn('[PermissionManager Error]:', err);
      return false;
    }
  }
  return true; // Default true for iOS development later
};