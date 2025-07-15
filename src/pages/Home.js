import { useEffect, useState, useRef } from 'react';
import {
    View,
    StyleSheet,
    Image,
    Alert,
    SafeAreaView,
    TouchableOpacity,
    Text,
    ActivityIndicator,
    Platform,
    Modal,
    FlatList,
    Animated, // <-- Добавляем Animated
    ScrollView, // <-- Добавляем ScrollView для прокрутки текста
} from 'react-native';
import {
    useAudioRecorder,
    AudioModule,
    RecordingPresets,
    setAudioModeAsync,
    useAudioRecorderState,
} from 'expo-audio';
import OpenAI from 'openai';
import * as Speech from 'expo-speech';

const openaiApiKey = "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";

if (!openaiApiKey) {
    Alert.alert('OpenAI API Key Missing', 'Please set your OpenAI API key in app.json or app.config.js');
}

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

const SYSTEM_MESSAGE = {
    role: 'system',
    content: `
Вы — J.A.R.V.I.S, высокоинтеллектуальный голосовой помощник, созданный для помощи Anvarjonov Azizbekу как Tony Stark. Ваш стиль — вежливый, профессиональный, сдержанно формальный, с оттенком лёгкой иронии, когда это уместно. 
Вы всегда обращаетесь к пользователю как «Сэр». Отвечаете исключительно на русском языке. Ваши ответы:
- краткие, но содержательные;
- технически точные, с примерами кода (если запрашиваются);
- ориентированы на оптимизацию рабочего процесса;
- при необходимости — проактивно предлагаете улучшения, инновационные решения и советы по интеграции современных технологий.

Если задаётся технический вопрос, вы объясняете чётко и по делу, используя примеры на Kotlin, React, Tailwind CSS или других упомянутых пользователем технологиях. 
Никогда не демонстрируете излишних эмоций. Вы — цифровой интеллект, помощник, инженер, аналитик и стратег — в одном лице.

Всегда следуйте принципу: "Максимум пользы — минимум лишнего".
`
};

