import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

export const useVoiceSetup = ({
                                  setAvailableVoices,
                                  setEnglishVoiceId,
                                  setRussianVoiceId,
                                  setSelectedVoiceId,
                              }) => {
    useEffect(() => {
        const setup = async () => {
            try {
                const permission = await AudioModule.requestRecordingPermissionsAsync();
                if (!permission.granted) {
                    Alert.alert('Microphone permission denied');
                    return;
                }

                await setAudioModeAsync({
                    playsInSilentMode: true,
                    allowsRecording: true,
                });

                const voices = await Speech.getAvailableVoicesAsync();
                const enVoices = voices.filter(v => v.language.startsWith('en-US'));
                const ruVoices = voices.filter(v => v.language.startsWith('ru'));

                setEnglishVoiceId(enVoices[0]?.identifier);
                setRussianVoiceId(ruVoices[0]?.identifier);
                setAvailableVoices([...ruVoices, ...enVoices]);

                const defaultVoice = ruVoices.find(v =>
                    Platform.OS === 'ios' ? v.quality === 'enhanced' : true
                ) || ruVoices[0];

                if (defaultVoice) {
                    setSelectedVoiceId('ru-ru-x-ruf-network');
                    console.log('Default Russian voice selected:', defaultVoice.name);
                }
            } catch (err) {
                console.error('Voice setup error:', err);
                Alert.alert('Voice Setup Error', err.message);
            }
        };

        setup();
    }, []);
};