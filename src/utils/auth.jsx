import * as LocalAuthentication from 'expo-local-authentication';

export async function requestDeviceAuth() {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
        console.warn('Biometric authentication not available.');
        return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
        promptMessage: '🔐 Authenticate to access J.A.R.V.I.S.',
        fallbackLabel: 'Enter device password',
        cancelLabel: 'Abort mission',
        disableDeviceFallback: false,
    });

    return result.success;
}