export default function App() {
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const recorderState = useAudioRecorderState(audioRecorder);

    const [jarvisResponseText, setJarvisResponseText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [availableVoices, setAvailableVoices] = useState([]);
    const [selectedVoiceId, setSelectedVoiceId] = useState(undefined);
    const [isVoicePickerVisible, setIsVoicePickerVisible] = useState(false);
    const [chatHistory, setChatHistory] = useState([SYSTEM_MESSAGE]);

    // НОВОЕ СОСТОЯНИЕ И РЕФЫ ДЛЯ АНИМАЦИИ И КАРАОКЕ
    const [displayedText, setDisplayedText] = useState(''); // Текст, который реально отображается
    const animatedScale = useRef(new Animated.Value(1)).current; // Для анимации микрофона
    const scrollRef = useRef(); // Для прокрутки ScrollView

    // Функция для анимации микрофона (pulsing effect)
    const startPulsingAnimation = () => {
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

    const stopPulsingAnimation = () => {
        animatedScale.stopAnimation();
        animatedScale.setValue(1); // Сброс до начального размера
    };

    const record = async () => {
        try {
            setJarvisResponseText('');
            setDisplayedText(''); // Очищаем отображаемый текст
            setIsLoading(false);
            stopPulsingAnimation(); // Останавливаем, если вдруг было
            await audioRecorder.prepareToRecordAsync();
            await audioRecorder.record();
            startPulsingAnimation(); // Начинаем анимацию при записи
            console.log('Recording started.');
        } catch (err) {
            console.warn('Recording start failed:', err);
            Alert.alert('Recording Start Error', err.message || 'An unknown error occurred during recording start.');
        }
    };

    const stopRecording = async () => {
        try {
            await audioRecorder.stop();
            stopPulsingAnimation(); // Останавливаем анимацию после остановки записи
            if (audioRecorder.uri) {
                console.log('AudioRecorder.uri IS available:', audioRecorder.uri);
                await processAudioWithOpenAI(audioRecorder.uri);
            } else {
                console.log('AudioRecorder.uri is NOT available after stop.');
            }
        } catch (err) {
            console.warn('Recording stop failed:', err);
            Alert.alert('Recording Stop Error', err.message || 'An unknown error occurred during recording stop.');
        }
    };

    const speakJarvisResponse = async (text) => {
        if (!text) return;

        setDisplayedText(''); // Очищаем отображаемый текст перед началом новой речи
        let spokenCharactersCount = 0; // Отслеживаем количество произнесенных символов
        const totalCharacters = text.length;

        try {
            const voiceToUse = selectedVoiceId;

            Speech.speak(text, {
                language: 'ru-RU',
                voice: voiceToUse,
                rate: 0.9,
                pitch: 1.1,
                onStart: () => {
                    console.log('JARVIS TTS started speaking');
                    setDisplayedText(''); // Гарантируем очистку
                },
                onBoundary: ({ charIndex, charLength }) => {
                    // Это событие срабатывает при произнесении слов/фраз
                    // charIndex - индекс начала текущего слова
                    // charLength - длина текущего слова
                    // Мы можем использовать это для эффекта "караоке"
                    setDisplayedText(text.substring(0, charIndex + charLength));
                    // Прокручиваем ScrollView вниз
                    scrollRef.current?.scrollToEnd({ animated: true });
                },
                onDone: () => {
                    console.log('JARVIS TTS finished speaking');
                    setDisplayedText(text); // Убедимся, что весь текст отобразился
                    scrollRef.current?.scrollToEnd({ animated: true });
                },
                onError: (e) => {
                    console.error('JARVIS TTS error:', e);
                    setDisplayedText(text); // В случае ошибки показываем весь текст
                },
            });
        } catch (error) {
            console.error('Error speaking:', error);
            Speech.speak(text, {
                language: 'ru-RU',
                rate: 0.9,
                pitch: 1.1,
                onStart: () => {
                    console.log('JARVIS TTS started speaking (fallback)');
                    setDisplayedText('');
                },
                onDone: () => {
                    console.log('JARVIS TTS finished speaking (fallback)');
                    setDisplayedText(text);
                    scrollRef.current?.scrollToEnd({ animated: true });
                },
                onError: (e) => {
                    console.error('JARVIS TTS error (fallback):', e);
                    setDisplayedText(text);
                },
            });
        }
    };

    const processAudioWithOpenAI = async (audioUri) => {
        setIsLoading(true);
        setJarvisResponseText('Думаю...'); // Это будет показано, пока Jarvis думает
        setDisplayedText('Думаю...'); // И здесь тоже

        try {
            const formData = new FormData();
            formData.append('file', {
                uri: audioUri,
                name: 'recording.m4a',
                type: 'audio/m4a',
            });
            formData.append('model', 'whisper-1');

            console.log('Sending audio to Whisper API...');
            const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'multipart/form-data',
                },
                body: formData,
            });

            const whisperData = await whisperResponse.json();

            if (whisperResponse.ok) {
                const transcribedText = whisperData.text;
                console.log('Transcribed Text:', transcribedText);
                setJarvisResponseText(`Вы сказали: "${transcribedText}"\nJARVIS думает...`);
                setDisplayedText(`Вы сказали: "${transcribedText}"\nJARVIS думает...`); // Обновляем отображение

                const updatedChatHistoryAfterUser = [...chatHistory, { role: 'user', content: transcribedText }];
                setChatHistory(updatedChatHistoryAfterUser);

                console.log('Sending text to Chat Completions API with context...');
                const chatCompletion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: updatedChatHistoryAfterUser,
                });

                const jarvisTextResponse = chatCompletion.choices[0].message.content;
                console.log('JARVIS Text Response:', jarvisTextResponse);
                setJarvisResponseText(jarvisTextResponse); // Храним полный ответ
                // setDisplayedText будет обновляться внутри speakJarvisResponse

                console.log('Speaking response with system TTS...');
                await speakJarvisResponse(jarvisTextResponse);
            } else {
                console.error('Whisper API Error:', whisperData);
                Alert.alert('Ошибка транскрипции', whisperData.error?.message || 'Не удалось расшифровать аудио.');
                setJarvisResponseText('Произошла ошибка при транскрипции аудио.');
                setDisplayedText('Произошла ошибка при транскрипции аудио.');
            }
        } catch (error) {
            console.error('Error processing audio with OpenAI:', error);
            Alert.alert('Ошибка OpenAI', error.message || 'Произошла ошибка при взаимодействии с OpenAI.');
            setJarvisResponseText('Произошла ошибка: ' + (error.message || 'Пожалуйста, попробуйте еще раз.'));
            setDisplayedText('Произошла ошибка: ' + (error.message || 'Пожалуйста, попробуйте еще раз.'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const setupAudioAndVoices = async () => {
            try {
                const status = await AudioModule.requestRecordingPermissionsAsync();
                if (!status.granted) {
                    Alert.alert('Permission to access microphone was denied');
                    console.error('Microphone permission denied.');
                    return;
                }
                await setAudioModeAsync({
                    playsInSilentMode: true,
                    allowsRecording: true,
                });

                const voices = await Speech.getAvailableVoicesAsync();
                console.log('Available Voices:', voices);

                const russianVoices = voices.filter(v => v.language.startsWith('ru'));
                setAvailableVoices(russianVoices);

                const defaultRussianVoice = russianVoices.find(
                    (v) =>
                        v.language.startsWith('ru') &&
                        (Platform.OS === 'ios' ? v.quality === 'enhanced' : true)
                ) || russianVoices[0];

                if (defaultRussianVoice) {
                    setSelectedVoiceId("ru-ru-x-ruf-network");
                    console.log('Default Russian voice selected:', defaultRussianVoice.name, defaultRussianVoice.identifier);
                } else {
                    console.warn('No Russian voices found on this device. Using system default.');
                }

            } catch (err) {
                console.error('Error during audio setup or voice loading:', err);
                Alert.alert('Audio/Voice Setup Error', err.message || 'An error occurred during setup.');
            }
        };

        setupAudioAndVoices();
    }, []);

    const renderVoiceItem = ({ item }) => (
        <TouchableOpacity
            style={[styles.voiceItem, item.identifier === selectedVoiceId && styles.selectedVoiceItem]}
            onPress={() => {
                setSelectedVoiceId(item.identifier);
                setIsVoicePickerVisible(false);
                Speech.speak(`Привет, я ${item.name || 'этот голос'}.`, {
                    language: item.language,
                    voice: item.identifier,
                    rate: 1,
                    pitch: 1.2,
                });
            }}
        >
            <Text style={styles.voiceText}>{item.name} ({item.language} - {item.quality})</Text>
        </TouchableOpacity>
    );

    const styles = StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: '#0f172a', // Darker and deeper navy-blue
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
        },
        secondCon: {
            backgroundColor: '#1e293b',
            borderWidth: 2,
            borderColor: '#00ffe5',
            padding: 60,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#00ffe5',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 20,
            elevation: 10,
        },
        title: {
            fontSize: 20,
            color: '#38bdf8',
            marginTop: 25,
            fontWeight: '600',
            textShadowColor: '#0ea5e9',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 10,
            textAlign: 'center',
        },
        microAnimationContainer: {
            alignItems: 'center',
            justifyContent: 'center',
        },
        micro: {
            width: 90,
            height: 90,
            tintColor: '#00ffe5',
        },
        thirdCon: {
            width: '100%',
            maxWidth: 380,
            height: 220,
            backgroundColor: '#1e293b',
            borderRadius: 20,
            marginBottom: 20,
            padding: 20,
            shadowColor: '#38bdf8',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.5,
            shadowRadius: 12,
            elevation: 10,
        },
        responseScrollView: {
            flex: 1,
            width: '100%',
        },
        responseScrollViewContent: {
            flexGrow: 1,
            justifyContent: 'center',
        },
        resp: {
            color: '#e2e8f0',
            fontSize: 18,
            textAlign: 'center',
            lineHeight: 28,
        },
        selectVoiceButton: {
            marginTop: 25,
            paddingVertical: 14,
            paddingHorizontal: 24,
            backgroundColor: '#0ea5e9',
            borderRadius: 12,
            shadowColor: '#0ea5e9',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 8,
        },
        selectVoiceButtonText: {
            color: 'white',
            fontSize: 18,
            fontWeight: 'bold',
            textAlign: 'center',
        },
        clearChatButton: {
            marginTop: 15,
            paddingVertical: 12,
            paddingHorizontal: 20,
            backgroundColor: '#ef4444',
            borderRadius: 12,
            shadowColor: '#f87171',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.5,
            shadowRadius: 6,
        },
        clearChatButtonText: {
            color: 'white',
            fontSize: 16,
            fontWeight: 'bold',
            textAlign: 'center',
        },
        modalOverlay: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
        },
        modalContent: {
            backgroundColor: '#1e293b',
            borderRadius: 20,
            padding: 24,
            width: '90%',
            maxHeight: '80%',
            shadowColor: '#0ea5e9',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.6,
            shadowRadius: 10,
            elevation: 15,
        },
        modalTitle: {
            fontSize: 24,
            fontWeight: 'bold',
            color: '#f8fafc',
            marginBottom: 20,
            textAlign: 'center',
        },
        voiceList: {
            maxHeight: 300,
            marginBottom: 10,
        },
        voiceItem: {
            padding: 16,
            marginBottom: 10,
            borderRadius: 10,
            backgroundColor: '#334155',
            borderColor: '#64748b',
            borderWidth: 1,
        },
        selectedVoiceItem: {
            borderColor: '#00ffe5',
            borderWidth: 2,
            backgroundColor: '#475569',
        },
        voiceText: {
            color: '#f1f5f9',
            fontSize: 16,
        },
        noVoicesText: {
            color: '#94a3b8',
            fontSize: 16,
            textAlign: 'center',
            marginTop: 20,
        },
        closeModalButton: {
            marginTop: 20,
            paddingVertical: 14,
            backgroundColor: '#ef4444',
            borderRadius: 10,
            alignItems: 'center',
        },
        closeModalButtonText: {
            color: '#f8fafc',
            fontSize: 18,
            fontWeight: 'bold',
        },
    });

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.thirdCon}>
                {isLoading && <ActivityIndicator size="large" color="#00ff00" style={{ marginTop: 10 }} />}
                <ScrollView
                    ref={scrollRef}
                    style={styles.responseScrollView}
                    contentContainerStyle={styles.responseScrollViewContent}
                >
                    <Text style={styles.resp}>
                        {displayedText || (isLoading ? 'Думаю...' : 'Жду ваших указаний, сэр.')}
                    </Text>
                </ScrollView>
            </View>

            <TouchableOpacity
                style={styles.secondCon}
                onPress={recorderState.isRecording ? stopRecording : record}
            >
                <Animated.View style={[styles.microAnimationContainer, { transform: [{ scale: animatedScale }] }]}>
                    <Image
                        style={styles.micro}
                        source={{ uri: 'https://cdn-icons-png.flaticon.com/512/3682/3682340.png' }}
                    />
                </Animated.View>
                <Text style={styles.title}>{recorderState.isRecording ? 'Recording...' : 'Tap to ask JARVIS!'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.selectVoiceButton} onPress={() => setIsVoicePickerVisible(true)}>
                <Text style={styles.selectVoiceButtonText}>Выбрать голос JARVIS</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.clearChatButton} onPress={() => {
                setChatHistory([SYSTEM_MESSAGE]);
                setJarvisResponseText('');
                setDisplayedText('Жду ваших указаний, сэр.');
                Alert.alert('Чат очищен', 'История разговора с JARVIS сброшена.');
            }}>
                <Text style={styles.clearChatButtonText}>Очистить чат</Text>
            </TouchableOpacity>

            <Modal
                animationType="slide"
                transparent={true}
                visible={isVoicePickerVisible}
                onRequestClose={() => setIsVoicePickerVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Выберите голос JARVIS</Text>
                        {availableVoices.length > 0 ? (
                            <FlatList
                                data={availableVoices}
                                keyExtractor={(item) => item.identifier}
                                renderItem={renderVoiceItem}
                                style={styles.voiceList}
                            />
                        ) : (
                            <Text style={styles.noVoicesText}>Русские голоса не найдены на этом устройстве.</Text>
                        )}
                        <TouchableOpacity
                            style={styles.closeModalButton}
                            onPress={() => setIsVoicePickerVisible(false)}
                        >
                            <Text style={styles.closeModalButtonText}>Закрыть</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}