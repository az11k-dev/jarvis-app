import React, { useState, useRef } from 'react';
import {
  Alert,
  TouchableOpacity,
  Text,
  Animated,
  View,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
} from 'expo-audio';
import * as Speech from 'expo-speech';

import MicrophoneButton from '../components/MicrophoneButton';
import ResponseBox from '../components/ResponseBox';
import VoicePickerModal from '../components/VoicePickerModal';

import { useVoiceSetup } from '../hooks/useVoiceSetup';
import { speakJarvisResponse } from '../services/ttsService';
import { processAudioWithOpenAI } from '../services/jarvisService';

import { SYSTEM_MESSAGE } from '../utils/constants';
import { styles } from '../styles/mainStyles';
import * as ImagePicker from 'expo-image-picker';

export default function Home() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [displayedText, setDisplayedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState(undefined);
  const [englishVoiceId, setEnglishVoiceId] = useState();
  const [russianVoiceId, setRussianVoiceId] = useState();
  const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
  const [chatHistory, setChatHistory] = useState([SYSTEM_MESSAGE]);

  const scrollRef = useRef();
  const [animatedScale] = useState(() => new Animated.Value(1));

  useVoiceSetup({
    setAvailableVoices,
    setEnglishVoiceId,
    setRussianVoiceId,
    setSelectedVoiceId,
  });

  const startPulsing = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(animatedScale, {
          toValue: 1.1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(animatedScale, {
          toValue: 1.0,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const stopPulsing = () => {
    animatedScale.stopAnimation();
    animatedScale.setValue(1);
  };

  const speak = async (text) => {
    await speakJarvisResponse({
      text,
      selectedVoiceId,
      availableVoices,
      scrollRef,
      setDisplayedText,
      setSelectedVoiceId,
      englishVoiceId,
      russianVoiceId,
    });
  };

  const openCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Разрешение отклонено',
          'Для использования камеры необходимо предоставить разрешение.'
        );
        await speak('Сэр, я не могу открыть камеру без вашего разрешения.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled) {
        console.log('Фото сделано:', result.assets[0].uri);
        await speak('Сэр, фото успешно сделано.');
      } else {
        await speak('Сэр, вы отменили съемку.');
      }
    } catch (error) {
      console.error('Ошибка при открытии камеры:', error);
      Alert.alert(
        'Ошибка камеры',
        'Не удалось открыть камеру: ' + error.message
      );
      await speak('Сэр, произошла ошибка при попытке открыть камеру.');
    }
  };

  const openTelegram = async () => {
    const tgUrl = 'tg://';
    const fallbackUrl = 'https://t.me';

    try {
      await Linking.openURL(tgUrl);
      await speak('Открываю Telegram, сэр.');
    } catch {
      await Linking.openURL(fallbackUrl);
      await speak('Сэр, Telegram не установлен. Перехожу в браузер.');
    }
  };

  const openYoutube = async (query) => {
    try {
      if (query) {
        const youtubeAppUrl = `vnd.youtube://results?search_query=${encodeURIComponent(query)}`;

        await Linking.openURL(youtubeAppUrl);
        await speak(`Открываю YouTube по запросу: ${query}, сэр.`);
      } else {
        const youtubeAppUrl = `vnd.youtube://`;

        await Linking.openURL(youtubeAppUrl);
        await speak(`Открываю YouTube, сэр.`);
      }
    } catch {
      const fallbackUrl = query
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : `https://youtube.com`;

      await Linking.openURL(fallbackUrl);
      await speak(
        `Сэр, приложение YouTube не обнаружено. Открываю в браузере.`
      );
    }
  };

  const record = async () => {
    setDisplayedText('');
    setIsLoading(false);
    stopPulsing();
    await audioRecorder.prepareToRecordAsync();
    await audioRecorder.record();
    startPulsing();
  };

  const stopRecording = async () => {
    await audioRecorder.stop();
    stopPulsing();
    if (audioRecorder.uri) {
      await processAudioWithOpenAI({
        audioUri: audioRecorder.uri,
        chatHistory,
        setChatHistory,
        setDisplayedText,
        setJarvisResponseText: setDisplayedText,
        speak,
        openCamera,
        openTelegram,
        openYoutube,
        setIsLoading,
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ResponseBox
        isLoading={isLoading}
        displayedText={displayedText}
        scrollRef={scrollRef}
      />

      <View style={styles.controlsContainer}>
        <MicrophoneButton
          onPress={recorderState.isRecording ? stopRecording : record}
          isRecording={recorderState.isRecording}
          animatedScale={animatedScale}
        />

        <TouchableOpacity
          style={styles.selectVoiceButton}
          onPress={() => setIsVoicePickerVisible(true)}
        >
          <Text style={styles.selectVoiceButtonText}>
            🎙️ Выбрать голос JARVIS
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.clearChatButton}
          onPress={() => {
            setChatHistory([SYSTEM_MESSAGE]);
            setDisplayedText('Жду ваших указаний, сэр.');
            Alert.alert('Чат очищен', 'История разговора сброшена.');
          }}
        >
          <Text style={styles.clearChatButtonText}>🗑 Очистить чат</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.stopCon}
          onPress={() => {
            Speech.stop();
            setDisplayedText('');
          }}
        >
          <Text style={styles.stop}>⛔️ Остановить</Text>
        </TouchableOpacity>
      </View>

      <VoicePickerModal
        isVisible={isVoicePickerVisible}
        availableVoices={availableVoices}
        selectedVoiceId={selectedVoiceId}
        setSelectedVoiceId={setSelectedVoiceId}
        onClose={() => setIsVoicePickerVisible(false)}
      />
    </SafeAreaView>
  );
}
